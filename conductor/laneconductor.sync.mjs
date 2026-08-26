#!/usr/bin/env node
// conductor/laneconductor.sync.mjs
// LaneConductor Heartbeat Worker — run via: make lc-start
// Worker has zero DB knowledge — all writes go through the Collector HTTP API.

import { watch } from 'chokidar';
import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync, openSync, closeSync, mkdirSync, statSync, rmSync, copyFileSync, renameSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, exec } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import os from 'os';

import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from './constants.mjs';
import { PROVIDERS, PROVIDER_IDS, normalizeProviderId } from './providers.mjs';
import {
  readJiraConfig,
  pollJira,
  jiraIssueToTrackUpdate,
  createJiraIssue,
  pushTrackToJira,
  pushCommentToJira,
  getJiraComments,
  parseAdfToText,
  mapLaneToJiraStatus,
  mapLaneToLaneStatus,
  validateJiraStatuses,
} from './jira-collector.mjs';
import { logger } from './services/logger.mjs';
import { runDeploy } from './deploy-runner.mjs';
import { getBuildById, createBuildArtifact } from '../ui/server/build-manager.mjs';
import { compareTimestamps, isConcurrentEdit } from './sync-timestamp-utils.mjs';
import { parseConversationComments, findTurnStartOffsets } from './sync-conversation-utils.mjs';
import { isResumeFailure } from './session-resilience-utils.mjs';
import { buildClaudeArgs } from './claude-cli-args.mjs';
import { parseOnlyTracks, isTrackClaimable, isScopedWorkFinished } from './claim-scope.mjs';
import { parseNewJsonlLines, extractFinalAssistantText, extractBlockedQuestion } from './stream-json-tail.mjs';
import { extractUnansweredHumanTail } from './conversation-tail.mjs';
import { slugify, resolveRepoTarget } from './create-project-utils.mjs';
import { buildDeployJson, buildDeploymentStackMd, buildEnvExample } from './deployConfig.mjs';
import { deriveTrackPlan } from './services/wizard-track-plan.mjs';
import { getAuthorInfo } from './services/author.mjs';
import { acquireWorkerLock } from './services/worker-lock.mjs';
import { isProviderExhausted } from './services/exhaustion-detector.mjs';
import { classifyAutoCompleteOutcome } from './services/auto-complete.mjs';
import { resolveWorktreeAddArgs } from './services/worktree-create-args.mjs';
import { belongsInWorktreesPanel } from './services/worktree-panel-scope.mjs';
import { mergeIndexMarkers, copyWorktreeArtifactsToPrimary } from './services/worktree-artifact-merge.mjs';
import { classifyOrphanedDispatch } from './services/orphaned-dispatch.mjs';
import { capContentForArgv } from './services/context-cap.mjs';
import { mergeDiscoveredWithPresets } from './services/model-discovery-merge.mjs';
import { parseStatus as parseStatusPure } from './services/parse-status.mjs';
import { parseMergeModeMarker, resolveMergeMode } from './services/merge-mode.mjs';
import { checkGhAuth, createTrackPr, pollTrackPr, resolvePrStatus, mergeTrackPr } from './services/pr-flow.mjs';
import { validatePathIsolation as sharedValidatePathIsolation } from './services/path-isolation.mjs';
import { resolveLaneCliAndModel, stripLanePrimaryCli } from './services/lane-model-resolver.mjs';
import { findStaleLaneModels, formatStaleLaneModelWarning, maybeAutoUpdateWorkflowModels } from './services/model-staleness.mjs';
import { auditWorktrees, listTrackWorktrees } from './services/worktree-audit.mjs';
import { mergeWorktreeBranch, resolvePrimaryRepoRoot } from './services/worktree-merge.mjs';
import { checkDivergence, safePull } from './services/git-divergence.mjs';
import { resolvePrimaryCwdDecision } from './services/primary-cwd.mjs';
import { parseWorkspaceMarker, resolveWorkspaceMode, parseTrackKind, findDisqualifyingDirtyPaths } from './services/workspace-mode.mjs';
import { parsePsWorkerRows, findOrphanedWorkerProcesses } from './services/orphan-worker-detection.mjs';

const RC_FILE = join(os.homedir(), '.laneconductorrc');

function getInstallPath() {
  if (existsSync(RC_FILE)) {
    const skillPath = readFileSync(RC_FILE, 'utf8').trim();
    return resolve(skillPath, '../../..');
  }
  return null;
}

// ── Config + env ─────────────────────────────────────────────────────────────

const cliSyncOnly = process.argv.includes('--sync-only');
let workerMode = cliSyncOnly ? 'sync-only' : null; // Will be resolved after config load

// Track 1109: operator-supplied claim allowlist. Independent of the
// identity-derived server-side gate (which admits everything in a no-auth
// local deployment), so it also works in local-fs mode. null = unscoped,
// i.e. today's behaviour.
let onlyTracks = null;
try {
  onlyTracks = parseOnlyTracks(process.argv);
} catch (err) {
  console.error(`[LaneConductor] ${err.message}`);
  process.exit(2);
}

// --only-tracks is meaningless under sync-only (which never polls the
// queue), so the pair is a user error rather than a silent no-op.
if (onlyTracks && cliSyncOnly) {
  console.error('[LaneConductor] --only-tracks cannot be combined with --sync-only: a sync-only worker never polls the queue, so the allowlist would have no effect.');
  process.exit(2);
}

// Track 1109: exit once the scoped work is done — opt-in, and deliberately
// NOT implied by --only-tracks. Scoping and lifecycle are orthogonal: a
// long-lived worker scoped to a couple of tracks is a legitimate setup.
const exitWhenDone = process.argv.includes('--once');
if (exitWhenDone && !onlyTracks) {
  console.error('[LaneConductor] --once requires --only-tracks: an unscoped worker has no bounded set of work to finish.');
  process.exit(2);
}

// Track 1084 Phase 0: stable worker identity. pid is ephemeral (a restart
// gets a new OS pid, which under the old (project_id, hostname, pid)
// uniqueness minted a brand-new DB row and orphaned anything FK'd to it) —
// worker_number is a stable, user-assigned identity that survives restarts.
// Defaults to 1, preserving today's single-worker-per-host behavior.
const workerNumberArgIdx = process.argv.indexOf('--worker-number');
const workerNumber = workerNumberArgIdx !== -1
  ? parseInt(process.argv[workerNumberArgIdx + 1], 10)
  : (parseInt(process.env.LC_WORKER_NUMBER, 10) || 1);

// Track 1091 Phase 2: a manager worker isn't scoped to any project — it
// registers with project_id: null and additionally polls for system-wide
// dispatch actions (create-project) a 'project'-type worker ignores.
// --worker-number is meaningless here (machine-level singleton, not
// multi-instance) and deliberately not read in this branch.
const isManager = process.argv.includes('--manager');

// Track 10019 (REQ-1): normalize this process's cwd to the PRIMARY checkout
// before anything below reads process.cwd() relatively — ~60 sites
// throughout this file (.env load, HARDCODED_DEFAULTS.repo_path, chokidar
// watch roots, .conductor/locks, the tracks dir, conductor/logs, the 60s
// reconcile/summary ticks, the git-sync check). Correctness for all of them
// previously depended entirely on the launcher happening to pass
// `cwd: workerRoot` (true for `lc start`, untrue for a direct `node
// conductor/laneconductor.sync.mjs` run from inside a linked worktree) —
// the exact structural hole F16/F17 (track 1102) each patched at one call
// site. This closes the class instead of the next one being found by
// accident. `--manager` is a machine-level singleton not scoped to any
// project checkout, and a cwd outside any git repo (tests, CI fixtures)
// has no primary to resolve to — both intentionally degrade to "leave cwd
// alone" rather than crashing the worker over this (REQ-1a).
//
// LC_SKIP_CWD_NORMALIZATION: test-only, same shape as LC_SKIP_WORKER_LOCK
// below. Many existing tests spawn this file with `cwd` set to a throwaway
// sandbox directory that is a plain, non-git subdirectory of wherever the
// test suite itself happens to run from — never its own repo. If that
// happens to be inside a linked worktree (as it is for dogfooded
// development on THIS track, from THIS worktree), those sandboxes get
// correctly-per-REQ-1 redirected to the real enclosing primary checkout,
// which is not what those tests intend (they intend an isolated sandbox,
// decoupled from wherever the suite runs from) and can collide with a
// real, live worker already holding that identity's lock there. Opt-in
// only — off by default, so real deployments always get REQ-1's
// protection; a test that wants to exercise this normalization itself
// uses resolvePrimaryCwdDecision() directly (see
// conductor/tests/primary-root-normalization.test.mjs) rather than a real
// spawned process.
if (!process.env.LC_SKIP_CWD_NORMALIZATION) {
  const cwdDecision = resolvePrimaryCwdDecision({ cwd: process.cwd(), isManager, resolvePrimaryRepoRoot });
  if (cwdDecision.shouldChdir) {
    process.chdir(cwdDecision.primaryRoot);
    console.warn(`[LaneConductor] Launched from ${cwdDecision.launchCwd}, which is not the primary checkout — running from ${cwdDecision.primaryRoot} instead.`);
  }
}

// Track 10019 (REQ-6): one-line startup provenance, printed every run
// (not just when REQ-1 above corrects something) — defense in depth for
// whatever this track's audit doesn't structurally rule out. When the
// next incident in this class turns up, this is the first thing to check
// instead of /proc archaeology. Computed AFTER REQ-1's own chdir so it
// reports the checkout actually being served, not the launch cwd.
{
  const servingRoot = process.cwd();
  let isPrimary = null; // null = "not inside a git repo, primary status unknown" (tests/CI fixtures)
  if (!isManager) {
    try { isPrimary = resolvePrimaryRepoRoot(servingRoot) === servingRoot; } catch { /* leave null */ }
  }
  const provenanceMsg = isManager
    ? `[LaneConductor] Manager worker starting from ${servingRoot} — not scoped to any project checkout.`
    : isPrimary === null
      ? `[LaneConductor] Serving from ${servingRoot} (not inside a git repo — primary status unknown).`
      : isPrimary
        ? `[LaneConductor] Serving from ${servingRoot} (primary checkout).`
        : `[LaneConductor] ⚠️  Serving from ${servingRoot} — this is NOT the primary checkout.`;
  console.log(provenanceMsg);
  logger.info({ servingRoot, isManager, isPrimary }, provenanceMsg);
}

// Track 1110 Phase 2, Task 6: exclusivity independent of the pidfile
// bin/lc.mjs's start/stop read and write — confirmed live, twice, that a
// pidfile alone isn't enough (see conductor/tracks/1110-*/plan.md). The
// lock must be acquired and held HERE, by the long-running process
// itself, not by `lc worker start` (which spawns detached and exits
// almost immediately, so it can't hold anything for "the process's
// entire lifetime"). Skippable via LC_SKIP_WORKER_LOCK for tests that
// deliberately run multiple instances under the same identity to
// reproduce OTHER bugs (e.g. track 1110's own claim-race repro) — none of
// those tests are exercising this lock itself.
if (!process.env.LC_SKIP_WORKER_LOCK) {
  // Resolve the PRIMARY checkout, not just process.cwd() — a worker
  // process can be spawned with cwd inside a linked worktree (or any cwd
  // other than the primary checkout). Since the lock path is derived from
  // cwd, two processes meant to hold the SAME identity's lock could
  // compute DIFFERENT lock paths and never actually collide — silently
  // defeating this exact exclusivity guard (confirmed live 2026-08-17:
  // 4 simultaneous default-identity `--sync-only` processes, none
  // matching the tracked pidfile, none refusing to start). Same fix
  // pattern as createWorktree/removeWorktree above.
  const repoRootForLock = isManager ? null : resolvePrimaryRepoRoot(process.cwd());
  const lockDir = isManager
    ? join(os.homedir(), '.laneconductor')
    : join(repoRootForLock, 'conductor');
  const lockPath = isManager
    ? join(lockDir, 'manager.lock-target')
    : join(lockDir, workerNumber === 1 ? '.sync.lock-target' : `.sync-${workerNumber}.lock-target`);
  // LC_WORKER_LOCK_STALE_MS: test-only override (default stays
  // worker-lock.mjs's own DEFAULT_STALE_MS) so a SIGKILL-recovery test
  // doesn't have to wait out the full production staleness window.
  const staleMsOverride = process.env.LC_WORKER_LOCK_STALE_MS ? parseInt(process.env.LC_WORKER_LOCK_STALE_MS, 10) : undefined;
  // Track 1117 Bug 4: on a compromised lock (background refresh failed),
  // de-register from the collector before exiting — same clean shutdown the
  // SIGTERM/SIGINT handlers use — rather than falling through to the
  // generic uncaughtException handler's undifferentiated exit.
  const release = await acquireWorkerLock(lockPath, {
    ...(staleMsOverride ? { staleMs: staleMsOverride } : {}),
    onCompromised: (err) => {
      console.error(`[worker-lock] Lock compromised (${err.message}) — de-registering and exiting cleanly.`);
      removeWorker().finally(() => process.exit(1));
    },
  });
  if (!release) {
    console.error(`[LaneConductor] Another live worker already holds this identity's lock (${lockPath}) — refusing to start a duplicate.`);
    process.exit(1);
  }
}

// Track 1084 Phase 3: this worker's own DB id, learned from the
// /worker/register response — needed to ask /claimable-tracks "which queued
// tracks may I claim" during auto-launch. Null until the first successful
// registration (e.g. local-fs mode, where there's no DB/registration at all).
let myWorkerId = null;
let hasReconciledOrphanedDispatches = false;

// Track 1084 Phase 8 (2026-08-17 incident): heartbeat and dispatch-polling
// turned out to have fully independent success conditions.
// updateWorkerHeartbeat() upserts by (hostname, project_id, worker_number)
// server-side and never reads myWorkerId at all; checkDispatchInbox()
// silently no-ops on every single cycle — no log line, no error — for as
// long as myWorkerId stays null. A worker whose /worker/register call
// never resolved (observed live: two processes racing to register under
// the same identity after a duplicate start) therefore looked completely
// healthy — idle, heartbeating on schedule, visible in the UI — while
// never serving a single dispatch, discovered only because a track
// visibly got stuck in `queue` with no explanation anywhere.
const workerStartedAt = Date.now();
let workerIdResolvedLoggedStale = false;

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const HARDCODED_DEFAULTS = {
  mode: 'local-fs',
  project: {
    name: basename(process.cwd()),
    repo_path: process.cwd(),
    primary: { cli: 'claude', model: null }
  },
  collectors: [],
  ui: { port: 8090 }
};

let config = HARDCODED_DEFAULTS;
const defaultsPath = 'conductor/defaults.json';
if (existsSync(defaultsPath)) {
  try {
    const fileDefaults = JSON.parse(readFileSync(defaultsPath, 'utf8'));
    config = { ...HARDCODED_DEFAULTS, ...fileDefaults };
    if (fileDefaults.project) config.project = { ...HARDCODED_DEFAULTS.project, ...fileDefaults.project };
    if (fileDefaults.ui) config.ui = { ...HARDCODED_DEFAULTS.ui, ...fileDefaults.ui };
  } catch (err) {
    console.warn('[config] Failed to parse conductor/defaults.json:', err.message);
  }
}

if (existsSync('.laneconductor.json')) {
  try {
    const userConfig = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
    config = {
      ...config,
      ...userConfig,
      project: { ...config.project, ...userConfig.project },
      ui: { ...config.ui, ...userConfig.ui },
      worker: { ...config.worker, ...userConfig.worker }
    };
  } catch (err) {
    console.warn('[config] Failed to parse .laneconductor.json, using defaults:', err.message);
  }
} else {
  const p = config.project.primary;
  console.log(`[config] .laneconductor.json not found, using mode "${config.mode}" with ${p.cli}${p.model ? '/' + p.model : ' (default model)'}`);
}

// Track 10011: --cli/--model let a single `lc start` invocation run a
// different provider than the project's configured default — this worker
// instance's own choice, not a change to the project default, so it's
// applied in-memory only and never written back to .laneconductor.json.
const cliArgIdx = process.argv.indexOf('--cli');
const cliOverride = cliArgIdx !== -1 ? normalizeProviderId(process.argv[cliArgIdx + 1]) : null;
const modelArgIdx = process.argv.indexOf('--model');
const modelOverride = modelArgIdx !== -1 ? process.argv[modelArgIdx + 1] : null;
if (cliOverride || modelOverride) {
  config.project.primary = {
    ...config.project.primary,
    ...(cliOverride ? { cli: cliOverride } : {}),
    ...(modelOverride ? { model: modelOverride } : {}),
  };
}

// Use current config values (re-evaluated on reload)
const getProject = () => config.project;
const getCollectors = () => {
  const collectors = config.collectors || [];
  // Filter out disabled collectors (enabled defaults to true if not specified)
  return collectors.filter(c => c.enabled !== false);
};
const getUi = () => config.ui;
const getWorktreeLifecycle = () => getProject().worktree_lifecycle ?? 'per-cycle';
const getWorkerModeConfig = () => config.worker?.mode ?? 'sync+poll';
// Track 1112 Phase 3/5: optional `git` block in .laneconductor.json —
// fetch_interval_ms (Phase 5), auto_pull (Phase 5), reconcile_worktrees
// (Phase 3). Absent means default; see spec.md's Configuration section.
const getGitConfig = () => config.git ?? {};

// Resolve worker mode: CLI flag overrides config, config defaults to 'sync+poll'
if (!workerMode) {
  const configMode = getWorkerModeConfig();
  workerMode = configMode === 'sync-only' ? 'sync-only' : 'sync+poll';
}
// Track 1109: a scoped run implies polling. Without this, a project whose
// .laneconductor.json sets worker.mode: 'sync-only' (track 1042) would
// accept --only-tracks and then never claim anything — the worst outcome,
// since it looks like the allowlist is broken rather than like the mode is
// wrong. Explicit --sync-only alongside it is rejected above; this only
// overrides the *config* default.
if (onlyTracks && workerMode === 'sync-only') {
  console.log('[LaneConductor] --only-tracks given: overriding configured sync-only mode to sync+poll for this run (a sync-only worker never polls the queue).');
  workerMode = 'sync+poll';
}
const syncOnly = workerMode === 'sync-only';

// ── Scaffolding ───────────────────────────────────────────────────────────────

function ensureFile(target, source) {
  if (!existsSync(target) && existsSync(source)) {
    console.log(`[scaffold] ${target} missing, creating from ${source}...`);
    writeFileSync(target, readFileSync(source));
  }
}

function ensureScaffold() {
  if (!existsSync('conductor/tracks')) mkdirSync('conductor/tracks', { recursive: true });
  ensureFile('conductor/workflow.md', 'conductor/default-workflow.md');
  // Initialize tracks-metadata.json if missing
  if (!existsSync('conductor/tracks-metadata.json')) {
    writeFileSync('conductor/tracks-metadata.json', '{}');
  }
}

ensureScaffold();

// ── Mode detection ────────────────────────────────────────────────────────────
// 'local-fs'  — no API/DB, pure filesystem (great for offline / testing)
// 'local-api' — local Collector at localhost:8091 + local Postgres
// 'remote-api'— remote Collector (laneconductor.io or self-hosted)
const getMode = () => {
  if (config.mode) return config.mode;
  if (!config.collectors?.length) return 'local-fs';
  const u = config.collectors[0]?.url ?? '';
  return (u.includes('localhost') || u.includes('127.0.0.1')) ? 'local-api' : 'remote-api';
};

const getIsLocalFs = () => getMode() === 'local-fs';

// ── Quality Gate detection ────────────────────────────────────────────────────
// Check if quality-gate lane is enabled in workflow.json
function isQualityGateEnabled() {
  try {
    if (!existsSync('conductor/workflow.json')) return false;
    const workflow = JSON.parse(readFileSync('conductor/workflow.json', 'utf8'));
    return workflow.lanes?.['quality-gate'] !== undefined;
  } catch {
    return false;
  }
}

// ── Track 1099: Dynamic model discovery ─────────────────────────────────────
// Workers probe their installed CLI to discover available models at startup and
// every 30 minutes. The result is included in every heartbeat so the UI can
// show worker-specific model lists instead of global hardcoded presets.

let cachedModels = null; // null = not yet discovered or CLI doesn't support listing

const execAsync = promisify(exec);

// Guards the plain-text CLI-output fallbacks below. There is no real
// `claude models list` subcommand (confirmed live 2026-08-12: it exits 0
// and returns a conversational reply from Claude itself, since the CLI
// interprets the unrecognized subcommand as a prompt) — without this,
// each line of that prose gets treated as a "model id", and garbage like
// full sentences ends up stored in available_models and offered as
// selectable options in the model picker. A real model id is a short,
// single token: letters/digits/dots/hyphens only, no spaces or
// punctuation.
function looksLikeModelId(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 60 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s);
}

/**
 * Run a CLI-specific command to list available models.
 * Returns [{id, label}] on success, null on any failure.
 * Times out after 10 seconds. Uses the async child_process.exec (not
 * execSync) deliberately — execSync blocks the entire Node event loop for
 * its whole duration, which stalled every other in-flight worker
 * operation (heartbeats, dispatch polling) for as long as each CLI probe
 * took, regardless of whether the *caller* awaited discoverAvailableModels
 * or not (calling an async function still runs its body synchronously up
 * to the first await — with execSync there was no such point). Bug found
 * and fixed 2026-08-12, track 1091 Phase 5 verification: worker startup
 * was blocked 15-20s by this, and it re-blocked the event loop by the
 * same amount every 30-minute refresh after that.
 */
async function discoverAvailableModels(cli) {
  // A legacy `.laneconductor.json` may still say 'agy' — normalize before
  // dispatching so it discovers Antigravity's models, not nothing.
  cli = normalizeProviderId(cli);
  const TIMEOUT_MS = 10_000;
  try {
    let stdout = '';
    if (cli === 'claude') {
      // Try JSON format first, fall back to plain text
      try {
        ({ stdout } = await execAsync('claude models list --json 2>/dev/null', { timeout: TIMEOUT_MS, encoding: 'utf8' }));
        const parsed = JSON.parse(stdout);
        // Claude JSON: array of strings or [{id}] objects
        if (Array.isArray(parsed)) {
          return parsed.map(m => {
            const id = typeof m === 'string' ? m : (m.id || m.name || String(m));
            return { id, label: id };
          }).filter(m => m.id);
        }
      } catch {
        // Try plain text listing
        try {
          ({ stdout } = await execAsync('claude models list 2>/dev/null', { timeout: TIMEOUT_MS, encoding: 'utf8' }));
          const lines = stdout.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && looksLikeModelId(l));
          if (lines.length > 0) return lines.map(id => ({ id, label: id }));
        } catch { /* not available */ }
      }

      // Deliberately no agy-models fallback here: agy (Antigravity) is a
      // different provider with its own proxy catalog and its own naming
      // for the Claude models it routes to (e.g. 'claude-sonnet-4-6') —
      // those labels are Antigravity's, not Anthropic's, and are not
      // guaranteed to be valid model ids for the real `claude` CLI/API.
      // Filtering its output for a 'claude-' prefix and relabeling it as
      // "the claude CLI's available models" silently borrowed a different
      // vendor's catalog, which is how a real, directly-available model
      // (Haiku) went missing from discovery: Antigravity's catalog just
      // doesn't carry it. Return null instead and let refreshModels() fall
      // back to the static PROVIDERS preset, same as any other discovery
      // failure.
    } else if (cli === 'gemini') {
      // Try direct gemini CLI command first
      try {
        ({ stdout } = await execAsync(
          'npx @google/gemini-cli -p "List the available Gemini model IDs as a plain newline-separated list, no commentary" 2>/dev/null',
          { timeout: TIMEOUT_MS, encoding: 'utf8' }
        ));
        // Plain text: look for lines that are themselves a bare model id
        // (not `.includes('gemini-')` — a conversational reply could
        // easily contain that substring without being a model list).
        const lines = stdout.split('\n')
          .map(l => l.trim().split(/\s+/)[0])
          .filter(id => looksLikeModelId(id) && id.startsWith('gemini-'));
        if (lines.length > 0) return lines.map(id => ({ id, label: id }));
      } catch { /* ignore and try fallback */ }

      // Also support fetching Gemini models from agy models if gemini CLI command fails
      try {
        ({ stdout } = await execAsync('agy models < /dev/null 2>/dev/null', { timeout: TIMEOUT_MS, encoding: 'utf8' }));
        const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const geminiFromAgy = lines.map(l => {
            const tokens = l.split(/\s+/);
            const id = tokens[0];
            const label = tokens.slice(1).join(' ') || id;
            return { id, label };
          }).filter(m => looksLikeModelId(m.id) && m.id.startsWith('gemini-'));
          if (geminiFromAgy.length > 0) return geminiFromAgy;
        }
      } catch { /* ignore */ }
    } else if (cli === 'antigravity') {
      try {
        ({ stdout } = await execAsync('agy models < /dev/null 2>/dev/null', { timeout: TIMEOUT_MS, encoding: 'utf8' }));
        try {
          const parsed = JSON.parse(stdout);
          const models = Array.isArray(parsed) ? parsed : (parsed.models || []);
          return models.map(m => {
            const id = typeof m === 'string' ? m : (m.id || m.name || String(m));
            return { id, label: id };
          }).filter(m => m.id);
        } catch {
          const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
          const parsed = lines.map(l => {
            const tokens = l.split(/\s+/);
            const id = tokens[0];
            const label = tokens.slice(1).join(' ') || id;
            return { id, label };
          }).filter(m => looksLikeModelId(m.id));
          if (parsed.length > 0) return parsed;
        }
      } catch { /* not available */ }
    }
    // copilot: no standard listing command — return null
    return null;
  } catch (err) {
    // Any unexpected error: silently return null (fall back to UI presets)
    return null;
  }
}

async function refreshModels() {
  const clis = PROVIDER_IDS.filter(id => id !== 'copilot'); // no standard listing command for copilot
  const newCached = {};
  for (const cli of clis) {
    const discovered = (await discoverAvailableModels(cli)) || [];
    const presets = PROVIDERS[cli]?.models || [];

    // Track 1117 Bug 3: presets are a FALLBACK for when discovery itself
    // failed/returned nothing — not a permanent overlay on a successful
    // result. A successful discovery that omits an id is itself the signal
    // that model is gone; unconditionally re-adding it back overrode that
    // signal (see model-discovery-merge.mjs).
    const combined = mergeDiscoveredWithPresets(discovered, presets);

    if (combined.length > 0) {
      newCached[cli] = combined;
      logger.info({ cli, count: combined.length }, `[models] Loaded model list for ${cli}`);
    }
  }
  if (Object.keys(newCached).length > 0) {
    cachedModels = newCached;
  }

  // Track 1111 Phase 5 (REQ-5): re-check workflow.json's configured
  // per-lane models against what's actually discovered every time that
  // discovery refreshes (worker startup, then every 30 minutes) — the
  // minimum-viable "surfaced somewhere a human will actually see it"
  // version is this log line; a UI badge is a possible follow-up, not
  // built here (see plan.md Phase 5 Task 1).
  try {
    const staleEntries = findStaleLaneModels({ workflowConfig, proj: getProject(), cachedModels });
    for (const entry of staleEntries) {
      logger.warn(entry, formatStaleLaneModelWarning(entry));
    }

    // Track 1111 Phase 6 (REQ-6): opt-in, same-tier-only auto-update.
    // Default OFF — only runs when this project's own workflow.json sets
    // `global.auto_update_stale_models: true`. Never a silent rewrite: a
    // git commit is made alongside the file write, so the change is
    // visible in workflow.json's own history.
    maybeAutoUpdateWorkflowModels({
      workflowConfig, staleEntries,
      writeFile: (content) => writeFileSync('conductor/workflow.json', content),
      commit: (message) => {
        try {
          execSync('git add conductor/workflow.json', { cwd: process.cwd(), stdio: 'pipe' });
          execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: process.cwd(), stdio: 'pipe' });
        } catch (err) {
          logger.warn({ err: err.message }, '[workflow] auto-update commit failed');
        }
      },
      logInfo: (applied, summary) => logger.info({ applied }, `[workflow] auto-updated stale primary_model: ${summary}`),
    });
  } catch (err) {
    logger.warn({ err: err.message }, '[workflow] stale-model check failed');
  }

  // Schedule next refresh in 30 minutes
  setTimeout(refreshModels, 30 * 60 * 1000);
}

// ── Collector HTTP client ─────────────────────────────────────────────────────

async function get(collectorUrl, token, path, timeoutMs = 10000) {
  if (!collectorUrl) return {};
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);

    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await r.text();
      throw new Error(`Expected JSON, got ${contentType}: ${text.substring(0, 100)}`);
    }
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Fetch timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

async function post(collectorUrl, token, path, body, timeoutMs = 15000) {
  if (!collectorUrl) return {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;
  console.log(`[debug] POST ${url}`, JSON.stringify(body));

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`POST timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

async function patch(collectorUrl, token, path, body, timeoutMs = 15000) {
  if (!collectorUrl) return {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;
  console.log(`[debug] PATCH ${url}`, JSON.stringify(body));

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`PATCH timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

async function del(collectorUrl, token, path, body = {}, timeoutMs = 10000) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`DELETE timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

/**
 * Execute Integration Hooks defined in workflow.json
 * @param {string} trackNumber 
 * @param {string} lane 
 * @param {'success'|'failure'} eventType 
 */
async function executeIntegrationHooks(trackNumber, lane, eventType) {
  try {
    const workflowPath = 'conductor/workflow.json';
    if (!existsSync(workflowPath)) return;
    const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
    const laneConfig = workflow.lanes?.[lane];
    if (!laneConfig || !laneConfig.hooks) return;

    const hooks = laneConfig.hooks.filter(h => h.on === eventType);
    if (hooks.length === 0) return;

    // Use project ID from config or metadata (required for proxy call)
    const projectId = getProject()?.id;
    if (!projectId) {
      console.warn(`[hooks] Cannot trigger hooks for track ${trackNumber}: No project ID found in config`);
      return;
    }

    for (const hook of hooks) {
      console.log(`[hooks] Executing ${hook.provider} hook for track ${trackNumber} (${eventType})`);
      
      let bodyText = hook.body || '';
      // Simple variable replacement for common metadata
      bodyText = bodyText
        .replace(/{{track}}/g, trackNumber)
        .replace(/{{lane}}/g, lane)
        .replace(/{{event}}/g, eventType);

      // Handle Jira hooks locally using the polling collector approach
      if (hook.provider === 'jira') {
        const jiraConfig = readJiraConfig(getCollectors());
        if (!jiraConfig) {
          console.warn(`[hooks] Skipping Jira hook for ${trackNumber}: No Jira collector configured in .laneconductor.json`);
          continue;
        }

        const metadata = loadTracksMetadata();
        const trackMeta = metadata[trackNumber];
        if (!trackMeta?.jira_key) {
          console.warn(`[hooks] Skipping Jira hook for ${trackNumber}: Track not linked to a Jira issue`);
          continue;
        }

        if (hook.action === 'comment') {
          // Push comment directly via Jira config
          try {
            const success = await pushCommentToJira(jiraConfig, trackMeta.jira_key, bodyText);
            if (success) {
              console.log(`[hooks] Pushed Jira comment to ${trackMeta.jira_key}`);
            }
          } catch (err) {
            console.error(`[hooks error] Jira direct push failed:`, err.message);
          }
        }
        continue;
      }

      // Call the Integration Proxy on the API (Legacy approach for other providers)
      // The API will inject the secrets and forward to the provider
      const proxyPath = `/v1/projects/${projectId}/integrations/${hook.provider}/proxy`;
      
      const payload = {
        path: hook.path || `/rest/api/2/issue/${trackNumber}/comment`,
        method: hook.method || 'POST',
        body: hook.action === 'comment' ? { body: bodyText } : hook.payload
      };

      await postToCollectors(proxyPath, payload).catch(err => {
        console.error(`[hooks error] ${hook.provider} proxy call failed:`, err.message);
      });
    }
  } catch (err) {
    console.error(`[hooks error] Error in executeIntegrationHooks:`, err.message);
  }
}

// ── Per-worker machine tokens ────────────────────────────────────────────────
// A machine_token identifies ONE worker row. It must therefore never live in
// `.laneconductor.json`, which every worker process of a project shares:
// registration used to write each worker's token there, so the last worker to
// register overwrote the others', and the config watcher then pushed that one
// token into every running process. All of them subsequently authenticated as
// whichever worker registered last, and `req.worker_id` on the server
// collapsed to that single identity.
//
// The visible damage was session cross-contamination: `GET /track/:num/session`
// is scoped by (track_number, worker_id), so a worker asking for *its* session
// got a different worker's, and `--resume`d that worker's already-finished
// session. Live case (track 182, aitutor, 2026-08-14): worker #2 resumed
// worker #3's completed planning session and re-emitted byte-identical
// plan.md/spec.md, silently ignoring the human comment that prompted the
// re-run — it looked like "the agent ignored me", not like an auth bug.
//
// Tokens now live in a per-worker file that no other worker writes, and the
// in-memory copy is authoritative so a config reload can never reassign this
// process's identity.
const workerTokenStorePath = join('conductor', workerNumber === 1 ? '.worker.tokens.json' : `.worker-${workerNumber}.tokens.json`);
const ownMachineTokens = new Map(); // collector url -> this worker's machine_token

function loadOwnMachineTokens() {
  try {
    if (!existsSync(workerTokenStorePath)) return;
    const stored = JSON.parse(readFileSync(workerTokenStorePath, 'utf8'));
    for (const [url, tok] of Object.entries(stored)) {
      if (typeof tok === 'string' && tok) ownMachineTokens.set(url, tok);
    }
  } catch (err) {
    console.warn(`[worker-token] Could not read ${workerTokenStorePath} (will re-register): ${err.message}`);
  }
}

function rememberOwnMachineToken(url, token) {
  if (!url || !token || ownMachineTokens.get(url) === token) return;
  ownMachineTokens.set(url, token);
  try {
    mkdirSync('conductor', { recursive: true });
    writeFileSync(workerTokenStorePath, JSON.stringify(Object.fromEntries(ownMachineTokens), null, 2) + '\n');
  } catch (err) {
    // Non-fatal: the in-memory token still works for this process's lifetime.
    console.warn(`[worker-token] Could not persist ${workerTokenStorePath}: ${err.message}`);
  }
}

loadOwnMachineTokens();

// Resolve auth token for a collector entry (handles GCP Secret Manager, env, and machine tokens)
function resolveToken(collector, envKey) {
  // 1. Try environment variable override
  if (process.env[envKey]) return process.env[envKey];

  // 1b. This worker's OWN machine token wins over anything in the shared
  // config — see the comment above rememberOwnMachineToken.
  const own = collector.url ? ownMachineTokens.get(collector.url) : null;
  if (own) return own;

  // 2. Try GCP Secret Manager if configured
  if (collector.store_type === 'gcp-secret' && collector.secret_name) {
    try {
      // Build gcloud command with project context
      const gcpProject = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      const projectFlag = gcpProject ? `--project="${gcpProject}"` : '';
      const cmd = `gcloud secrets versions access latest --secret="${collector.secret_name}" ${projectFlag}`.trim();

      const secret = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 // 1MB buffer
      });

      if (secret) {
        return secret.trim();
      }
    } catch (e) {
      // Silent fallback - don't log GCP details in production
    }
  }

  // 3. Fallback to machine token or inline token (for local-api mode).
  // A config-file machine_token is only trustworthy as *this* worker's
  // identity for worker #1: pre-fix configs stored a single token there, and
  // for a one-worker project it is that worker's own. For any additional
  // worker it definitionally belongs to someone else, so using it would
  // re-create the impersonation this store exists to prevent — register
  // anonymously instead and adopt the token the server hands back.
  if (workerNumber === 1 && collector.machine_token) return collector.machine_token;
  return collector.token ?? null;
}

// Post to ALL collectors. Primary (index 0) is awaited; rest are fire-and-forget.
async function postToCollectors(path, body) {
  if (getIsLocalFs()) return {};
  const cls = getCollectors();
  if (!cls.length) throw new Error('No collectors configured');
  const [primary, ...rest] = cls;
  const token0 = resolveToken(primary, 'COLLECTOR_0_TOKEN');
  const result = await post(primary.url, token0, path, body);
  for (let i = 0; i < rest.length; i++) {
    const token = resolveToken(rest[i], `COLLECTOR_${i + 1}_TOKEN`);
    post(rest[i].url, token, path, body).catch(e =>
      console.warn(`[collector-${i + 1}] write failed:`, e.message)
    );
  }
  return result;
}

async function patchCollectors(path, body) {
  if (getIsLocalFs()) return;
  const cls = getCollectors();
  if (!cls.length) return;
  const [primary, ...rest] = cls;
  const token0 = resolveToken(primary, 'COLLECTOR_0_TOKEN');
  const result = await patch(primary.url, token0, path, body);
  for (let i = 0; i < rest.length; i++) {
    const token = resolveToken(rest[i], `COLLECTOR_${i + 1}_TOKEN`);
    patch(rest[i].url, token, path, body).catch(e =>
      console.warn(`[collector-${i + 1}] patch failed:`, e.message)
    );
  }
  return result;
}

// Primary collector only (orchestration queries — local only)
// Returns { url: null, token: null } in local-fs mode — all HTTP calls will be no-ops
const tokenCache = new Map();

function resolveCollectorToken(idx) {
  const c = getCollectors()[idx];
  if (!c) return null;

  // 1. Env override COLLECTOR_n_TOKEN
  if (process.env[`COLLECTOR_${idx}_TOKEN`]) return process.env[`COLLECTOR_${idx}_TOKEN`];

  // 1b. This worker's OWN machine token (see rememberOwnMachineToken) — must
  // outrank both the cache and the shared config, or this process can end up
  // authenticating as a different worker.
  const own = c.url ? ownMachineTokens.get(c.url) : null;
  if (own) return own;

  // 2. Cache
  if (tokenCache.has(idx)) return tokenCache.get(idx);

  // 3. GCP Secret Manager if configured
  if (c.store_type === 'gcp-secret' && c.secret_name) {
    try {
      // Build gcloud command with project context (same as resolveToken)
      const gcpProject = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      const projectFlag = gcpProject ? `--project="${gcpProject}"` : '';
      const cmd = `gcloud secrets versions access latest --secret="${c.secret_name}" ${projectFlag}`.trim();

      const token = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 // 1MB buffer
      }).trim();

      if (token) {
        tokenCache.set(idx, token);
        return token;
      }
    } catch (e) {
      // Silent fallback - don't log GCP details in production
    }
  }

  // 4. machine_token from the shared config — only ever this worker's own
  // identity for worker #1 (see resolveToken for the full reasoning).
  if (workerNumber === 1 && c.machine_token) return c.machine_token;

  // 5. auth file token (~/.laneconductor-auth.json)
  const userToken = getUserToken();
  if (userToken) return userToken;

  // 6. Hardcoded token in config
  return c.token || null;
}

function primaryCollector() {
  if (getIsLocalFs()) return { url: null, token: null };
  const c = getCollectors()[0];
  if (!c) return { url: null, token: null };
  return { url: c.url, token: resolveCollectorToken(0) };
}

// ── Worker registration ───────────────────────────────────────────────────────

const hostname = os.hostname();
const pid = process.pid;

function getUserToken() {
  const authFile = join(os.homedir(), '.laneconductor-auth.json');
  if (existsSync(authFile)) {
    try {
      const authData = JSON.parse(readFileSync(authFile, 'utf8'));
      return authData.token || null;
    } catch (e) {
      console.warn('[Warning] Failed to read ~/.laneconductor-auth.json', e.message);
    }
  }
  return null;
}

async function upsertWorker() {
  if (getIsLocalFs()) return;
  const cls = getCollectors();
  const proj = getProject();

  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    const url = c.url;
    if (!url) continue; // Skip collectors without URL (e.g. Jira)
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    const token = resolveCollectorToken(i);

    try {
      // Track 1091 Phase 2: a manager worker isn't "for" this (or any)
      // project — skip /project/ensure entirely (nothing to ensure) and
      // register with project_id: null, type: 'manager'.
      let project_id = null;
      if (!isManager) {
        // Ensure project exists on collector and map to our user identity
        const ensureRes = await post(url, token, '/project/ensure', {
          git_remote: proj.git_remote,
          name: proj.name,
          repo_path: proj.repo_path,
          primary_cli: proj.primary?.cli,
          primary_model: proj.primary?.model,
          dev_command: proj.dev?.command ?? null,
          dev_url: proj.dev?.url ?? null,
        }).catch(e => {
          // console.warn(`[Warning] /project/ensure failed for ${url}:`, e.message);
          return {};
        });

        project_id = ensureRes.project_id || proj.id;
        if (project_id && proj.id !== project_id) {
          proj.id = project_id;
          writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
        }
      }

      const primary = proj.primary || { cli: 'claude', model: null };
      const visibility = proj.worker?.visibility || config.worker?.visibility || 'private';
      const registerBody = {
        hostname,
        pid,
        project_id,
        visibility,
        mode: workerMode,
        worker_number: workerNumber,
        cli: primary.cli || 'claude',
        model: primary.model || null,
        available_models: cachedModels || undefined
      };
      if (isManager) registerBody.type = 'manager';
      const res = await post(url, token, '/worker/register', registerBody);

      if (res.id) myWorkerId = res.id;

      if (!hasReconciledOrphanedDispatches && myWorkerId) {
        hasReconciledOrphanedDispatches = true;
        reconcileOrphanedDispatches().catch(err => console.error('[orphan-reconcile error]:', err.message));
      }

      // Store the returned machine token for next beats — in this worker's
      // OWN store, never in the shared `.laneconductor.json`. Writing it to
      // the shared config is what made every worker of a project authenticate
      // as whichever one registered last (see rememberOwnMachineToken).
      if (res.machine_token) rememberOwnMachineToken(url, res.machine_token);

      console.log(`[LaneConductor] Worker registered to ${url}: ${hostname} (PID: ${pid}) [${workerMode}]`);
      if (proj.id) notifyApi('worker:updated', { projectId: proj.id });
    } catch (err) {
      console.error(`[worker error] registration failed for ${url}:`, err.message);
    }
  }
}

const TASK_UNCHANGED = Symbol('TASK_UNCHANGED');

// Track 1112 Phase 7: compact worktree inventory reported on the heartbeat
// — same shape as `lc worktrees --json` (D-6: the heartbeat is just a
// transport for state that lives at the shared repo checkout's cwd, not a
// per-worker-owned resource). Recomputed on a slower cadence than the
// heartbeat itself (git-shelling-out on every 10s beat would be wasteful);
// cached and attached to whichever heartbeat fires next.
let cachedWorktreeSummary = null;
async function refreshWorktreeSummaryCache() {
  if (getIsLocalFs()) return; // nothing to report — no heartbeat is sent in this mode anyway
  try {
    const mainBranch = getMainBranch();
    const rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch });
    // Track 1114 (found live): "if they don't have a worktree they
    // shouldn't appear in Worktrees" — a plain `open` row with no live
    // worktree is an abandoned branch, not active work. `stranded` is the
    // deliberate exception (always worktree-less by definition — the
    // orphaned-but-ready-to-merge case this panel exists to surface).
    cachedWorktreeSummary = rows.filter(r => belongsInWorktreesPanel({ hasWorktree: r.hasWorktree, classification: r.classification })).map(r => ({
      track: r.trackNumber, title: r.title, lane: r.lane, lane_status: r.laneStatus,
      ahead: r.ahead, behind: r.behind, dirty: r.dirtyCount, class: r.classification,
      // Track 1114: needed to identify/remove a specific worktree —
      // detached rows have no `track` number at all, so branch/path are
      // the only handles available for them.
      branch: r.branch, worktree_path: r.worktreePath,
      // Track 10018: merge mode + PR fields, same snake_case convention as
      // the rest of this row shape.
      merge_mode: r.mergeMode, pr_number: r.prNumber, pr_url: r.prUrl, pr_status: r.prStatus,
      // Track 1114 Phase 18a: auditWorktrees() already computes this to
      // decide the `conflicted` classification (Phase 17) — was discarded
      // right after. Only ever non-empty when class is 'conflicted'.
      conflict_paths: r.conflictPaths ?? [],
    }));
  } catch (err) {
    console.error('[worktree-summary error]:', err.message);
  }
}
// Track 1114 (found live in the actual log — 3 occurrences, one per
// worker restart this session): calling this synchronously here throws
// "Cannot access 'cachedMainBranch' before initialization" every time,
// silently (caught below, only logged) — `getMainBranch()` reads a `let`
// declared much later in this file (line ~3132), and since the whole
// file is one module evaluated top-to-bottom, this immediate call always
// fires before the module has reached that declaration. The cache stays
// unpopulated until the NEXT scheduled tick (60s later), meaning every
// restart runs on stale/empty worktree data for up to a minute despite
// the comment's own intent ("not 60s late"). A deferred macrotask lets
// the module finish evaluating first — cachedMainBranch is long since
// initialized by the time this actually runs, and it still fires
// essentially immediately, achieving the original intent for real.
setTimeout(() => { refreshWorktreeSummaryCache(); }, 0);
setInterval(() => { refreshWorktreeSummaryCache(); }, 60000);

async function updateWorkerHeartbeat(status = null, task = TASK_UNCHANGED) {
  if (getIsLocalFs()) return;
  const cls = getCollectors();
  const proj = getProject();
  if (!cls.length) return;

  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (!c.url) continue;
    try {
      const token = resolveCollectorToken(i);
      // Track 1091: a manager's own project_id is always null (mirrors the
      // same isManager check in upsertWorker's registration) — sending
      // proj.id unconditionally here sent whatever stale/default project
      // block happens to be in a manager's .laneconductor.json, which
      // never matches the manager's actual (project_id IS NULL) row,
      // silently updating zero rows every heartbeat.
      const primary = proj.primary || { cli: 'claude', model: null };
      const body = {
        hostname,
        pid,
        project_id: isManager ? null : proj.id,
        mode: workerMode,
        worker_number: workerNumber,
        cli: primary.cli || 'claude',
        model: primary.model || null,
        available_models: cachedModels || undefined,
        // Track 1114 (found live): cachedWorktreeSummary starts as `null`
        // at process boot, not `undefined` — the server's heartbeat
        // handler only skips updating the column `if (worktrees !==
        // undefined)`, and `null !== undefined` is true. That meant the
        // FIRST heartbeat after every worker restart — sent before the
        // async git-audit (refreshWorktreeSummaryCache) finishes —
        // explicitly overwrote a perfectly good cached value with `null`,
        // producing a real but pointless "No Unmerged Worktrees" gap on
        // every restart. This is persisted state, not per-process
        // scratch — no reason a restart should ever blank it.
        worktrees: (isManager || cachedWorktreeSummary === null) ? undefined : cachedWorktreeSummary,
      };
      if (status) body.status = status;
      if (task !== TASK_UNCHANGED) body.current_task = task;
      await patch(c.url, token, '/worker/heartbeat', body);
      // console.log(`[heartbeat] worker beat sent to ${c.url}: ${hostname}:${pid}`);
    } catch (err) {
      console.error(`[worker heartbeat error] ${c.url}: ${err.message}`);
      if (err.message.includes('401') || err.message.includes('404')) {
        // Re-register if token is invalid or worker not found
        upsertWorker().catch(() => { });
      }
    }
  }
  notifyApi('worker:updated', { projectId: proj.id });
}

async function removeWorker() {
  if (getIsLocalFs()) return;
  const cls = getCollectors();
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (!c.url) continue;
    try {
      const token = resolveCollectorToken(i);
      await del(c.url, token, '/worker', { hostname, pid, worker_number: workerNumber });
      console.log(`[LaneConductor] Worker de-registered from ${c.url}: ${hostname} (PID: ${pid})`);
    } catch (err) {
      console.error(`[worker error] de-registration failed for ${c.url}:`, err.message);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const debounceMap = new Map();
let lastConductorHash = null;
let workflowConfig = null;
const runningLaneMap = new Map(); // Maps PID -> lane_status for active processes
const runningTrackMap = new Map(); // Maps PID -> trackNumber for active processes
const providerStatusCache = new Map(); // Maps provider -> { status, reset_at, last_error }

function debounce(key, fn, ms = 250) {
  if (debounceMap.has(key)) clearTimeout(debounceMap.get(key));
  debounceMap.set(key, setTimeout(async () => {
    await fn();
    debounceMap.delete(key);
  }, ms));
}

// Bounded concurrency gate — chokidar's `{ ignoreInitial: false }` fires one
// 'add' event per pre-existing file when the worker starts, so a project with
// N tracks × ~4 files each produces ~4N near-simultaneous syncTrack() calls
// once their independent per-file debounce timers all elapse together (they
// were all armed within milliseconds of each other at startup). Without a
// cap, that thundering herd overwhelms the collector API's Postgres pool
// (Track 1076: ~400 concurrent POST /track requests against a 10-connection
// pool caused every request to queue behind the others, producing 15s+
// timeouts on every worker start/restart for any project with many tracks).
const MAX_CONCURRENT_SYNCS = 8;
let activeSyncCount = 0;
const syncWaitQueue = [];

function withConcurrencyLimit(fn) {
  return new Promise((resolveOuter, rejectOuter) => {
    const run = async () => {
      activeSyncCount++;
      try {
        resolveOuter(await fn());
      } catch (err) {
        rejectOuter(err);
      } finally {
        activeSyncCount--;
        const next = syncWaitQueue.shift();
        if (next) next();
      }
    };
    if (activeSyncCount < MAX_CONCURRENT_SYNCS) run();
    else syncWaitQueue.push(run);
  });
}

if (!existsSync('conductor/logs')) mkdirSync('conductor/logs', { recursive: true });
writeFileSync(workerNumber === 1 ? 'conductor/.sync.pid' : `conductor/.sync-${workerNumber}.pid`, String(process.pid));

function readIfExists(filepath) {
  try { return existsSync(filepath) ? readFileSync(filepath, 'utf8') : null; }
  catch { return null; }
}

// Track 1113 REQ-8 fix: the server's POST /track/:num/comment coerces any
// author outside ['human', 'system', ...PROVIDER_IDS] to 'human' — so a
// raw cli id has to actually resolve to a real provider before it reaches
// there, or an AI-authored reply silently gets misattributed to the human
// several layers away from this decision. normalizeProviderId resolves
// known aliases ('agy' -> 'antigravity'); a genuinely unrecognized cli id
// (a typo, a custom/local CLI name, anything not in PROVIDER_IDS) falls
// back to 'claude' — a valid, correctly-AI-attributed default — rather
// than silently becoming 'human'.
export function normalizeAuthorForComment(cli) {
  const normalized = normalizeProviderId(cli || 'claude');
  return PROVIDER_IDS.includes(normalized) ? normalized : 'claude';
}

function loadWorkflowConfig() {
  // 1. Try project-local workflow.json (canonical per-project source)
  if (existsSync('conductor/workflow.json')) {
    try { return stripLanePrimaryCli(JSON.parse(readFileSync('conductor/workflow.json', 'utf8'))); }
    catch (err) { console.error('[config] Failed to parse conductor/workflow.json:', err.message); }
  }

  // 2. Try canonical global workflow.json from LaneConductor repo
  const installPath = getInstallPath();
  if (installPath) {
    const globalWf = join(installPath, 'conductor', 'workflow.json');
    if (existsSync(globalWf)) {
      try { return stripLanePrimaryCli(JSON.parse(readFileSync(globalWf, 'utf8'))); }
      catch (err) { console.error('[config] Failed to parse global workflow.json:', err.message); }
    }
  }

  // 3. Fall back to embedded JSON block in workflow.md (legacy)
  const content = readIfExists('conductor/workflow.md');
  if (!content) return null;
  const match = content.match(/## Workflow Configuration\n```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return stripLanePrimaryCli(JSON.parse(match[1])); }
  catch (err) { console.error('[config] Failed to parse workflow.md config:', err.message); return null; }
}

// ── Metadata Tracking (File ↔ DB Sync) ───────────────────────────────────────

let tracksMetadata = null;

function loadTracksMetadata() {
  const metadataPath = 'conductor/tracks-metadata.json';
  try {
    if (existsSync(metadataPath)) {
      const content = readFileSync(metadataPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[metadata] Failed to load metadata:', err.message);
  }
  // Return default empty metadata
  return {
    format: '1.0',
    last_checked: new Date().toISOString(),
    tracks: {}
  };
}

function saveTracksMetadata(metadata) {
  try {
    metadata.last_checked = new Date().toISOString();
    writeFileSync('conductor/tracks-metadata.json', JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err) {
    console.error('[metadata] Failed to save metadata:', err.message);
  }
}

function getTrackMetadata(trackNumber) {
  if (!tracksMetadata) tracksMetadata = loadTracksMetadata();
  // Support both flat (legacy migration) and nested
  const meta = tracksMetadata.tracks?.[trackNumber] || tracksMetadata[trackNumber];
  return meta || null;
}

function updateTrackMetadata(trackNumber, updates) {
  if (!tracksMetadata) tracksMetadata = loadTracksMetadata();
  if (!tracksMetadata.tracks) tracksMetadata.tracks = {};
  
  // If we are updating an existing flat entry, move it to nested first
  if (tracksMetadata[trackNumber] && !tracksMetadata.tracks[trackNumber]) {
    tracksMetadata.tracks[trackNumber] = tracksMetadata[trackNumber];
    delete tracksMetadata[trackNumber];
  }

  if (!tracksMetadata.tracks[trackNumber]) {
    tracksMetadata.tracks[trackNumber] = {};
  }
  Object.assign(tracksMetadata.tracks[trackNumber], updates);
  saveTracksMetadata(tracksMetadata);
}

// Resolve which single folder represents a track number, guarding against the
// silent ambiguity that let 1052-show-hn/1052-show-hn-post and
// 9999-hook-test/9999-prod-sync-test collide onto one DB row (see track
// 1088) — the DB key is (project_id, track_number) with no folder-path
// component, so two folders sharing a numeric prefix within one project's
// own conductor/tracks/ silently fight over the same row.
//
// On ambiguity: prefer tracks-metadata.json's registered folder_path if it's
// one of the matches; otherwise fall back to the lexicographically-first
// match (deterministic, unlike readdir's OS-dependent order). Auto-fixes it
// going forward by renaming every non-canonical match with a `_duplicate-`
// prefix, which structurally can no longer match `${trackNumber}-` — so the
// ambiguity is resolved once, not silently re-risked on every future call.
// Nothing is deleted; renamed folders keep their full content and history.
// Renames a stray/stale folder aside so resolveTrackFolder's directory
// scan can never match it again. Shared by both quarantine call sites
// below (the multi-match branch, and the single-legacy-match-vs-
// registered-prefixed-folder branch added 2026-08-26).
function quarantineStaleFolder(tracksDir, staleName) {
  const from = join(tracksDir, staleName);
  const to = join(tracksDir, `_duplicate-${staleName}`);
  try {
    if (!existsSync(to)) {
      renameSync(from, to);
      console.warn(`[ambiguous-track] Quarantined duplicate folder: ${from} -> ${to}`);
    }
  } catch (err) {
    console.error(`[ambiguous-track] Failed to quarantine ${from}:`, err.message);
  }
}

function resolveTrackFolder(tracksDir, trackNumber) {
  if (!existsSync(tracksDir)) return null;
  const matches = readdirSync(tracksDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith(`${trackNumber}-`))
    .map(d => d.name)
    .sort();

  const meta = getTrackMetadata(trackNumber);
  const registered = meta?.folder_path ? basename(meta.folder_path) : null;
  const registeredExists = !!(registered && existsSync(join(tracksDir, registered)));

  // Legacy folders are named `${trackNumber}-slug`, matched above. Newer
  // tracks (since track 10023) use `INITIALS-${trackNumber}-slug`, which
  // never matches that prefix and previously made this function return
  // null for every prefixed track — breaking any dispatch path that
  // resolves the folder by track number alone (e.g. worker_dispatch
  // lane-action processing, which is also what the UI's "Run" button
  // ultimately triggers). Fall back to the registered folder_path in
  // tracks-metadata.json, which newTrack always writes correctly
  // regardless of naming convention.
  if (matches.length === 0) {
    return registeredExists ? registered : null;
  }

  // A lone legacy-pattern match is the common, unambiguous case and is
  // normally trusted immediately — EXCEPT when metadata registers a
  // DIFFERENT, currently-existing folder. That combination only arises
  // when a prefixed track (e.g. "AM-1119-...", which structurally can
  // never land in `matches` — it doesn't start with the bare
  // `${trackNumber}-` prefix) has a stale legacy-named duplicate sitting
  // next to it. Confirmed live, track 1119 (2026-08-26): trusting this
  // branch blindly fed checkAndClaimGitLock's own git-add/commit into
  // the stale, scaffolded-placeholder folder on every single dispatch,
  // repeatedly re-committing garbage ("chore(track-1119): sync files
  // before worktree" — fired 5+ times) while the real, actively-worked
  // folder sat untouched. Quarantine the stale match instead of trusting
  // it, the same way the multi-match branch below already does.
  if (matches.length === 1) {
    if (registeredExists && registered !== matches[0]) {
      quarantineStaleFolder(tracksDir, matches[0]);
      return registered;
    }
    return matches[0];
  }

  const canonical = (registeredExists && matches.includes(registered)) ? registered : matches[0];

  console.warn(`[ambiguous-track] Track ${trackNumber} matched ${matches.length} folders (${matches.join(', ')}) — using "${canonical}", quarantining the rest.`);

  for (const dupName of matches) {
    if (dupName === canonical) continue;
    quarantineStaleFolder(tracksDir, dupName);
  }

  updateTrackMetadata(trackNumber, { folder_path: join(tracksDir, canonical) });
  return canonical;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function extractLaneFromIndex(content) {
  // Extract Lane from index.md (e.g., **Lane**: done)
  const match = content.match(/\*\*Lane\*\*:\s*([a-z0-9-]+)/i);
  if (!match) return 'backlog';
  const lane = match[1].toLowerCase().trim();
  return LaneAliases[lane] || (Object.values(Lanes).includes(lane) ? lane : 'backlog');
}

function extractLaneStatusFromIndex(content) {
  // Extract Lane Status from index.md (e.g., **Lane Status**: success)
  const match = content.match(/\*\*Lane Status\*\*:\s*([a-z0-9-]+)/i);
  if (!match) return 'queue';
  const status = match[1].toLowerCase().trim();
  return ActionStatusAliases[status] || (Object.values(LaneActionStatus).includes(status) ? status : 'queue');
}

function parseLaneStatus(content) {
  const match = content.match(/\*\*Lane Status\*\*:\s*([a-z0-9-]+)/i);
  if (!match) return null;

  const value = match[1].toLowerCase().trim();

  // Map to canonical status using centralized constants
  const mapped = ActionStatusAliases[value] || (Object.values(LaneActionStatus).includes(value) ? value : null);

  if (!mapped) {
    console.warn(`[parse warning] Invalid lane_action_status value: "${value}". Valid values are: ${Object.values(LaneActionStatus).join(', ')}`);
  }

  return mapped;
}

function parseStatus(content, createQualityGate = false) {
  return parseStatusPure(content, Lanes, LaneAliases, createQualityGate);
}

// Marker-only readers — return null when the field's own explicit marker is
// absent, WITHOUT falling back to deriving a value from other content. Used
// to let index.md's own markers win over anything derived from plan.md; see
// parseProgress/parseCurrentPhase/parseSummary below and their call site
// (index.md is documented there as "the absolute authority for the track's
// state", but Progress/Phase/Summary used to silently bypass that authority
// whenever a plan.md existed — this is what actually enforces it).
function parseProgressMarker(content) {
  // [ \t]* (not \s*) after the colon — \s matches '\n' too, which would let
  // this cross a blank line into unrelated later content when the value is
  // missing. Same fix applied to parseCurrentPhaseMarker/parseSummaryMarker.
  const m = content.match(/\*\*Progress\*\*:[ \t]*(\d+)%/i);
  return m ? parseInt(m[1]) : null;
}

function parseCurrentPhaseMarker(content) {
  const m = content.match(/\*\*Phase\*\*:[ \t]*([^\n]*)/i);
  if (!m) return null;
  const value = m[1].replace(/⏳|✅/g, '').trim();
  // Phase is meant to be a short label ("Phase 6: Testing"), not a session
  // recap — but nothing stops an agent writing a full paragraph into the
  // marker, and unlike Summary this had no cap, so it flowed straight to
  // the Kanban card's phase line unbounded (track 1114 hit this live).
  return value ? truncateSummary(value) : null; // an empty marker isn't a real value — let the caller fall back
}

function parseProgress(content) {
  const marker = parseProgressMarker(content);
  if (marker !== null) return marker;

  const total = (content.match(/- \[[ x]\]/g) || []).length;
  if (total === 0) return 0;
  return Math.round(((content.match(/- \[x\]/gi) || []).length / total) * 100);
}

function parseCurrentPhase(content) {
  const marker = parseCurrentPhaseMarker(content);
  if (marker !== null) return marker;

  const match = content.match(/## Phase \d+: ([^\n⏳]+)⏳/);
  return match ? match[1].trim() : null;
}

// Truncate at a word boundary and mark truncation with an ellipsis, instead of
// a hard mid-word `.slice(n)` cut that reads as corrupted/cut-off text.
function truncateSummary(text, maxLen = 200) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

function parseSummaryMarker(content) {
  const m = content.match(/\*\*Summary\*\*:[ \t]*([^\n]*)/i);
  if (!m) return null;
  const value = m[1].trim();
  return value ? truncateSummary(value) : null; // an empty marker isn't a real value — let the caller fall back
}

function parseSummary(content) {
  const marker = parseSummaryMarker(content);
  if (marker !== null) return marker;

  // Fallback: no explicit Summary marker — derive one from a **Problem**: line.
  // Problem text is often a wrapped, multi-line paragraph (e.g. under a phase
  // heading in plan.md), so capture until a blank line, the next **marker**,
  // a heading, or end of string — not just up to the first '\n' — and collapse
  // the captured whitespace/newlines before truncating.
  const match = content.match(/\*\*Problem\*\*:\s*([\s\S]+?)(?=\n\s*\n|\n\*\*|\n#|$)/i);
  return match ? truncateSummary(match[1].replace(/\s+/g, ' ').trim()) : null;
}

function parseWaitingForReply(content) {
  const match = content.match(/\*\*Waiting for reply\*\*:\s*([^\n]+)/i);
  return match ? match[1].trim().toLowerCase() === 'yes' : false;
}

function parseAutoRun(content) {
  const match = content.match(/\*\*Auto Run\*\*:\s*([^\n]+)/i);
  return match ? match[1].trim().toLowerCase() === 'yes' : false;
}

// Track AM-1119 Phase 3 (Task 2): `**Depends On**: NNN, NNN` — comma-separated
// track numbers that must all reach lane `done` before this track's own queued
// lane action may be auto-launched. Used by the wizard's generated track set
// to gate its final "Deploy to <provider>" track behind the feature tracks
// ahead of it. Returns normalised (bare, non-zero-padded) track number
// strings; empty array when the marker is absent — "no dependencies".
function parseDependsOn(content) {
  const match = content.match(/\*\*Depends On\*\*:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/^0+(?=\d)/, '')).filter(Boolean);
}

// Track 1116 REQ-7: per-track model override, same marker convention as
// **Lane**/**Progress**/**Summary**. Mirrors parseSummaryMarker — null (not
// deriving a fallback) when the marker is absent or empty, so callers can
// tell "no override" apart from an explicitly-cleared one.
function parseModelOverrideMarker(content) {
  const m = content.match(/\*\*Model\*\*:[ \t]*([^\n]*)/i);
  if (!m) return null;
  const value = m[1].trim();
  return value || null;
}

// Track 1116 REQ-7 (provider-stays-fixed guard, mirrors stripLanePrimaryCli):
// a track's index.md was never meant to carry a provider override — there's
// no marker table entry for one — but if a stray `**Provider**:` marker
// shows up anyway (hand-edited file, copy-paste from elsewhere), detect and
// warn rather than silently ignoring it with no trace.
function parseTrackProviderMarkerForWarning(content) {
  const m = content.match(/\*\*Provider\*\*:[ \t]*([^\n]*)/i);
  if (!m) return null;
  return m[1].trim() || null;
}

function parseTrackType(content) {
  const match = content.match(/\*\*Type\*\*:\s*([^\n]+)/i);
  if (!match) return 'dev';
  const val = match[1].trim().toLowerCase();
  return ['dev', 'marketing', 'sales', 'support', 'other'].includes(val) ? val : 'dev';
}

// Marker-only reader — returns null (not a default) when **Merge Mode** is
// absent or invalid, so the FS→DB payload only pushes a value when the file
// actually says one, letting COALESCE on the DB side preserve whatever the
// column already holds. Track 10018 — see services/merge-mode.mjs for the
// NULL→'pr' resolution this deliberately does NOT do here.
function parseMergeMode(content) {
  return parseMergeModeMarker(content);
}

function parseKpiTarget(content) {
  const match = content.match(/\*\*KPI Target\*\*:\s*([^\n]+)/i);
  return match ? parseInt(match[1].trim(), 10) || null : null;
}

function parseKpiActual(content) {
  const match = content.match(/\*\*KPI Actual\*\*:\s*([^\n]+)/i);
  return match ? parseInt(match[1].trim(), 10) || null : null;
}

function parseKpiSnapshot(content) {
  const match = content.match(/\*\*KPI Snapshot\*\*:\s*([^\n]+)/i);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function parseKpiCheckAfter(content) {
  const match = content.match(/\*\*KPI Check After\*\*:\s*([^\n]+)/i);
  return match ? new Date(match[1].trim()) : null;
}

function parseKpiScheduledAt(content) {
  const match = content.match(/\*\*KPI Scheduled At\*\*:\s*([^\n]+)/i);
  return match ? new Date(match[1].trim()) : null;
}

// Parses the ## KPI block from spec.md
function parseKpiSpec(specContent) {
  if (!specContent) return {};
  const kpiBlock = specContent.match(/## KPI\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (!kpiBlock) return {};
  const block = kpiBlock[1];
  const get = (key) => { const m = block.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*([^\\n]+)`, 'i')); return m ? m[1].trim() : null; };
  return {
    kpi_metric: get('Metric'),
    kpi_source: get('Source'),
    kpi_source_config: get('Source Config'),
    kpi_threshold: get('Threshold') ? parseInt(get('Threshold'), 10) || null : null,
    kpi_window: get('Window'),
    kpi_maps_to: get('Maps To'),
  };
}

/**
 * Resolves a transition string (e.g. "implement:queue" or "plan") 
 * into a target lane and lane_action_status.
 */
function resolveTransition(configValue, currentLane, isSuccess, isMaxRetries) {
  if (!configValue || configValue === 'stay' || configValue === 'stop') {
    return {
      lane: currentLane || Lanes.PLAN,
      status: isSuccess ? 'success' : (isMaxRetries ? 'failure' : 'queue')
    };
  }

  const [lane, status] = configValue.split(':');
  if (!status) {
    // Default logic if no status provided:
    // Moving lane -> 'queue'
    // Staying in lane -> 'success' or 'failure'
    const movingToNewLane = lane !== currentLane;
    const defaultStatus = movingToNewLane ? 'queue' : (isSuccess ? 'success' : (isMaxRetries ? 'failure' : 'queue'));
    return { lane: lane || currentLane || Lanes.PLAN, status: defaultStatus };
  }

  return { lane: lane || currentLane || Lanes.PLAN, status };
}

function parsePhaseStep(content, laneStatus) {
  const stepMatch = content.match(/\*\*Step\*\*:\s*([^\n]+)/i);
  if (stepMatch) return stepMatch[1].trim().toLowerCase();

  if (laneStatus === 'review') return 'reviewing';
  if (laneStatus !== 'implement') return null;
  const sections = content.split(/(?=## Phase \d+:)/);
  const active = [...sections].reverse().find(s => /⏳/.test(s));
  if (!active) return 'plan';
  const total = (active.match(/- \[[ x]\]/g) || []).length;
  const done = (active.match(/- \[x\]/gi) || []).length;
  if (total === 0 || done === 0) return 'plan';
  if (done >= total) return 'complete';
  return 'coding';
}

function extractTrackNumber(filepath) {
  const parts = filepath.replace(/\\/g, '/').split('/');
  const trackDir = parts[parts.length - 2] ?? '';
  // Matches both legacy (10022-slug) and prefixed (AM-10022-slug, KAN-100-slug)
  return trackDir.match(/(?:^|-)(\d+)/)?.[1] ?? trackDir;
}

function extractTitle(filepath) {
  const parts = filepath.replace(/\\/g, '/').split('/');
  const trackDir = parts[parts.length - 2] ?? '';
  // Strip leading prefix + number (e.g. "AM-10023-" or "10023-" or "KAN-100-")
  return trackDir.replace(/^(?:[A-Z]+-)?[\d]+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function notifyApi(event, data) {
  const uiCfg = getUi();
  const apiPort = uiCfg?.port ? Number(uiCfg.port) + 1 : 8091;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1000);
  fetch(`http://localhost:${apiPort}/internal/sync-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data }),
    signal: controller.signal
  }).catch(() => { }).finally(() => clearTimeout(timeoutId));
}

// ── Conductor context files ───────────────────────────────────────────────────

async function pullWorkflow() {
  if (getIsLocalFs()) return;  // local-fs mode: workflow.json is source of truth
  try {
    const { url, token } = primaryCollector();
    const proj = getProject();
    const r = await get(url, token, `/projects/${proj.id}/workflow`).catch(err => {
      logger.error({ err }, '[sync error] pullWorkflow fetch');
      return null;
    });
    if (!r || !Object.keys(r).length) return;  // empty response → nothing to pull

    const workflowPath = 'conductor/workflow.json';
    const jsonStr = JSON.stringify(r, null, 2);

    // Only write if different from what's on disk
    const existing = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8').trim() : '';
    if (existing !== jsonStr.trim()) {
      console.log('[sync] workflow.json ← server: detected remote change, updating local disk...');
      writeFileSync(workflowPath, jsonStr + '\n', 'utf8');
    }
  } catch (err) {
    logger.error({ err }, '[sync error] pullWorkflow logic');
  }
}

// ── Phase 1: Timestamp Comparison & Conflict Detection ──────────────────────────
// Provides core decision logic for bidirectional sync with "newer wins" strategy

/**
 * Get file modification time in milliseconds
 * @param {string} filePath - Path to file
 * @returns {number|null} - Modification time in ms, or null if file doesn't exist
 */
function getFileModTime(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    return stat.mtimeMs;
  } catch (err) {
    console.warn(`[sync] getFileModTime: failed to stat ${filePath}:`, err.message);
    return null;
  }
}

// compareTimestamps/isConcurrentEdit live in ./sync-timestamp-utils.mjs —
// pure functions, extracted so they're unit-testable without importing this
// file's side effects (chokidar watchers, setIntervals, run at module load).

/**
 * Check if DB version should be pulled to filesystem
 * @param {object} track - Track object from DB {id, track_number, last_updated, content_summary, ...}
 * @param {string} trackFolder - Path to track folder
 * @returns {object} - {pull: boolean, reason?: string, affectedFiles: string[]}
 */
function shouldPullFromDB(track, trackFolder) {
  const affectedFiles = [];

  // Check index.md
  const indexPath = join(trackFolder, 'index.md');
  const indexMtime = getFileModTime(indexPath);
  const indexComparison = compareTimestamps(indexMtime, track.last_updated);

  if (indexComparison === 'newer') {
    affectedFiles.push('index.md');
  }

  // Check if content_summary has changed (simple heuristic) — only meaningful as a
  // pull trigger when the file ISN'T already confirmed newer than the DB. Previously
  // this fired on any mismatch regardless of recency, which meant a fresh local edit
  // (file newer, so its Summary text legitimately differs from the DB's stale cached
  // copy) would still mark the track as needing a DB→file pull — silently overwriting
  // the just-made edit with stale DB data on the next sync tick. A mismatch only
  // means "something out there is stale"; only recency (indexComparison) says which
  // side that is. When the file is newer, a mismatch means the DB is the stale one —
  // that's a push candidate (handled elsewhere via syncTrack), never a pull trigger.
  if (indexComparison !== 'older' && existsSync(indexPath)) {
    try {
      const content = readFileSync(indexPath, 'utf8');
      const summaryMatch = content.match(/\*\*Summary\*\*:\s*(.+?)(?:\n|$)/);
      const localSummary = summaryMatch ? summaryMatch[1].trim() : '';
      if (localSummary !== (track.content_summary || '')) {
        affectedFiles.push('content_summary_mismatch');
      }
    } catch (err) {
      console.warn(`[sync] shouldPullFromDB: failed to read ${indexPath}:`, err.message);
    }
  }

  return {
    pull: affectedFiles.length > 0,
    reason: affectedFiles.length > 0 ? 'db_newer_or_content_mismatch' : undefined,
    affectedFiles
  };
}

// ── Phase 2: DB → Filesystem Pull - Track Metadata ──────────────────────────────

/**
 * Update track index.md from database values
 * @param {string} trackFolder - Path to track folder
 * @param {object} dbTrack - Track object from DB
 */
function updateIndexMDFromDB(trackFolder, dbTrack) {
  const indexPath = join(trackFolder, 'index.md');

  try {
    let content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';

    // Create template if file doesn't exist
    if (!content.trim()) {
      content = `# Track ${dbTrack.track_number}: ${dbTrack.title}\n\n**Lane**: backlog\n**Progress**: 0%\n`;
    }

    // Helper to update or append marker
    const updateMarker = (text, marker, value) => {
      const regex = new RegExp(`^\\*\\*${marker}\\*\\*:\\s*.+$`, 'm');
      if (regex.test(text)) {
        return text.replace(regex, `**${marker}**: ${value}`);
      }
      return text.trim() + `\n**${marker}**: ${value}\n`;
    };

    // Update markers from DB values
    if (dbTrack.lane_status) {
      content = updateMarker(content, 'Lane', dbTrack.lane_status);
    }
    if (dbTrack.progress_percent !== undefined && dbTrack.progress_percent !== null) {
      content = updateMarker(content, 'Progress', `${dbTrack.progress_percent}%`);
    }
    if (dbTrack.current_phase) {
      content = updateMarker(content, 'Phase', dbTrack.current_phase);
    }
    if (dbTrack.content_summary) {
      content = updateMarker(content, 'Summary', dbTrack.content_summary);
    }
    // Track 10018: only write the marker when the DB explicitly has a value —
    // an absent/NULL merge_mode means "unspecified", which resolveMergeMode()
    // treats as 'pr' without ever needing the marker to say so in the file.
    if (dbTrack.merge_mode) {
      content = updateMarker(content, 'Merge Mode', dbTrack.merge_mode);
    }

    writeFileSync(indexPath, content, 'utf8');
    return true;
  } catch (err) {
    console.error(`[sync] updateIndexMDFromDB failed for ${trackFolder}:`, err.message);
    return false;
  }
}

/**
 * Pull track metadata, content, and comments from DB and update local files
 * Uses timestamp-based conflict resolution: newer wins
 * Integrates Phases 2-6: Metadata, Content, Comments, Edge Cases, Logging
 */
async function pullTracksMetadataFromDB() {
  if (getIsLocalFs()) return; // local-fs mode: no DB to pull from

  const { url, token } = primaryCollector();
  if (!url) return;

  try {
    const proj = getProject();
    if (!proj.id) return;

    // Fetch all tracks for this project from API
    const tracks = await get(url, token, `/api/projects/${proj.id}/tracks`);
    if (!Array.isArray(tracks)) return;

    const stats = { checked: 0, pulled: 0, skipped: 0, conflicts: 0, errors: 0 };

    for (const track of tracks) {
      stats.checked++;

      // Locate track folder
      const trackPath = resolveTrackFolder('conductor/tracks', track.track_number);

      if (!trackPath) continue;
      const fullTrackFolder = join('conductor/tracks', trackPath);

      // Phase 5: Check for incomplete DB records
      if (!track.last_updated) {
        console.warn(`[sync] Track ${track.track_number}: skipping, null last_updated`);
        stats.skipped++;
        continue;
      }

      // Phase 1: Check if pull is needed
      const pullDecision = shouldPullFromDB(track, fullTrackFolder);
      if (!pullDecision.pull) {
        stats.skipped++;
        continue;
      }

      // Phase 2: Metadata pull with conflict resolution
      const indexPath = join(fullTrackFolder, 'index.md');
      const indexMtime = getFileModTime(indexPath);
      const comparison = compareTimestamps(indexMtime, track.last_updated);

      // Phase 5: Detect concurrent modifications
      const isConcurrent = isConcurrentEdit(indexMtime, track.last_updated);
      if (isConcurrent) {
        logSyncDecision(track.track_number, 'index.md', 'skipped', 'concurrent_edit_grace_period', track.last_updated, indexMtime);
        stats.conflicts++;
        continue;
      }

      // Pull metadata if DB is newer or equal
      if (comparison === 'newer' || comparison === 'equal') {
        try {
          const success = updateIndexMDFromDB(fullTrackFolder, track);
          if (success) {
            logSyncDecision(track.track_number, 'index.md', 'pulled', 'db_newer', track.last_updated, indexMtime);
            stats.pulled++;

            // Phase 3: Pull full content if available
            if (track.spec_content || track.plan_content || track.test_content) {
              await pullTrackContentFromDB(track.id, track, fullTrackFolder);
            }

            // Phase 4: Sync conversation comments
            await syncConversationFromDB(track.id, track, fullTrackFolder);

            // Phase 5: Ensure required files exist
            const specPath = join(fullTrackFolder, 'spec.md');
            const testPath = join(fullTrackFolder, 'test.md');
            if (!existsSync(specPath)) {
              ensureTrackFileExists(fullTrackFolder, 'spec.md', '# Spec\n\n(Spec to be added)\n');
              console.log(`[sync] Track ${track.track_number}: created missing spec.md`);
            }
            if (!existsSync(testPath)) {
              const fallbackTestContent = `# Tests: Track ${track.track_number} — ${track.title}\n\n## Test Commands\n\`\`\`bash\n# Run all tests\nnpm test\n\`\`\`\n\n## Test Cases\n\n(Test cases to be added)\n\n## Acceptance Criteria\n- [ ] All unit tests pass\n- [ ] No regressions in related features\n`;
              ensureTrackFileExists(fullTrackFolder, 'test.md', fallbackTestContent);
              console.log(`[sync] Track ${track.track_number}: created missing test.md`);
            }

            // Phase 5: Clean up old backups
            cleanupOldBackups(fullTrackFolder);
          }
        } catch (err) {
          console.error(`[sync] Error pulling track ${track.track_number}:`, err.message);
          stats.errors++;
        }
      } else {
        // FS is newer → skip pull, preserve local version
        logSyncDecision(track.track_number, 'index.md', 'skipped', 'fs_newer', track.last_updated, indexMtime);
        stats.skipped++;
      }
    }

    // Phase 6: Log summary if any activity
    if (stats.checked > 0 && (stats.pulled > 0 || stats.conflicts > 0 || stats.errors > 0)) {
      logSyncSummary(stats);
    }
  } catch (err) {
    logger.error({ err }, '[sync error] pullTracksMetadataFromDB');
    // Don't crash the worker on API errors - continue syncing
  }
}

// ── Phase 3: DB → Filesystem Pull - Full Track Content ──────────────────────────

/**
 * Pull full track content files from DB when DB is newer
 * Handles spec.md, plan.md, test.md
 */
async function pullTrackContentFromDB(trackId, track, trackFolder) {
  const files = ['spec', 'plan', 'test'];
  const pulled = [];

  try {
    for (const fileType of files) {
      const filename = `${fileType}.md`;
      const filePath = join(trackFolder, filename);
      const fileKey = `${fileType}_content`;

      // Check if DB has content for this file
      if (!track[fileKey]) continue;

      // Get file mtime for conflict resolution
      const fileMtime = getFileModTime(filePath);
      const comparison = compareTimestamps(fileMtime, track.last_updated);

      // Only pull if DB is newer or equal
      if (comparison === 'newer' || comparison === 'equal') {
        // Create backup before overwriting
        if (existsSync(filePath)) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupPath = `${filePath}.bak-${timestamp}`;
          copyFileSync(filePath, backupPath);
          console.log(`[sync] Backed up ${filename} to ${backupPath}`);
        }

        writeFileSync(filePath, track[fileKey], 'utf8');
        pulled.push(filename);
      }
    }

    if (pulled.length > 0) {
      console.log(`[sync] Track ${track.track_number}: pulled content files [${pulled.join(', ')}]`);
    }
  } catch (err) {
    console.error(`[sync] pullTrackContentFromDB failed for track ${track.track_number}:`, err.message);
  }
}

// ── Phase 4: Conversation & Comments Pull from DB ───────────────────────────────

/**
 * Sync conversation comments from DB to local conversation.md
 * Append-only: never overwrites entire file
 */
async function syncConversationFromDB(trackId, track, trackFolder) {
  const conversationPath = join(trackFolder, 'conversation.md');

  try {
    // For now, this is a placeholder since comment sync requires DB table
    // In full implementation would:
    // 1. Query track_comments table for comments newer than last sync
    // 2. Parse last synced comment ID from conversation.md frontmatter
    // 3. Append new comments in markdown format
    // 4. Update marker with new last synced ID

    // Create placeholder if missing
    if (!existsSync(conversationPath)) {
      const placeholder = `# Conversation: Track ${track.track_number}\n\n<!-- Last synced comment ID: 0 -->\n`;
      writeFileSync(conversationPath, placeholder, 'utf8');
    }
  } catch (err) {
    console.error(`[sync] syncConversationFromDB failed for track ${track.track_number}:`, err.message);
  }
}

// ── Phase 5: Conflict Edge Cases & Safety ────────────────────────────────────────

/**
 * Create or update file stub if missing but needed
 */
function ensureTrackFileExists(trackFolder, filename, stub) {
  const filePath = join(trackFolder, filename);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, stub, 'utf8');
    return true;
  }
  return false;
}

/**
 * Clean up old backup files, keep only 2 most recent
 */
function cleanupOldBackups(trackFolder) {
  try {
    const dir = readdirSync(trackFolder)
      .filter(f => f.endsWith('.bak-'))
      .sort()
      .reverse();

    // Keep 2 backups, delete older ones
    for (let i = 2; i < dir.length; i++) {
      const backupPath = join(trackFolder, dir[i]);
      rmSync(backupPath, { force: true });
    }
  } catch (err) {
    console.warn(`[sync] cleanupOldBackups failed for ${trackFolder}:`, err.message);
  }
}

// ── Phase 6: Logging & Observability ─────────────────────────────────────────────

/**
 * Log sync decision in structured format
 */
function logSyncDecision(trackNumber, file, decision, reason, dbTime, fsTime) {
  const timestamp = new Date().toISOString();
  const dbTimeStr = dbTime instanceof Date ? dbTime.toISOString() : dbTime;
  const fsTimeStr = fsTime instanceof Date ? fsTime.toISOString() : (fsTime ? new Date(fsTime).toISOString() : 'missing');

  console.log(`[SYNC] ${timestamp} [DB→FS] Track ${trackNumber} ${file} [${decision.toUpperCase()}] ${reason} (db: ${dbTimeStr}, fs: ${fsTimeStr})`);
}

/**
 * Log heartbeat summary
 */
function logSyncSummary(stats) {
  logger.info({ ...stats }, `[SYNC-SUMMARY] Heartbeat cycle: ${stats.checked} tracks checked, ${stats.pulled} pulled, ${stats.skipped} skipped, ${stats.conflicts} conflicts, ${stats.errors} errors`);
}

async function syncConductorFiles() {
  if (getIsLocalFs()) return;  // local-fs mode: no collector to push to
  try {
    const dir = 'conductor';
    const files = {
      product: readIfExists(`${dir}/product.md`),
      tech_stack: readIfExists(`${dir}/tech-stack.md`),
      workflow_json: readIfExists(`${dir}/workflow.json`),
      product_guidelines: readIfExists(`${dir}/product-guidelines.md`),
      quality_gate: readIfExists(`${dir}/quality-gate.md`),
      // LAN-107: these three were scaffold-generated by `lc setup`/`setup-deploy` but never
      // actually synced anywhere — orphaned files nobody's dashboard ever showed. Added
      // alongside user_stories (a new artifact) so all four work end-to-end together.
      kpis: readIfExists(`${dir}/kpis.md`),
      deployment_stack: readIfExists(`${dir}/deployment-stack.md`),
      design_language: readIfExists(`${dir}/design-language.md`),
      user_stories: readIfExists(`${dir}/user-stories.md`),
      code_styleguides: {},
    };
    const stylesDir = `${dir}/code_styleguides`;
    if (existsSync(stylesDir)) {
      for (const f of readdirSync(stylesDir).filter(f => f.endsWith('.md'))) {
        files.code_styleguides[basename(f, '.md')] = readFileSync(`${stylesDir}/${f}`, 'utf8');
      }
    }
    const content = JSON.stringify(files);
    const hash = createHash('sha256').update(content).digest('hex');
    if (hash === lastConductorHash) { console.log('[sync] conductor files — unchanged, skipping'); return; }
    await postToCollectors('/conductor-files', { content });
    lastConductorHash = hash;
    notifyApi('conductor:updated', { projectId: getProject().id });
  } catch (err) {
    logger.error({ err }, '[sync error] conductor files');
  }
}

// ── Track sync ────────────────────────────────────────────────────────────────

// Returns true if the track's collector POST succeeded (or nothing needed to
// be sent), false if it failed. Track 1076: callers that need to know whether
// the DB write actually landed (e.g. handleTrackCreate deciding whether to
// mark a file_sync_queue entry "processed") previously had no way to tell —
// this function caught and logged its own collector-POST failures without
// ever rejecting, so a wrapping try/catch always saw success. The rest of the
// function's behavior (Jira push, notifyApi, logging) is unchanged regardless
// of this outcome — only the return value is new.
async function syncTrack(filepath, laneActionStatus = undefined) {
  if (getIsLocalFs()) return true;
  try {
    const trackNumber = extractTrackNumber(filepath);
    const title = extractTitle(filepath);
    const trackDir = dirname(filepath);
    const filename = basename(filepath);

    const trackMeta = getTrackMetadata(trackNumber);
    if (trackMeta && trackMeta.last_db_update) {
      const fileMtime = statSync(filepath).mtimeMs;
      const lastDbUpdateMs = new Date(trackMeta.last_db_update).getTime();
      if (fileMtime < lastDbUpdateMs) return true; // already synced, nothing to do
    }

    let indexContent = readIfExists(join(trackDir, 'index.md'));
    const planContent = readIfExists(join(trackDir, 'plan.md'));
    const specContent = readIfExists(join(trackDir, 'spec.md'));
    const testContent = readIfExists(join(trackDir, 'test.md'));
    const logContent = readIfExists(join(trackDir, 'log.md'));

    // ── DATA AUTHORITY ──
    // index.md is the absolute authority for the track's state (lane/status).
    // If index.md exists, we ONLY use it for state, even if markers are missing.
    // If index.md is missing, we fallback to the triggered file (backward compatibility).
    const stateContent = indexContent !== null ? indexContent : readFileSync(filepath, 'utf8');
    const qualityGateEnabled = isQualityGateEnabled();

    let laneStatus = parseStatus(stateContent, qualityGateEnabled);
    let laneActionStatusFromFile = parseLaneStatus(stateContent);
    let waitingForReply = parseWaitingForReply(stateContent);
    const autoRun = parseAutoRun(stateContent);

    // If index.md exists but has no status yet, fallback to EXISTING DB state
    // rather than guessing from content which might contain "Implementation" etc.
    if (!laneStatus) {
      laneStatus = trackMeta?.lane || Lanes.PLAN;
    }

    // Progress/Phase/Summary are index.md's own fields (it's "the absolute
    // authority" per above) — always prefer their explicit markers there over
    // deriving a value from plan.md (checkbox counts, **Problem** text, etc.).
    // Only fall back to plan.md when index.md has no marker of its own yet
    // (e.g. a freshly-scaffolded track, or a dev track genuinely tracking
    // phase-by-phase progress via plan.md checkboxes with no override).
    const primaryInfo = planContent || stateContent;
    const progress = parseProgressMarker(stateContent) ?? parseProgress(primaryInfo);
    const currentPhase = parseCurrentPhaseMarker(stateContent) ?? parseCurrentPhase(primaryInfo);
    const summary = parseSummaryMarker(stateContent) ?? parseSummary(primaryInfo);
    const phaseStep = parsePhaseStep(primaryInfo, laneStatus);

    // Helper to update or append a header
    const updateHeader = (content, header, value) => {
      const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
      if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
      return content.trim() + `\n**${header}**: ${value}\n`;
    };

    const proj = getProject();
    // Parse KPI fields from index.md (runtime state) and spec.md (planning config)
    const trackType = parseTrackType(stateContent);
    const kpiSpec = parseKpiSpec(specContent);
    const kpiCheckAfter = parseKpiCheckAfter(stateContent);
    const kpiScheduledAt = parseKpiScheduledAt(stateContent);

    const payload = {
      project_id: proj.id,
      track_number: trackNumber, title, lane_status: laneStatus,
      progress_percent: progress, current_phase: currentPhase,
      content_summary: summary, phase_step: phaseStep,
      waiting_for_reply: waitingForReply,
      auto_run: autoRun,
      index_content: indexContent, plan_content: planContent, spec_content: specContent, test_content: testContent,
      log_content: logContent,
      // Track 10018: per-track merge mode marker (null when unspecified —
      // resolveMergeMode() on the read side is where NULL becomes 'pr')
      merge_mode: parseMergeMode(stateContent),
      // Track 1115: per-track workspace mode marker (null when unspecified —
      // resolveWorkspaceMode() on the read side is where NULL becomes 'branch')
      workspace_mode: parseWorkspaceMarker(stateContent),
      // KPI fields
      track_type: trackType,
      kpi_target: parseKpiTarget(stateContent),
      kpi_actual: parseKpiActual(stateContent),
      kpi_snapshot: parseKpiSnapshot(stateContent),
      kpi_check_after: kpiCheckAfter && !isNaN(kpiCheckAfter) ? kpiCheckAfter.toISOString() : null,
      kpi_scheduled_at: kpiScheduledAt && !isNaN(kpiScheduledAt) ? kpiScheduledAt.toISOString() : null,
      ...kpiSpec,
      // Track 1116 REQ-7: per-track model override marker
      model_override: parseModelOverrideMarker(stateContent),
    };
    if (laneActionStatus) payload.lane_action_status = laneActionStatus;
    else if (laneActionStatusFromFile) payload.lane_action_status = laneActionStatusFromFile;

    // Ensure state AUTHORITY is reflected in the file itself (add missing markers)
    if (indexContent !== null) {
      let updatedIdx = indexContent;
      let changed = false;
      if (!indexContent.match(/\*\*Lane\*\*/i)) { updatedIdx = updateHeader(updatedIdx, 'Lane', laneStatus); changed = true; }
      if (!indexContent.match(/\*\*Lane Status\*\*/i)) { updatedIdx = updateHeader(updatedIdx, 'Lane Status', laneActionStatusFromFile || 'queue'); changed = true; }
      if (changed) {
        writeFileSync(filepath, updatedIdx, 'utf8');
        indexContent = updatedIdx;
      }
    }

    let collectorSynced = false;
    try {
      await postToCollectors('/track', payload);

      updateTrackMetadata(trackNumber, {
        folder_path: trackDir,
        last_file_update: new Date().toISOString(),
        synced: true
      });
      collectorSynced = true;
    } catch (e) {
      logger.warn({ err: e, trackNumber }, '[sync warning] Failed to post to collector');
    }

    // Outbound: Push track changes to Jira if configured
    (async () => {
      try {
        const jiraConfig = readJiraConfig(getCollectors());
        if (!jiraConfig) return; // No Jira configured

        const trackMeta = getTrackMetadata(trackNumber);

        const resolvedStatus = payload.lane_action_status || laneActionStatusFromFile;
        if (!trackMeta?.jira_key) {
           // Prevent rapid duplicate issue creations by checking in-memory lock
           global._jiraCreationLocks = global._jiraCreationLocks || new Set();
           if (global._jiraCreationLocks.has(trackNumber)) return;
           
           global._jiraCreationLocks.add(trackNumber);
          // No Jira issue yet: create one ("latest wins" — FS is source of truth for new tracks)
          console.log(`[jira-push] No Jira issue for ${trackNumber}, creating...`);
          const issueKey = await createJiraIssue(jiraConfig, { 
            title, 
            lane: laneStatus, 
            status: resolvedStatus,
            indexContent: indexContent || '',
            planContent: planContent || '',
            specContent: specContent || '',
            testContent: testContent || '',
            logContent: logContent || ''
          });
          if (issueKey) {
            
            updateTrackMetadata(trackNumber, { jira_key: issueKey, jira_last_synced: new Date().toISOString() });
            console.log(`[jira-push] Linked ${trackNumber} → ${issueKey}`);
          }
           global._jiraCreationLocks.delete(trackNumber);
          return;
        }

        const trackData = {
          title,
          lane: laneStatus,
          status: resolvedStatus,
          indexContent: indexContent || '',
          planContent: planContent || '',
          specContent: specContent || '',
          testContent: testContent || '',
          logContent: logContent || '',
        };

        const success = await pushTrackToJira(jiraConfig, trackMeta.jira_key, trackData);
        if (success) {
          const freshMetadata = loadTracksMetadata();
          if (!freshMetadata.tracks) freshMetadata.tracks = {};
          if (!freshMetadata.tracks[trackNumber]) freshMetadata.tracks[trackNumber] = {};
          freshMetadata.tracks[trackNumber].jira_last_synced = new Date().toISOString();
          saveTracksMetadata(freshMetadata);
          console.log(`[jira-push] Pushed ${trackNumber} to Jira (${trackMeta.jira_key})`);
        }
      } catch (err) {
        console.error(`[jira-push error] ${trackNumber}:`, err.message);
        if (global._jiraCreationLocks) global._jiraCreationLocks.delete(trackNumber);
      }
    })();

    notifyApi('track:updated', { trackNumber, laneStatus, progress, projectId: getProject()?.id });
    console.log(`[sync] ${trackNumber} → ${laneStatus} (source: ${filename})`);
    return collectorSynced;
  } catch (err) {
    logger.error({ err, filepath }, '[sync error]');
    return false;
  }
}

// ── Conversation sync ─────────────────────────────────────────────────────────

// Every worker process of a project watches the SAME conductor/tracks
// directory (chokidar, ignoreInitial: false), so a single conversation.md
// write can fire syncConversation concurrently in N processes, each reading
// the same stale .conv-cursor before any of them writes it back. Live-
// reproduced twice in one session (aitutor track 182, 2026-08-14):
//   - Three workers all reacting to one file touch each independently
//     parsed the same new turn and POSTed it — three duplicate
//     track_comments rows, byte-identical, same millisecond.
//   - A concurrent second cycle read a cursor position that split a
//     multi-line reply mid-body; the fragment matched no known comment
//     format, and the cursor still advanced past it unconditionally — the
//     reply was silently dropped, never reaching track_comments at all.
// A lockfile per track serializes syncConversation across processes for
// that track: only the lock holder reads-parses-posts-advances; every
// other concurrent caller skips this cycle rather than racing it. Skipping
// is safe (not lossy) — the content is still on disk, unconsumed, and the
// next debounced trigger for this file re-derives newContent from
// whatever the cursor actually says, so nothing is dropped by skipping.
const CONV_SYNC_LOCK_STALE_MS = 30_000;
async function withConvSyncLock(cursorPath, fn) {
  const lockPath = `${cursorPath}.lock`;
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Another process holds it. Only steal a lock old enough to mean its
    // holder crashed/was killed mid-sync (this session: a worker was
    // killed by an overly-broad pkill while a sync was plausibly
    // in-flight) — a live holder finishes in milliseconds, well under this
    // threshold, so a fresh lock is never stolen out from under real work.
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age < CONV_SYNC_LOCK_STALE_MS) return; // someone else has it — skip this cycle, not an error
      console.warn(`[conv-sync] Stale lock (${Math.round(age / 1000)}s) at ${lockPath} — assuming a dead holder and taking it`);
      rmSync(lockPath, { force: true });
      fd = openSync(lockPath, 'wx');
    } catch (retryErr) {
      if (retryErr.code === 'EEXIST') return; // lost the race to reclaim it — fine, skip this cycle
      throw retryErr;
    }
  }
  closeSync(fd);
  try {
    // MUST await here — fn() is async (it POSTs to the collector before
    // returning), and releasing the lock in a bare `finally` around a call
    // that isn't awaited would release it the instant fn() returns its
    // pending promise, not once the work inside actually finishes. That
    // would silently defeat the entire lock.
    return await fn();
  } finally {
    try { rmSync(lockPath, { force: true }); } catch (_) { /* already gone — fine */ }
  }
}

async function syncConversation(filepath) {
  if (getIsLocalFs()) return;
  const trackNumber = extractTrackNumber(filepath);
  if (!trackNumber) return;
  const trackDir = dirname(filepath);
  const cursorPath = join(trackDir, '.conv-cursor');
  return withConvSyncLock(cursorPath, () => syncConversationLocked(filepath, trackNumber, trackDir, cursorPath));
}

// .conv-cursor is gitignored (per-machine, not committed) — a fresh worktree
// or a new worker process on a new machine starts with no cursor file even
// though the project's conversation history may already be fully synced.
// Defaulting to cursor=0 there re-parses the ENTIRE conversation.md as "new"
// and re-POSTs every already-synced turn: duplicate rows at best, and if any
// single turn is large, PayloadTooLargeError in a tight loop at worst (track
// 10021, 2026-08-26 — a 153KB conversation.md hit Express's 100kb body limit
// on cold start). Ask the DB how many comments it already has for this track
// and skip exactly that many locally-parsed turns, so a cold start only
// (re-)posts content the DB doesn't already have. Best-effort: on any
// failure (no collector, local-fs mode, network error) this falls back to
// the old cursor=0 behavior rather than blocking the sync entirely.
async function seedCursorFromDB(trackNumber, content) {
  try {
    const { url, token } = primaryCollector();
    if (!url) return 0;
    const track = await get(url, token, `/track/${trackNumber}`).catch(() => null);
    const remoteCount = track?.comments?.length ?? 0;
    if (remoteCount === 0) return 0;

    const offsets = findTurnStartOffsets(content);
    if (remoteCount >= offsets.length) return content.length;

    console.log(`[conv-sync] Track ${trackNumber}: no local cursor — DB already has ${remoteCount} comment(s), seeding cursor past them instead of resyncing from scratch`);
    return offsets[remoteCount];
  } catch (err) {
    console.warn(`[conv-sync] cursor seed for track ${trackNumber} failed, defaulting to 0: ${err.message}`);
    return 0;
  }
}

async function syncConversationLocked(filepath, trackNumber, trackDir, cursorPath) {
  try {
    const content = readFileSync(filepath, 'utf8');
    const storedCursor = readIfExists(cursorPath);
    const cursor = storedCursor !== null ? parseInt(storedCursor) : await seedCursorFromDB(trackNumber, content);
    const newContent = content.slice(cursor);
    if (!newContent.trim()) return;

    const comments = parseConversationComments(newContent);

    if (comments.length === 0) {
      // There WAS new content (checked above) but none of it matched the
      // `> **author**: body` turn format — e.g. a narrative document with
      // section headers and plain blockquotes instead of turn markers.
      // Previously this was swallowed with no trace: the cursor still
      // advances past it (avoids reprocessing the same bytes forever), but
      // that content never reaches track_comments/the UI, and nothing said
      // so.
      const preview = newContent.trim().slice(0, 150).replace(/\s+/g, ' ');
      console.warn(`[conv-sync] Track ${trackNumber}: ${newContent.length} bytes of new conversation.md content matched no known comment format — not synced to track_comments. Preview: "${preview}${newContent.trim().length > 150 ? '…' : ''}"`);
      writeFileSync(cursorPath, String(content.length), 'utf8');
      return;
    }

    const proj = getProject();
    for (const c of comments) {
      await postToCollectors(`/track/${trackNumber}/comment`, {
        project_id: proj.id,
        author: c.author, body: c.body.trim(), no_wake: c.no_wake
      }).catch(err => console.warn(`[conv-sync] post comment failed: ${err.message}`));

      // Outbound: Push comment to Jira if configured (only for human comments)
      if (c.author === 'human') {
        (async () => {
          try {
            const jiraConfig = readJiraConfig(getCollectors());
            if (!jiraConfig) return; // No Jira configured

            const metadata = loadTracksMetadata();
            const trackMeta = metadata.tracks ? metadata.tracks[trackNumber] : metadata[trackNumber];
            if (!trackMeta?.jira_key) return; // Track not linked to Jira

            const success = await pushCommentToJira(jiraConfig, trackMeta.jira_key, c.body.trim());
            if (success) {
              console.log(`[jira-push-comment] Pushed comment to ${trackMeta.jira_key}`);
            }
          } catch (err) {
            console.error(`[jira-push-comment error] ${trackNumber}:`, err.message);
          }
        })();
      }

      // ── Command Side Effects (Filesystem-as-API) ──
      if (c.author === 'human') {
        let updates = null;
        if (c.is_brainstorm) {
          // Brainstorm: keep current lane, just flag for reply so worker enters dialogue mode
          console.log(`[conv-command] ${trackNumber}: brainstorm flag set (waitingForReply only)`);
          const brainstormIndexPath = join(trackDir, 'index.md');
          if (existsSync(brainstormIndexPath)) {
            let brainstormIdx = readFileSync(brainstormIndexPath, 'utf8');
            const bUpdateHeader = (content, header, value) => {
              const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
              if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
              return content.trim() + `\n**${header}**: ${value}\n`;
            };
            brainstormIdx = bUpdateHeader(brainstormIdx, 'Waiting for reply', 'yes');
            writeFileSync(brainstormIndexPath, brainstormIdx, 'utf8');
            console.log(`[conv-command] ${trackNumber}: set Waiting for reply=yes (lane unchanged)`);
          }
        } else if (c.is_replan) {
          console.log(`[conv-command] ${trackNumber}: triggering replan`);
          updates = { lane: Lanes.PLAN, lane_action_status: 'queue' };
        } else if (c.is_bug) {
          console.log(`[conv-command] ${trackNumber}: triggering bug flow`);
          updates = { lane: Lanes.PLAN, lane_action_status: 'queue' };
        }

        if (updates) {
          await postToCollectors(`/track/${trackNumber}/action`, { ...updates, project_id: proj.id })
            .catch(err => console.warn(`[conv-command] transition failed: ${err.message}`));

          // ALSO update local index.md for filesystem-as-API consistency
          const indexPath = join(trackDir, 'index.md');
          if (existsSync(indexPath)) {
            let indexContent = readFileSync(indexPath, 'utf8');

            // Helper to update or append a header
            const updateHeader = (content, header, value) => {
              const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
              if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
              return content.trim() + `\n**${header}**: ${value}\n`;
            };

            if (updates.lane) indexContent = updateHeader(indexContent, 'Lane', updates.lane);
            if (updates.lane_action_status) indexContent = updateHeader(indexContent, 'Lane Status', updates.lane_action_status);

            if (c.is_replan || c.is_bug) {
              indexContent = updateHeader(indexContent, 'Waiting for reply', 'no');
            }
            writeFileSync(indexPath, indexContent, 'utf8');
            console.log(`[conv-command] ${trackNumber}: updated index.md local state`);
          }
        }
      }
    }

    writeFileSync(cursorPath, String(content.length), 'utf8');
    console.log(`[conv-sync] ${trackNumber}: synced ${comments.length} comment(s) to DB`);
    notifyApi('track:updated', { trackNumber, projectId: proj.id });
  } catch (err) {
    console.error(`[conv-sync error] ${filepath}:`, err.message);
  }
}

// ── Watchers ──────────────────────────────────────────────────────────────────

// Only process .md files inside numbered track directories.
// Matches both legacy (e.g. 1012-git-worktree/) and prefixed (e.g. AM-10023-slug/, KAN-100-slug/).
const isTrackFile = f => f.endsWith('.md') && /[/\\](?:[A-Z]+-)?[\d]+[^/\\]*[/\\][^/\\]+\.md$/.test(f);
const isConvFile = f => f.endsWith('conversation.md') && /[/\\](?:[A-Z]+-)?[\d]+[^/\\]*[/\\]conversation\.md$/.test(f);

watch('conductor/tracks', { ignoreInitial: false, depth: 2 })
  .on('add', f => {
    if (isConvFile(f)) debounce(`conv-${f}`, () => withConcurrencyLimit(() => syncConversation(f)));
    else if (isTrackFile(f)) debounce(f, () => withConcurrencyLimit(() => syncTrack(f)));
  })
  .on('change', f => {
    if (isConvFile(f)) debounce(`conv-${f}`, () => withConcurrencyLimit(() => syncConversation(f)));
    else if (isTrackFile(f)) debounce(f, () => withConcurrencyLimit(() => syncTrack(f)));
  });

watch(['conductor/code_styleguides'], { ignoreInitial: false })
  .on('add', f => { if (f.endsWith('.md')) debounce('conductor', () => syncConductorFiles()); })
  .on('change', f => { if (f.endsWith('.md')) debounce('conductor', () => syncConductorFiles()); });

watch([
  'conductor/product.md', 'conductor/tech-stack.md',
  'conductor/product-guidelines.md', 'conductor/quality-gate.md',
  'conductor/kpis.md', 'conductor/deployment-stack.md',
  'conductor/design-language.md', 'conductor/user-stories.md',
], { ignoreInitial: false })
  .on('add', () => debounce('conductor', () => syncConductorFiles()))
  .on('change', () => debounce('conductor', () => syncConductorFiles()));

// Reload workflow config when workflow.json changes (local-fs canonical source)
watch('conductor/workflow.json', { ignoreInitial: true })
  .on('change', () => { workflowConfig = loadWorkflowConfig(); console.log('[config] workflow.json reloaded'); });

watch('conductor/tracks/file_sync_queue.md', { ignoreInitial: true })
  .on('change', () => debounce('file-queue', () => processFileSyncQueue().catch(e => console.error('[file-queue error]:', e.message)), 1000))
  .on('add', () => debounce('file-queue', () => processFileSyncQueue().catch(e => console.error('[file-queue error]:', e.message)), 1000));

let lastConfigHash = '';
watch('.laneconductor.json')
  .on('change', () => {
    debounce('config-reload', async () => {
      const content = readFileSync('.laneconductor.json', 'utf8');
      const hash = createHash('md5').update(content).digest('hex');
      if (hash === lastConfigHash) return;
      lastConfigHash = hash;

      console.log('[config] .laneconductor.json changed, reloading...');
      try {
        const newConfig = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
        // Fully replace config object to avoid stale references
        config = {
          ...HARDCODED_DEFAULTS,
          ...newConfig,
          project: { ...HARDCODED_DEFAULTS.project, ...newConfig.project },
          ui: { ...HARDCODED_DEFAULTS.ui, ...newConfig.ui }
        };
        const p = config.project.primary;
        console.log(`[config] Reloaded — mode: ${getMode()}, primary: ${p.cli}${p.model ? '/' + p.model : ' (default model)'}`);
        if (!getIsLocalFs()) {
          console.log('[config] Collector URLs:', getCollectors().map(c => c.url));
          // File → DB sync: propagate manual .laneconductor.json edits to the API
          try {
            const { url, token } = primaryCollector();
            const proj = config.project;
            if (proj.id) {
              const headers = { 'Content-Type': 'application/json' };
              if (token) headers['Authorization'] = `Bearer ${token}`;
              const r = await fetch(`${url}/api/projects/${proj.id}/config`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                  primary: proj.primary || null,
                  secondary: proj.secondary || null,
                  dev: proj.dev || null,
                  collectors: config.collectors || [],
                  db: config.db || null,
                  ui_port: config.ui?.port || null,
                }),
              });
              if (r.ok) {
                console.log('[config-sync] Synced .laneconductor.json changes to API');
              } else {
                console.warn('[config-sync] Failed to PATCH API config:', r.status, await r.text());
              }
            }
          } catch (e) {
            console.warn('[config-sync] Could not sync to API:', e.message);
          }
        }
      } catch (err) {
        console.error('[config error] Reload failed:', err.message);
      }
    }, 500);
  });

// ── Startup ───────────────────────────────────────────────────────────────────

// Track 1099: discover available models after registering, not before.
// discoverAvailableModels now uses async exec (not execSync — see its own
// comment for why that mattered), so this no longer blocks the event
// loop either way, but still runs after registration on principle: the
// model list simply arrives one heartbeat cycle later instead of the
// first — registerWorker/updateWorkerHeartbeat already read the shared
// `cachedModels` variable
// each time they're called, so nothing else needs to change.
await upsertWorker();
setTimeout(() => { refreshModels().catch(err => logger.warn({ err }, '[models] initial discovery failed')); }, 0);

workflowConfig = loadWorkflowConfig();
tracksMetadata = loadTracksMetadata();
console.log(`[LaneConductor] Heartbeat worker started (PID: ${process.pid})`);
console.log(`[LaneConductor] Collector mode: ${getMode()}`);
console.log(`[LaneConductor] Worker mode: ${workerMode}`);
// Track 1109 Phase 5: make the claim scope visible at startup. A scoped
// worker that correctly ignores everything looks identical to a broken one
// unless it says what it is scoped to.
console.log(
  onlyTracks
    ? `[LaneConductor] Claim scope: ONLY tracks [${[...onlyTracks].join(', ')}]${exitWhenDone ? ' (will exit when done)' : ''}`
    : '[LaneConductor] Claim scope: unscoped — may claim any queued track'
);
if (!getIsLocalFs()) console.log(`[LaneConductor] Collectors: ${getCollectors().map(c => c.url).join(', ')}`);
if (!getIsLocalFs()) console.log(`[LaneConductor] Dashboard: http://localhost:${getUi()?.port ?? 8090}`);

// Ensure providers are in DB so they show in UI (API modes only)
// 'mock' is the LC_MOCK_CLI test sentinel (see buildCliArgs) — never a real
// provider, so it's excluded even if a config was left pointing at it.
if (!getIsLocalFs()) (async () => {
  const { url, token } = primaryCollector();
  const proj = getProject();
  if (proj.primary?.cli && proj.primary.cli !== 'mock') {
    post(url, token, '/provider-status', { provider: proj.primary.cli, status: 'available' }).catch(() => { });
  }
  if (proj.secondary?.cli && proj.secondary.cli !== 'mock') {
    post(url, token, '/provider-status', { provider: proj.secondary.cli, status: 'available' }).catch(() => { });
  }
})();

syncConductorFiles();

async function replayStaleTracks() {
  if (getIsLocalFs()) return;
  try {
    const { url, token } = primaryCollector();
    const { tracks } = await get(url, token, '/tracks/stale');
    for (const row of tracks) {
      const tracksDir = 'conductor/tracks';
      const trackDir = resolveTrackFolder(tracksDir, row.track_number);
      if (trackDir) {
        console.log(`[sync] replaying stale track ${row.track_number}...`);
        await syncTrack(join(tracksDir, trackDir, 'plan.md'));
      }
    }
  } catch (err) {
    console.error('[replay error]:', err.message);
  }
}

async function resetStuckActions(immediate = false) {
  if (getIsLocalFs()) return;
  try {
    const { url, token } = primaryCollector();
    const { reset } = await post(url, token, '/tracks/reset-stuck-actions', { immediate });
    if (reset?.length) console.log(`[LaneConductor] Reset stuck actions for tracks: ${reset.join(', ')}`);
  } catch (err) {
    console.error('[reset-stuck error]:', err.message);
  }
}

replayStaleTracks();
resetStuckActions(true); // immediate on startup: worker starts fresh, owns no running tracks
setInterval(resetStuckActions, 2 * 60 * 1000); // periodically recover stuck-running tracks

// Phase 2 integration: periodic DB→FS pull (5s interval, same as file watcher)
setInterval(pullTracksMetadataFromDB, 5000);

// Reset any stale `running` status in filesystem on startup (worker owns no PIDs yet)
(function resetFilesystemRunningStatus() {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return;
  for (const dir of readdirSync(tracksDir).filter(d => /\d+/.test(d))) {
    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;
    const content = readFileSync(indexPath, 'utf8');
    if (content.match(/\*\*Lane Status\*\*:\s*running/i)) {
      writeFileSync(indexPath, content.replace(/\*\*Lane Status\*\*:\s*running/i, '**Lane Status**: queue'), 'utf8');
      console.log(`[startup] Reset stale running status in filesystem for ${dir}`);
    }
  }
})();

// ── Heartbeat intervals ───────────────────────────────────────────────────────

setInterval(() => updateWorkerHeartbeat(), Number(process.env.LC_HEARTBEAT_INTERVAL_MS) || 10000);

setInterval(async () => {
  try {
    // Only heartbeat tracks this worker is actively running — prevents orphaned tracks
    // from staying in 'running' state and blocking resetStuckActions
    const activeTrackNumbers = [...runningTrackMap.values()];
    if (activeTrackNumbers.length === 0) return;
    const { url, token } = primaryCollector();
    const { updated } = await post(url, token, '/tracks/heartbeat', { track_numbers: activeTrackNumbers });
    if (updated?.length) console.log(`[heartbeat] ${updated.join(', ')}`);
  } catch (err) {
    console.error('[heartbeat error]:', err.message);
  }
}, 5000);

// ── Jira Polling (if configured) ──────────────────────────────────────────────
// Polls Jira for new/updated issues and syncs them to LaneConductor as tracks.
// Race-condition safe: multiple workers use timestamp-based change detection.
// Polling interval: every 60 seconds (same as DB pull)

let jiraPollRunning = false;
let jiraStatusesValidated = false; // Track if we've validated statuses once

async function runJiraSync() {
  if (jiraPollRunning) return; // Prevent concurrent polls (multiple workers race-safe)

  jiraPollRunning = true;
  try {
    const jiraConfig = readJiraConfig(getCollectors());
    if (!jiraConfig) {
      jiraPollRunning = false;
      return; // No Jira collector configured
    }

    // Validate Jira statuses exist (run once per worker session)
    if (!jiraStatusesValidated) {
      const validation = await validateJiraStatuses(jiraConfig);
      if (!validation.allExist) {
        console.log(validation.guidance);
      }
      jiraStatusesValidated = true;
    }

    // Get last sync timestamp (or default to 24 hours ago for first sync)
    const metadata = loadTracksMetadata();
    const lastSyncTimestamp = metadata._jira_last_poll || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since = lastSyncTimestamp;

    console.log(`[jira-polling] Polling ${jiraConfig.project_key} for issues since ${since}`);

    // Poll Jira for updated issues
    const issues = await pollJira(jiraConfig, since);
    console.log(`[jira-polling] Found ${issues.length} issues to sync`);

    if (!existsSync('conductor/tracks')) {
      mkdirSync('conductor/tracks', { recursive: true });
    }

    const gracePeriodMs = 2000; // 2 second grace period for simultaneous edits

    // Process each issue: apply "latest version wins" conflict resolution
    for (const issue of issues) {
      try {
        const trackUpdate = jiraIssueToTrackUpdate(issue, jiraConfig);
        const trackKey = trackUpdate.track_number;

        // Check metadata first to see if this Jira key is already linked to a local track
        const existingTrackId = Object.entries(metadata.tracks || {}).find(
          ([id, meta]) => meta.jira_key === trackKey
        )?.[0];

        // Find matching local track folder
        const tracksDir = 'conductor/tracks';
        let trackFolder = null;
        
        if (existingTrackId) {
          const matched = resolveTrackFolder(tracksDir, existingTrackId);
          if (matched) trackFolder = join(tracksDir, matched);
        } else {
          // Fallback check for KAN- folder
          const matched = resolveTrackFolder(tracksDir, trackKey);
          if (matched) trackFolder = join(tracksDir, matched);
        }

        if (!trackFolder) {
          // New issue: create track folder
          console.log(`[jira-polling] Creating new track from ${trackKey}`);
          trackFolder = join(tracksDir, `${trackKey}-${trackUpdate.title.toLowerCase().replace(/\s+/g, '-')}`);
          mkdirSync(trackFolder, { recursive: true });

          // Write index.md
          const laneStatus = mapLaneToLaneStatus(trackUpdate.lane);
          const indexContent = trackUpdate.indexContent ? String(trackUpdate.indexContent) : `# ${trackUpdate.title}\n\n**Lane Status**: ${laneStatus}\n\n${String(trackUpdate.content || '(No description)')}\n`;
          writeFileSync(join(trackFolder, 'index.md'), indexContent, 'utf8');

          if (trackUpdate.planContent) writeFileSync(join(trackFolder, 'plan.md'), trackUpdate.planContent, 'utf8');
          if (trackUpdate.specContent) writeFileSync(join(trackFolder, 'spec.md'), trackUpdate.specContent, 'utf8');
          if (trackUpdate.testContent) writeFileSync(join(trackFolder, 'test.md'), trackUpdate.testContent, 'utf8');
          if (trackUpdate.logContent) writeFileSync(join(trackFolder, 'log.md'), trackUpdate.logContent, 'utf8');

          // Create empty conversation.md
          writeFileSync(join(trackFolder, 'conversation.md'), '', 'utf8');

          // Update metadata
          if (!metadata.tracks) metadata.tracks = {};
          metadata.tracks[trackKey] = { jira_key: trackKey, jira_last_synced: trackUpdate.updated };
        } else {
          // Existing track: compare timestamps with "latest version wins"
          const indexPath = join(trackFolder, 'index.md');
          const indexStat = statSync(indexPath);
          const fsMtime = indexStat.mtime.toISOString();

          const jiraUpdated = new Date(trackUpdate.updated);
          const fsModified = new Date(fsMtime);
          const timeDiffMs = Math.abs(jiraUpdated - fsModified);

          if (timeDiffMs < gracePeriodMs) {
            continue;
          }

          // Latest version wins
          if (jiraUpdated > fsModified) {
             console.log(`[jira-polling] ${trackKey}: Jira newer, updating FS`);
            const indexContent = readFileSync(indexPath, 'utf8');
            const titleMatch = indexContent.match(/^# (.+)$/m);
            const oldTitle = titleMatch ? titleMatch[1] : '';

            // Update lane and title if changed
            let updatedContent = indexContent.replace(
              /^\*\*Lane Status\*\*: \w+/m,
              `**Lane Status**: ${mapLaneToLaneStatus(trackUpdate.lane)}`
            );
            if (oldTitle !== trackUpdate.title) {
              updatedContent = updatedContent.replace(/^# .+$/m, `# ${trackUpdate.title}`);
            }
            
            // Re-render description area (everything after **Lane Status**)
            const parts = updatedContent.split(/\*\*Lane Status\*\*: .+\n/);
            const laneStatus = mapLaneToLaneStatus(trackUpdate.lane);
            if (parts.length > 1) {
              const currentDescription = parts[1] || '';
              const newDescription = trackUpdate.is_empty ? currentDescription : (trackUpdate.indexContent || trackUpdate.content || '(No description)');
              updatedContent = parts[0] + `**Lane Status**: ${laneStatus}\n\n${newDescription}\n`;
            } else {
               // Fallback if structure is weird
               const newDescription = trackUpdate.is_empty ? '' : (trackUpdate.indexContent || trackUpdate.content || '(No description)');
               updatedContent = `# ${trackUpdate.title}\n\n**Lane Status**: ${laneStatus}\n\n${newDescription}\n`;
            }

            writeFileSync(indexPath, updatedContent, 'utf8');
            
            if (!trackUpdate.is_empty) {
              if (trackUpdate.planContent !== undefined && trackUpdate.planContent !== '') writeFileSync(join(trackFolder, 'plan.md'), trackUpdate.planContent, 'utf8');
              if (trackUpdate.specContent !== undefined && trackUpdate.specContent !== '') writeFileSync(join(trackFolder, 'spec.md'), trackUpdate.specContent, 'utf8');
              if (trackUpdate.testContent !== undefined && trackUpdate.testContent !== '') writeFileSync(join(trackFolder, 'test.md'), trackUpdate.testContent, 'utf8');
              if (trackUpdate.logContent !== undefined && trackUpdate.logContent !== '') writeFileSync(join(trackFolder, 'log.md'), trackUpdate.logContent, 'utf8');
            }

            if (!metadata.tracks) metadata.tracks = {};
            metadata.tracks[trackKey] = { ...metadata.tracks[trackKey], jira_key: trackKey, jira_last_synced: trackUpdate.updated };
          } else {
            console.log(`[jira-polling] ${trackKey}: FS newer, skipping (will push on next outbound sync)`);
          }
        }

        // Sync Comments from Jira
        trackFolder = trackFolder || join(tracksDir, resolveTrackFolder(tracksDir, issue.key));
        if (trackFolder && existsSync(trackFolder)) {
          const convFile = join(trackFolder, 'conversation.md');
          const lastSynced = (metadata.tracks && metadata.tracks[issue.key]?.jira_last_comment_synced) || metadata._jira_last_poll || since;
          const jiraComments = await getJiraComments(jiraConfig, issue.key, lastSynced);
          
          if (jiraComments.length > 0) {
            console.log(`[jira-polling] ${issue.key}: found ${jiraComments.length} new comments`);
            let appended = false;
            for (const jc of jiraComments) {
              const body = parseAdfToText(jc.body);
              const author = jc.author?.displayName || 'Jira User';
              const entry = `\n> **human** (jira: ${author}): ${body}\n`;
              
              // Only append if not already in conversation (basic dedup)
              const existingConv = readIfExists(convFile) || '';
              if (!existingConv.includes(body.slice(0, 50))) {
                appendFileSync(convFile, entry, 'utf8');
                appended = true;
              }
            }
            if (appended) {
               if (!metadata.tracks) metadata.tracks = {};
               if (!metadata.tracks[issue.key]) metadata.tracks[issue.key] = {};
               metadata.tracks[issue.key].jira_last_comment_synced = new Date().toISOString();
            }
          }
        }
      } catch (err) {
        console.error(`[jira-polling error] Processing ${issue.key}: ${err.message}`);
      }
    }

    // ── Outbound sync: push FS-newer tracks to Jira ──────────────────────────────
    console.log('[jira-polling] Starting outbound sync phase...');
    const tracksDir = 'conductor/tracks';
    if (existsSync(tracksDir)) {
      const trackDirs = readdirSync(tracksDir).filter((d) => {
        const fullPath = join(tracksDir, d);
        return statSync(fullPath).isDirectory() && (d.match(/^LAN-\d+/) || d.match(/^\d+/));
      });

      for (const trackDir of trackDirs) {
        try {
          const trackPath = join(tracksDir, trackDir);
          const indexPath = join(trackPath, 'index.md');
          if (!existsSync(indexPath)) continue;

          // Extract track number from folder name
          const match = trackDir.match(/^((?:LAN-)?\d+)-/);
          if (!match) continue;
          const trackKey = match[1];

          // Get FS modification time
          const indexStat = statSync(indexPath);
          const fsMtime = indexStat.mtime.toISOString();

          // Get Jira update time from metadata
          const trackMeta = metadata.tracks?.[trackKey];
          const jiraUpdated = trackMeta?.jira_last_synced
            ? new Date(trackMeta.jira_last_synced)
            : new Date(0);
          const fsModified = new Date(fsMtime);
          const timeDiffMs = Math.abs(jiraUpdated - fsModified);

          // Skip within grace period
          if (timeDiffMs < gracePeriodMs) continue;

          // If FS is newer than Jira, push it
          if (fsModified > jiraUpdated) {
            console.log(`[jira-push] ${trackKey}: FS newer, pushing to Jira...`);

            // Read track data from filesystem
            const indexContent = readFileSync(indexPath, 'utf8');
            const titleMatch = indexContent.match(/^# (.+)$/m);
            const title = titleMatch ? titleMatch[1] : `Issue ${trackKey}`;
            
            const planContent = readIfExists(join(trackPath, 'plan.md'));
            const specContent = readIfExists(join(trackPath, 'spec.md'));
            const testContent = readIfExists(join(trackPath, 'test.md'));
            const logContent = readIfExists(join(trackPath, 'log.md'));
 
            const trackData = {
              track_number: trackKey,
              title: title,
              indexContent: indexContent,
              planContent: planContent,
              specContent: specContent,
              testContent: testContent,
              logContent: logContent,
              lane: extractLaneFromIndex(indexContent),
              status: extractLaneStatusFromIndex(indexContent),
            };
 
            // Push to Jira
            if (!trackMeta?.jira_key) {
              console.log(`[jira-push] ${trackKey}: No Jira key, creating issue...`);
              const issueKey = await createJiraIssue(jiraConfig, trackData);
              if (issueKey) {
                if (!metadata.tracks) metadata.tracks = {};
                if (!metadata.tracks[trackKey]) metadata.tracks[trackKey] = {};
                metadata.tracks[trackKey].jira_key = issueKey;
                metadata.tracks[trackKey].jira_last_synced = new Date().toISOString();
                console.log(`[jira-push] ${trackKey}: Created Jira issue ${issueKey}`);
              }
            } else {
              const success = await pushTrackToJira(jiraConfig, trackMeta.jira_key, trackData);
              if (success) {
                console.log(`[jira-push] ${trackKey}: Successfully pushed to Jira (${trackMeta.jira_key})`);
                if (!metadata.tracks) metadata.tracks = {};
                if (!metadata.tracks[trackKey]) metadata.tracks[trackKey] = {};
                metadata.tracks[trackKey].jira_last_synced = new Date().toISOString();
              } else {
                console.error(`[jira-push] ${trackKey}: Failed to push to Jira (${trackMeta.jira_key})`);
              }
            }
          }
        } catch (err) {
          console.error(`[jira-push error] ${trackDir}: ${err.message}`);
        }
      }
    }

    // Update global last sync timestamp
    metadata._jira_last_poll = new Date().toISOString();
    saveTracksMetadata(metadata);

    console.log(`[jira-polling] Sync complete: ${issues.length} issues processed, outbound sync done`);
  } catch (err) {
    console.error('[jira-polling error]:', err.message);
  } finally {
    jiraPollRunning = false;
  }
}

runJiraSync(); // Run immediately on startup
setInterval(runJiraSync, 60000); // Poll every 60 seconds

// ── Auto-implement + auto-review ──────────────────────────────────────────────

const runningPids = new Set();

async function checkFileSyncQueue() {
  if (getIsLocalFs()) return;

  const cls = getCollectors();
  const proj = getProject();
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    const url = c.url;
    const token = resolveCollectorToken(i);

    try {
      const { tasks } = await post(url, token, '/file-sync/claim', { project_id: proj.id, limit: 5 });
      if (!tasks?.length) continue;

      for (const task of tasks) {
        console.log(`[sync-queue] Processing task ${task.id} from ${url}: ${task.file_path} (${task.operation || 'overwrite'})`);
        try {
          const fullPath = join(process.cwd(), task.file_path);
          const dir = dirname(fullPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          if (task.operation === 'append') {
            appendFileSync(fullPath, task.content, 'utf8');
            console.log(`[sync-queue] Appended to file: ${task.file_path}`);
          } else {
            writeFileSync(fullPath, task.content, 'utf8');
            console.log(`[sync-queue] Wrote file: ${task.file_path}`);
          }

          await patch(url, token, `/file-sync/${task.id}`, { status: 'done' });
        } catch (err) {
          logger.error({ err, taskId: task.id, url }, '[sync-queue] Failed task');
          await patch(url, token, `/file-sync/${task.id}`, { status: 'error', error_message: err.message });
        }
      }
    } catch (err) {
      logger.error({ err, url }, '[sync-queue error]');
    }
  }
}

// ── File Sync Queue processor (filesystem-side message bus) ───────────────────
// Reads conductor/tracks/file_sync_queue.md, processes pending entries.
// This is the filesystem-side parallel to the DB file_sync_queue table.

function parseFileSyncQueue(queuePath) {
  if (!existsSync(queuePath)) return [];
  const content = readFileSync(queuePath, 'utf8');
  const entries = [];

  // Match each ### heading block (entry starts at ### and ends at next ### or ##)
  const entryRegex = /### ([^\n]+)\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const heading = match[1].trim();
    const body = match[2];

    const get = (key) => {
      const m = body.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*([^\\n]+)`, 'i'));
      return m ? m[1].trim() : null;
    };

    const status = get('Status');
    const type = get('Type');
    const title = get('Title') || heading;
    const description = get('Description');
    const created = get('Created');

    entries.push({ heading, status, type, title, description, created, raw: match[0] });
  }
  return entries;
}

function updateFileSyncQueueEntry(queuePath, heading, newStatus) {
  if (!existsSync(queuePath)) return;
  let content = readFileSync(queuePath, 'utf8');
  // Replace the Status marker within this specific entry block
  const entryStart = content.indexOf(`### ${heading}`);
  if (entryStart === -1) return;
  const nextEntry = content.indexOf('\n### ', entryStart + 1);
  const nextSection = content.indexOf('\n## ', entryStart + 1);
  const entryEnd = Math.min(
    nextEntry === -1 ? Infinity : nextEntry,
    nextSection === -1 ? Infinity : nextSection
  );
  const entryText = entryEnd === Infinity ? content.slice(entryStart) : content.slice(entryStart, entryEnd);
  const updatedEntry = entryText.replace(/\*\*Status\*\*:\s*[^\n]+/, `**Status**: ${newStatus}`);
  content = content.slice(0, entryStart) + updatedEntry + (entryEnd === Infinity ? '' : content.slice(entryEnd));
  writeFileSync(queuePath, content, 'utf8');
}

function moveEntryToCompleted(queuePath, heading, processedStatus) {
  if (!existsSync(queuePath)) return;
  let content = readFileSync(queuePath, 'utf8');

  const entryStart = content.indexOf(`### ${heading}`);
  if (entryStart === -1) return;
  const nextEntry = content.indexOf('\n### ', entryStart + 1);
  const nextSection = content.indexOf('\n## ', entryStart + 1);
  const entryEnd = Math.min(
    nextEntry === -1 ? Infinity : nextEntry,
    nextSection === -1 ? Infinity : nextSection
  );
  const entryText = entryEnd === Infinity ? content.slice(entryStart) : content.slice(entryStart, entryEnd);

  // Update status + add Processed timestamp
  const now = new Date().toISOString();
  let updatedEntry = entryText
    .replace(/\*\*Status\*\*:\s*[^\n]+/, `**Status**: ${processedStatus}`)
    .replace(/\*\*Metadata\*\*:[^\n]+\n?/, ''); // strip metadata from completed entry
  if (!updatedEntry.includes('**Processed**:')) {
    updatedEntry = updatedEntry.trimEnd() + `\n**Processed**: ${now}\n`;
  }

  // Remove from current position
  const before = content.slice(0, entryStart);
  const after = entryEnd === Infinity ? '' : content.slice(entryEnd);
  content = before + after;

  // Append to Completed Queue section
  const completedIdx = content.indexOf('## Completed Queue');
  if (completedIdx !== -1) {
    content = content.slice(0, completedIdx + '## Completed Queue'.length) +
      '\n\n' + updatedEntry.trim() +
      content.slice(completedIdx + '## Completed Queue'.length);
  } else {
    content = content.trimEnd() + '\n\n## Completed Queue\n\n' + updatedEntry.trim() + '\n';
  }

  // Update Last processed timestamp
  content = content.replace(/^Last processed:.*$/m, `Last processed: ${now}`);
  writeFileSync(queuePath, content, 'utf8');
}

const QUEUE_PROCESSING_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

async function processFileSyncQueue() {
  const queuePath = 'conductor/tracks/file_sync_queue.md';
  const entries = parseFileSyncQueue(queuePath);

  // Reset stale 'processing' entries (worker crashed mid-processing) → back to 'pending'
  const staleProcessing = entries.filter(e => e.status === 'processing' && e.created);
  for (const entry of staleProcessing) {
    const age = Date.now() - new Date(entry.created).getTime();
    if (age > QUEUE_PROCESSING_TIMEOUT_MS) {
      console.warn(`[file-queue] Resetting stale processing entry (${Math.round(age / 60000)}m): "${entry.heading}"`);
      updateFileSyncQueueEntry(queuePath, entry.heading, 'pending');
    }
  }

  // Re-read after potential status resets
  const pendingEntries = parseFileSyncQueue(queuePath).filter(e => e.status === 'pending');
  if (!pendingEntries.length) return;

  console.log(`[file-queue] Found ${pendingEntries.length} pending entries`);

  for (const entry of pendingEntries) {
    try {
      updateFileSyncQueueEntry(queuePath, entry.heading, 'processing');

      if (entry.type === 'track-create') {
        await handleTrackCreate(entry, queuePath);
      } else if (entry.type === 'config-sync') {
        await handleConfigSync(entry, queuePath);
      } else {
        console.warn(`[file-queue] Unknown entry type: ${entry.type} for "${entry.heading}"`);
        moveEntryToCompleted(queuePath, entry.heading, 'skipped');
      }
    } catch (err) {
      console.error(`[file-queue] Error processing "${entry.heading}": ${err.message}`);
      updateFileSyncQueueEntry(queuePath, entry.heading, 'failed');
    }
  }
}

async function handleTrackCreate(entry, queuePath) {
  const tracksDir = 'conductor/tracks';
  const title = entry.title || entry.heading;
  const description = entry.description || '';

  // Extract track number from heading (e.g. "Track 1026: Title" → "1026")
  const numMatch = entry.heading.match(/Track\s+(\d+)/i);
  if (!numMatch) {
    console.warn(`[file-queue] Cannot extract track number from heading: ${entry.heading}`);
    moveEntryToCompleted(queuePath, entry.heading, 'failed');
    return;
  }
  const trackNumber = numMatch[1];

  // Check if track folder already exists (may have been manually created or created by lc cli)
  const existingDir = resolveTrackFolder(tracksDir, trackNumber);
  if (existingDir) {
    console.log(`[file-queue] Track ${trackNumber} folder already exists (${existingDir}), skipping folder creation`);
    // Still sync to DB — the normal chokidar/syncTrack path handles this
    const indexPath = join(tracksDir, existingDir, 'index.md');
    if (existsSync(indexPath)) {
      // Track 1076: only mark this entry "processed" once the DB write is
      // actually confirmed — previously this checked syncTrack() via
      // try/catch, but syncTrack() catches its own collector-POST failures
      // internally and never rejects, so the catch here was dead code and
      // the entry always got marked processed regardless of success. Now
      // syncTrack() returns a boolean instead. Leaving it "pending" on
      // failure lets the next heartbeat cycle retry (the exact failure mode
      // that silently dropped Tracks 1074/1075 during this session).
      const synced = await syncTrack(indexPath);
      if (!synced) {
        console.warn(`[file-queue] Failed to syncTrack for existing ${trackNumber} — leaving entry pending for retry`);
        updateFileSyncQueueEntry(queuePath, entry.heading, 'pending');
        return;
      }
    }
    moveEntryToCompleted(queuePath, entry.heading, 'processed');
    return;
  }

  // Generate slug from title
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const trackDir = `${trackNumber}-${slug}`;
  const trackPath = join(tracksDir, trackDir);

  // Create folder structure
  mkdirSync(trackPath, { recursive: true });

  const indexContent = `# Track ${trackNumber}: ${title}\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: Planning\n**Summary**: ${description.slice(0, 120)}\n\n## Problem\n${description}\n\n## Solution\n[Empty — awaiting scaffolding]\n\n## Phases\n- [ ] Phase 1: Planning\n`;
  writeFileSync(join(trackPath, 'index.md'), indexContent, 'utf8');
  writeFileSync(join(trackPath, 'spec.md'), `# Spec: ${title}\n\n## Problem Statement\n${description}\n\n## Requirements\n- REQ-1: ...\n\n## Acceptance Criteria\n- [ ] Criterion 1\n`, 'utf8');
  writeFileSync(join(trackPath, 'plan.md'), `# Track ${trackNumber}: ${title}\n\n## Phase 1: Planning\n\n- [ ] Task 1: Define requirements\n`, 'utf8');
  const testContent = `# Tests: Track ${trackNumber} — ${title}\n\n## Test Commands\n\`\`\`bash\n# Run all tests\nnpm test\n\`\`\`\n\n## Test Cases\n\n### Feature: ${title}\n- [ ] TC-1: Define requirements verification — expected: Spec is fully formulated\n\n## Acceptance Criteria\n- [ ] All unit tests pass\n- [ ] No regressions in related features\n`;
  writeFileSync(join(trackPath, 'test.md'), testContent, 'utf8');

  console.log(`[file-queue] Created track folder: ${trackDir}`);

  // Track 1076: only mark this entry "processed" once at least one of the two
  // DB-sync attempts below actually succeeds — folder creation is idempotent
  // (the `existingDir` branch above handles re-runs), so it's safe to leave
  // the entry "pending" and let the next heartbeat cycle retry rather than
  // silently trusting an unverified "DB can sync later" assumption, which
  // previously lost the track-create request whenever the collector was
  // briefly down or overloaded (see Tracks 1074/1075 during this session).
  let dbSynced = getIsLocalFs(); // no DB to sync in local-fs mode

  // Register in DB via API (if not local-fs mode)
  if (!getIsLocalFs()) {
    try {
      const { url, token } = primaryCollector();
      const proj = getProject();
      await post(url, token, '/track', {
        project_id: proj.id,
        track_number: trackNumber,
        title,
        lane_status: 'plan',
        lane_action_status: 'queue',
        progress_percent: 0,
        last_updated_by: 'worker',
      });
      console.log(`[file-queue] Registered track ${trackNumber} in DB`);
      dbSynced = true;
    } catch (err) {
      console.warn(`[file-queue] Failed to register track ${trackNumber} in DB: ${err.message}`);
    }
  }

  // Sync the new index.md to DB via normal syncTrack path — a second chance
  // to confirm the row exists even if the direct POST above failed.
  // syncTrack() returns a boolean rather than throwing (it catches its own
  // collector-POST failures internally) — check the return value directly
  // rather than try/catch, which would never have caught a real failure here.
  const syncedViaSyncTrack = await syncTrack(join(trackPath, 'index.md'));
  if (syncedViaSyncTrack) dbSynced = true;

  if (dbSynced) {
    moveEntryToCompleted(queuePath, entry.heading, 'processed');
    console.log(`[file-queue] Processed track-create for track ${trackNumber}`);
  } else {
    console.warn(`[file-queue] Track ${trackNumber}'s folder was created but both DB sync attempts failed — leaving entry pending for retry`);
    updateFileSyncQueueEntry(queuePath, entry.heading, 'pending');
  }
}

async function handleConfigSync(entry, queuePath) {
  const key = entry.heading.replace(/^Request:\s*/i, '').trim();
  // Config sync entries are informational markers — actual sync happens via .laneconductor.json watcher
  console.log(`[file-queue] Config sync entry: ${key} — marking processed`);
  moveEntryToCompleted(queuePath, entry.heading, 'processed');
}

async function checkClaudeCapacity() {
  const { url, token } = primaryCollector();
  return new Promise(resolve => {
    // Run a cheap/meaningless prompt to see if we get the rate limit message
    const proc = spawn('claude', ['-p', 'test'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.stderr.on('data', d => output += d);

    proc.on('exit', async (code) => {
      // If code is 0, it means it answered successfully
      const available = code === 0;
      if (!available) {
        let resetAt = new Date(Date.now() + 60000); // 1 min default just in case

        // Output usually contains: "You've hit your limit · resets 3pm (Europe/Berlin)"
        if (output.includes("hit your limit") || output.includes("exhausted") || output.includes("resets")) {
          const match = output.match(/resets\s+(\d{1,2})(:?\d{2})?(am|pm)/i);
          if (match) {
            let h = parseInt(match[1]);
            const isPM = match[3].toLowerCase() === 'pm';
            if (isPM && h !== 12) h += 12;
            if (!isPM && h === 12) h = 0;

            const now = new Date();
            resetAt = new Date(now);
            resetAt.setHours(h, match[2] ? parseInt(match[2].slice(1)) : 0, 0, 0);

            // If the time parsed is in the past, it means it resets tomorrow
            if (resetAt <= now) {
              resetAt.setDate(resetAt.getDate() + 1);
            }
          } else {
            // Fallback to 15m if we know it's exhausted but couldn't parse time
            resetAt = new Date(Date.now() + 15 * 60000);
          }
        }

        await post(url, token, '/provider-status', {
          provider: 'claude', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Capacity exhausted'
        }).catch(() => { });
        console.log(`[status] Claude capacity exhausted, marking in DB (cool down until ${resetAt.toISOString()})`);
      }
      resolve(available);
    });
  });
}

async function isProviderAvailable(provider) {
  if (!provider) return false;

  // 1. Check in-memory cache first
  const cached = providerStatusCache.get(provider);
  if (cached) {
    if (cached.status !== 'exhausted') return true;
    if (!cached.reset_at) return false;
    const resetAt = new Date(cached.reset_at);
    const now = new Date();
    if (resetAt < now) {
      console.log(`[status] in-memory: ${provider} reset time passed, marking available`);
      providerStatusCache.delete(provider);
      return true;
    }
    return false;
  }

  // 2. No cache (or local-fs mode), check DB if possible
  if (getIsLocalFs()) return true; // Default to true in local-fs if not in cache

  const { url, token } = primaryCollector();
  try {
    const { providers = [] } = (await get(url, token, '/provider-status')) || {};
    const p = providers.find(x => x.provider === provider);

    // Update cache with DB state (always, to stay in sync)
    if (p) {
      providerStatusCache.set(provider, {
        status: p.status,
        reset_at: p.reset_at,
        last_error: p.last_error
      });
    }

    if (!p || p.status !== 'exhausted') {
      return true;
    }

    if (!p.reset_at) return false;
    const resetAt = new Date(p.reset_at);
    const now = new Date();
    if (resetAt < now) {
      providerStatusCache.delete(provider);
      return true;
    }
    return false;
  } catch (err) {
    // console.error(`[status error] failed to check ${provider} availability:`, err.message);
    return true; // Fallback to true if DB check fails
  }
}

async function checkExhaustion(logPath, cli) {
  if (!existsSync(logPath) || !cli) return;
  await new Promise(r => setTimeout(r, 1000)); // wait longer for flush
  const content = readFileSync(logPath, 'utf8');
  const { url, token } = primaryCollector();

  console.log(`[exhaustion] Checking ${cli} log (${content.length} bytes)...`);
  if (content.length < 200) console.log(`[exhaustion] Content: "${content.trim()}"`);

  // Gemini: TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 1h34m27s.
  // Regex needs to be robust to spaces, case, and missing components
  const geminiMatch = content.match(/quota will reset after\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
  const hasHours = geminiMatch?.[1] !== undefined;
  const hasMins = geminiMatch?.[2] !== undefined;
  const hasSecs = geminiMatch?.[3] !== undefined;

  if (isProviderExhausted(content, cli) && (cli === 'gemini' || cli === 'npx' || cli === 'antigravity' || cli === 'agy')) {
    const hours = parseInt(geminiMatch?.[1] || 0);
    const mins = parseInt(geminiMatch?.[2] || 0);
    const secs = parseInt(geminiMatch?.[3] || 0);
    const resetMs = (hours * 3600 + mins * 60 + secs) * 1000;
    const resetAt = new Date(Date.now() + (resetMs > 0 ? resetMs : 60000));
    // Only POST if status changed in cache
    const cached = providerStatusCache.get(cli);
    if (!cached || cached.status !== 'exhausted') {
      console.log(`[exhaustion] Provider ${cli} exhausted! Reset in ${hours}h ${mins}m ${secs}s -> ${resetAt.toISOString()}`);

      // Update in-memory cache
      providerStatusCache.set(cli, {
        status: 'exhausted',
        reset_at: resetAt.toISOString(),
        last_error: 'Quota exhausted'
      });

      await post(url, token, '/provider-status', {
        provider: cli, status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Quota exhausted'
      }).catch(() => { });
    }
    return;
  }

  // Claude: generic 429 detection and limit messages
  if (cli === 'claude' && isProviderExhausted(content, cli)) {
    // Try to parse reset time if present (e.g. "resets 7am")
    let resetAt = new Date(Date.now() + 60000); // 1 min default
    const resetMatch = content.match(/resets\s+(\d+)(am|pm)/i);
    if (resetMatch) {
      const hour = (parseInt(resetMatch[1]) % 12) + (resetMatch[2].toLowerCase() === 'pm' ? 12 : 0);
      resetAt = new Date();
      resetAt.setHours(hour, 0, 0, 0);
      if (resetAt < new Date()) resetAt.setDate(resetAt.getDate() + 1); // tomorrow
    }

    const cached = providerStatusCache.get('claude');
    if (!cached || cached.status !== 'exhausted') {
      console.log(`[exhaustion] Claude exhausted! Reset at: ${resetAt.toISOString()}`);

      // Update in-memory cache
      providerStatusCache.set('claude', {
        status: 'exhausted',
        reset_at: resetAt.toISOString(),
        last_error: 'Rate limited'
      });

      await post(url, token, '/provider-status', {
        provider: 'claude', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Rate limited'
      }).catch(() => { });
    }
  }
}

function tailLog(logPath, lines = 100) {
  try {
    if (!existsSync(logPath)) return null;
    const content = readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-lines).join('\n');
  } catch (err) { return `Error reading log: ${err.message}`; }
}

// ── Git Lock + Worktree Helpers (Track 1010) ──────────────────────────────────

// Never let git prompt for credentials in any interactive terminal
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' };
const gitExec = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', env: GIT_ENV });

let cachedMainBranch = null;
function getMainBranch() {
  if (cachedMainBranch) return cachedMainBranch;
  try {
    const remotes = execSync('git remote show origin', { encoding: 'utf8', env: GIT_ENV });
    const m = remotes.match(/HEAD branch: (.*)/);
    if (m && m[1]) {
      cachedMainBranch = m[1].trim();
      return cachedMainBranch;
    }
  } catch (e) { }

  try {
    const branches = execSync('git branch -a', { encoding: 'utf8', env: GIT_ENV });
    if (branches.includes('remotes/origin/main')) cachedMainBranch = 'main';
    else if (branches.includes('remotes/origin/master')) cachedMainBranch = 'master';
    else cachedMainBranch = 'master'; // fallback
  } catch (e) {
    cachedMainBranch = 'master';
  }
  return cachedMainBranch;
}

async function checkAndClaimGitLock(trackNumber) {
  const lockDir = join(process.cwd(), '.conductor', 'locks');
  const lockFile = join(lockDir, `${trackNumber}.lock`);

  try {
    // Ensure .conductor/locks directory exists
    mkdirSync(lockDir, { recursive: true });

    // Fetch latest locks from git
    try {
      gitExec(`git fetch origin ${getMainBranch()} --quiet`, process.cwd());
    } catch (e) {
      console.warn(`[git-lock] git fetch failed: ${e.message}`);
    }

    // Check if lock already exists
    if (existsSync(lockFile)) {
      const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
      const lockAge = Date.now() - new Date(lock.started_at).getTime();
      const staleTimeout = 5 * 60 * 1000; // 5 minutes
      const isSameMachine = lock.machine === os.hostname();
      let isDead = false;
      if (isSameMachine && lock.pid) {
        try {
          process.kill(lock.pid, 0); // Check if PID exists
        } catch (e) {
          isDead = true;
        }
      }

      if (lockAge < staleTimeout && !isDead) {
        throw new Error(`Track ${trackNumber} locked by ${lock.user}@${lock.machine}${lock.pid ? ` (PID: ${lock.pid})` : ''} (age: ${Math.round(lockAge / 1000)}s)`);
      }

      // Stale or dead lock - remove it
      console.log(`[git-lock] Removing ${isDead ? 'dead' : 'stale'} lock for track ${trackNumber} (age: ${Math.round(lockAge / 1000)}s)`);
      rmSync(lockFile);
    }

    // Create new lock file
    const lockData = {
      user: process.env.USER || os.userInfo().username || 'unknown',
      machine: os.hostname(),
      pid: process.pid,
      started_at: new Date().toISOString(),
      cli: 'claude',
      track_number: trackNumber,
      lane: 'in-progress',
      pattern: 'daemon'
    };

    writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf8');

    // Sync lock to API
    if (!getIsLocalFs()) {
      const { url, token } = primaryCollector();
      await post(url, token, `/track/${trackNumber}/lock`, {
        user: lockData.user,
        machine: lockData.machine,
        pattern: lockData.pattern,
        lock_file_path: lockFile
      }).catch(err => console.warn(`[git-lock] Failed to sync lock to API: ${err.message}`));
    }

    // Commit track files to git so the worktree can see the latest state
    // (lock file itself is gitignored — only track files need committing)
    try {
      const tracksDir = join(process.cwd(), 'conductor', 'tracks');
      const trackDir = resolveTrackFolder(tracksDir, trackNumber);
      if (trackDir) {
        gitExec(`git add "${join(tracksDir, trackDir)}"`, process.cwd());
        gitExec(`git commit -m "chore(track-${trackNumber}): sync files before worktree" --quiet`, process.cwd());
        console.log(`[git-lock] Synced track files to git for worktree`);
      }
    } catch (e) {
      // If nothing to commit, that's fine
    }

    return lockFile;
  } catch (err) {
    console.error(`[git-lock] Error claiming lock: ${err.message}`);
    throw err;
  }
}

// Path isolation validation — ensures worktree paths can't escape the project
// root. Lives in conductor/services/path-isolation.mjs (track 1112) so
// conductor/services/worktree-merge.mjs can reuse the identical check
// without importing this file (which has setInterval/chokidar side effects
// at module load).
function validatePathIsolation(trackNumber, proposedPath, projectRoot) {
  return sharedValidatePathIsolation(trackNumber, proposedPath, projectRoot ?? process.cwd());
}

async function createWorktree(trackNumber) {
  // Resolve the PRIMARY checkout, not just process.cwd() — a worker's cwd
  // can itself be inside a linked worktree (e.g. running track 1112's own
  // work from .worktrees/1112). Building the path off cwd directly nests
  // the new worktree inside the current one (.worktrees/1112/.worktrees/9998)
  // instead of the repo root's .worktrees/9998. Once the parent worktree is
  // later removed, the nested one is orphaned: prunable, detached HEAD,
  // reappearing on every worktree scan. See conductor/tests/track-1112-worktree-audit.test.mjs:172.
  const repoRoot = resolvePrimaryRepoRoot(process.cwd());
  const worktreePath = join(repoRoot, '.worktrees', `${trackNumber}`);
  const parentDir = join(repoRoot, '.worktrees');
  const lifecycle = getWorktreeLifecycle();

  try {
    // Validate path isolation before proceeding
    validatePathIsolation(trackNumber, worktreePath, repoRoot);
    // Ensure parent directory exists
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Check if worktree exists and mode is per-cycle
    if (lifecycle === 'per-cycle' && existsSync(worktreePath)) {
      console.log(`[worktree] Reusing existing worktree for track ${trackNumber} (per-cycle mode)`);
      return worktreePath;
    }

    // Cleanup if exists (always for per-lane, or if per-cycle and worktree doesn't exist yet)
    try {
      gitExec(`git worktree remove --force "${worktreePath}"`, process.cwd());
      // Force remove directory if still there (git sometimes leaves it)
      if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    } catch (e) {
      if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    }

    try {
      gitExec('git worktree prune', process.cwd());
    } catch (e) { }

    // Create worktree from current HEAD with a named branch for proper merge later
    // If per-cycle and branch exists AND its worktree is still there, we
    // already returned above — this only runs when the worktree needs
    // (re)creating. Track 1114 (found live, real data loss): unconditional
    // `-B` here force-resets an EXISTING branch to HEAD, discarding
    // whatever commits it already had — correct for a genuinely new
    // track, destructive for one just being resumed after its worktree
    // was cleaned up (e.g. via Remove Worktree) while the branch itself
    // still holds real work. Only force-create when the branch is
    // genuinely new.
    const branchName = `track-${trackNumber}`;
    let branchExists = false;
    try {
      gitExec(`git rev-parse --verify --quiet "refs/heads/${branchName}"`, process.cwd());
      branchExists = true;
    } catch (e) { /* non-zero exit — branch doesn't exist, that's fine */ }
    // resolveWorktreeAddArgs owns the safety-critical decision (tested in
    // isolation — see track-1114-worktree-create-args.test.mjs); this just
    // renders its result into a quoted command matching this file's other
    // gitExec call sites.
    const addArgs = resolveWorktreeAddArgs({ branchExists, branchName, worktreePath, startPoint: 'HEAD' });
    gitExec(
      addArgs.includes('-B')
        ? `git worktree add -B "${branchName}" "${worktreePath}" HEAD`
        : `git worktree add "${worktreePath}" "${branchName}"`,
      process.cwd()
    );

    // Small delay to ensure OS filesystem catchup (especially on network mounts or slow disks)
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!existsSync(worktreePath)) {
      throw new Error(`Directory still does not exist after git worktree add: ${worktreePath}`);
    }

    console.log(`[worktree] Created worktree for track ${trackNumber} at ${worktreePath}`);

    // Copy essential config files (which might be gitignored or uncommitted)
    // file_sync_queue.md is written by API/humans but never committed — copy so planning agents see it
    const configs = ['.laneconductor.json', 'conductor/workflow.json', 'conductor/tracks/file_sync_queue.md'];
    for (const cfg of configs) {
      const src = join(repoRoot, cfg);
      const dest = join(worktreePath, cfg);
      if (existsSync(src)) {
        try {
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(src, dest);
        } catch (e) {
          console.warn(`[worktree] Failed to copy ${cfg} to worktree: ${e.message}`);
        }
      }
    }

    // Copy .claude directory for skills
    const claudeSrc = join(repoRoot, '.claude');
    const claudeDest = join(worktreePath, '.claude');
    if (existsSync(claudeSrc)) {
      try {
        execSync(`cp -r "${claudeSrc}" "${claudeDest}"`, { stdio: 'pipe' });
      } catch (e) {
        console.warn(`[worktree] Failed to copy .claude to worktree: ${e.message}`);
      }
    }

    return worktreePath;
  } catch (err) {
    console.error(`[worktree] Error creating worktree: ${err.message}`);
    throw err;
  }
}

async function releaseGitLock(trackNumber) {
  const lockDir = join(process.cwd(), '.conductor', 'locks');
  const lockFile = join(lockDir, `${trackNumber}.lock`);

  try {
    if (!existsSync(lockFile)) {
      console.log(`[git-lock] Lock file not found for track ${trackNumber}, skipping release`);
      return;
    }

    rmSync(lockFile);

    // Sync unlock to API
    if (!getIsLocalFs()) {
      const { url, token } = primaryCollector();
      await post(url, token, `/track/${trackNumber}/unlock`, {})
        .catch(err => console.warn(`[git-lock] Failed to sync unlock to API: ${err.message}`));
    }

    // Lock dir is gitignored — no need to commit or push its removal
    console.log(`[git-lock] Released lock for track ${trackNumber}`);
  } catch (err) {
    console.error(`[git-lock] Error releasing lock: ${err.message}`);
  }
}

// Dogfooding 2026-08-25: checkAndClaimGitLock() above prevents two
// sessions from claiming the SAME track, but does nothing to stop two
// DIFFERENT main-mode tracks from running concurrently against the SAME
// primary checkout — main mode has no worktree, so both sessions share
// one working directory with no isolation between them at all. Confirmed
// live: one main-mode session's own file operations (scaffold writes,
// artifact copies, or a routine sweep — root cause not yet pinned down)
// deleted a SECOND main-mode track's uncommitted folder mid-run while
// both were active at once. Per-track locking can't catch this by
// construction — it's scoped to one track number, and this is a
// cross-track collision. A single global lock, held for the duration of
// ANY main-mode spawn (acquired/released exactly where the per-track
// lock already is, in spawnCli), makes "at most one main-mode session at
// a time" an actual invariant instead of a probabilistic accident of
// timing. Branch-mode sessions never touch this — they're already
// isolated in their own worktree, this lock has nothing to protect there.
// Mirrors checkAndClaimGitLock's own shape (stale timeout, PID liveness
// check) deliberately, for one operator-facing lock file family instead
// of two different ones to reason about.
async function checkAndClaimGlobalMainModeLock(trackNumber) {
  const lockDir = join(process.cwd(), '.conductor', 'locks');
  const lockFile = join(lockDir, '_main-mode-global.lock');

  mkdirSync(lockDir, { recursive: true });

  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    const lockAge = Date.now() - new Date(lock.started_at).getTime();
    const staleTimeout = 5 * 60 * 1000; // 5 minutes — same convention as checkAndClaimGitLock
    const isSameMachine = lock.machine === os.hostname();
    let isDead = false;
    if (isSameMachine && lock.pid) {
      try {
        process.kill(lock.pid, 0);
      } catch (e) {
        isDead = true;
      }
    }

    if (lockAge < staleTimeout && !isDead) {
      throw new Error(`Main-mode is busy with track ${lock.track_number} (locked by ${lock.user}@${lock.machine}${lock.pid ? ` PID: ${lock.pid}` : ''}, age: ${Math.round(lockAge / 1000)}s)`);
    }

    console.log(`[main-mode-lock] Removing ${isDead ? 'dead' : 'stale'} global main-mode lock (was held for track ${lock.track_number}, age: ${Math.round(lockAge / 1000)}s)`);
    rmSync(lockFile);
  }

  const lockData = {
    user: process.env.USER || os.userInfo().username || 'unknown',
    machine: os.hostname(),
    pid: process.pid,
    started_at: new Date().toISOString(),
    track_number: trackNumber,
  };
  writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf8');
  console.log(`[main-mode-lock] Claimed global main-mode lock for track ${trackNumber}`);
  return lockFile;
}

async function releaseGlobalMainModeLock() {
  const lockFile = join(process.cwd(), '.conductor', 'locks', '_main-mode-global.lock');
  try {
    if (!existsSync(lockFile)) return;
    rmSync(lockFile);
    console.log('[main-mode-lock] Released global main-mode lock');
  } catch (err) {
    console.error(`[main-mode-lock] Error releasing global main-mode lock: ${err.message}`);
  }
}

async function removeWorktree(trackNumber) {
  const repoRoot = resolvePrimaryRepoRoot(process.cwd());
  const worktreePath = join(repoRoot, '.worktrees', `${trackNumber}`);

  try {
    if (!existsSync(worktreePath)) {
      console.log(`[worktree] Worktree not found for track ${trackNumber}, skipping removal`);
      return;
    }

    gitExec(`git worktree remove --force "${worktreePath}"`, process.cwd());
    console.log(`[worktree] Removed worktree for track ${trackNumber}`);
  } catch (err) {
    console.warn(`[worktree] Error removing worktree: ${err.message}`);
  }
}

// Track 1112 Phase 3 (RC-A fix): merging no longer depends on the worktree
// directory existing at all — mergeWorktreeBranch() operates purely off the
// branch ref, in its own ephemeral scratch worktree, so a directory that
// was already removed by any other path (a failed run, `per-lane`
// lifecycle, a manual `git worktree remove`/`prune`) no longer strands the
// branch forever. mergeWorktreeBranch() also owns removing the ORIGINAL
// per-track worktree itself now (not this function) — it has to happen
// before branch deletion, not after; see that function's doc comment for
// the real bug (silently-undeleted branches) that ordering caused.
// Track 10018: reads a track's merge_mode straight from its own index.md
// (rather than the DB) so this decision works identically in local-fs mode
// (no DB/collector at all) and never races the file→DB sync. Self-contained
// on purpose — deliberately doesn't reuse any `content`/`trackDir` variable
// from the caller's outer scope, since those are declared deep inside a
// sibling try-block whose scope this function must not depend on. Defaults
// to 'pr' (the safe default) on any read failure, same as resolveMergeMode.
function readTrackMergeMode(root, trackNumber) {
  try {
    const tracksDir = join(root, 'conductor', 'tracks');
    const trackDir = resolveTrackFolder(tracksDir, trackNumber);
    if (!trackDir) return 'pr';
    const indexPath = join(tracksDir, trackDir, 'index.md');
    if (!existsSync(indexPath)) return 'pr';
    const idx = readFileSync(indexPath, 'utf8');
    return resolveMergeMode({ merge_mode: parseMergeModeMarker(idx) });
  } catch {
    return 'pr';
  }
}

// Track 10018 Phase 2: the PR-mode counterpart to mergeAndRemoveWorktree —
// pushes the branch and opens a PR instead of merging locally, and leaves
// the worktree/branch fully intact (the reconcile loop's PR poller, not
// this function, is what eventually cleans up once GitHub reports MERGED).
// Never falls back to a local merge on failure — per spec, a `gh`
// precondition failure must be loud (a track comment + pr_status note),
// not a silent divergence from the mode the track asked for.
async function openTrackPrOnDone(trackNumber, worktreePath) {
  const mainBranch = getMainBranch();
  const primaryRoot = resolvePrimaryRepoRoot(worktreePath);

  const auth = checkGhAuth({ cwd: worktreePath });
  if (!auth.ok) {
    const msg = `gh CLI is not authenticated — cannot open a PR for track ${trackNumber} (merge_mode: pr). Run 'gh auth login' on this machine. Branch and worktree left in place; track NOT merged.`;
    console.error(`[pr-flow] ${msg}`);
    await postToCollectors(`/track/${trackNumber}/comment`, { author: 'system', body: `⚠️ ${msg}` }).catch(() => {});
    await patchTrackPrFields(trackNumber, { pr_status: 'error' });
    return;
  }

  const tracksDir = join(worktreePath, 'conductor', 'tracks');
  const trackDir = resolveTrackFolder(tracksDir, trackNumber);
  const titleMatch = trackDir && readIfExists(join(tracksDir, trackDir, 'index.md'))?.match(/^#\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `Track ${trackNumber}`;

  try {
    const { number, url } = createTrackPr({
      repoRoot: worktreePath, trackNumber, mainBranch, title,
      body: `Opened automatically by LaneConductor on quality-gate pass (merge_mode: pr).`,
    });
    console.log(`[pr-flow] Opened PR #${number} for track ${trackNumber}: ${url}`);
    // Written to the file too (not just the DB via patchTrackPrFields below)
    // so reconcilePrTracks — which only ever reads files, exactly like
    // local-fs mode's every other worker-side decision — can find the PR
    // number to poll without needing a DB round-trip.
    if (trackDir) {
      const indexPath = join(tracksDir, trackDir, 'index.md');
      writeIndexMarker(indexPath, 'PR Number', number);
      writeIndexMarker(indexPath, 'PR URL', url);
      writeIndexMarker(indexPath, 'PR Status', 'open');
    }
    // Track 10018 Phase 11 (found live by the subprocess E2E test, not code
    // review): the writes above land ONLY in the worktree's own copy of
    // index.md. reconcilePrTracks() — the function whose entire job is to
    // poll this PR — only ever reads the PRIMARY checkout's copy (same as
    // every other worker-side file read), and the exit handler's generic
    // artifact-copy already ran earlier in this same run, before these
    // markers existed to copy. Without this, primary's index.md never gets
    // a **PR Number**, reconcilePrTracks finds nothing to poll, and a
    // pr-mode track's PR silently never converges no matter what GitHub
    // reports — confirmed live: the E2E test hung forever waiting for
    // pr_status to reach 'merged'. writeIndexMarker() (unlike the shared
    // mergeIndexMarkers() used for Lane/Progress/etc.) already injects a
    // missing marker rather than skipping it, so this is correct on a
    // track's very first PR just as much as on a later status change.
    const primaryTracksDir = join(primaryRoot, 'conductor', 'tracks');
    const primaryTrackDir = resolveTrackFolder(primaryTracksDir, trackNumber);
    if (primaryTrackDir) {
      const primaryIndexPath = join(primaryTracksDir, primaryTrackDir, 'index.md');
      writeIndexMarker(primaryIndexPath, 'PR Number', number);
      writeIndexMarker(primaryIndexPath, 'PR URL', url);
      writeIndexMarker(primaryIndexPath, 'PR Status', 'open');
    }
    await patchTrackPrFields(trackNumber, { pr_number: number, pr_url: url, pr_status: 'open' });
    await postToCollectors(`/track/${trackNumber}/comment`, {
      author: 'system', body: `⚠️ Opened PR #${number} for review: ${url}`,
    }).catch(() => {});
  } catch (err) {
    const msg = `Failed to open a PR for track ${trackNumber}: ${err.message}. Branch and worktree left in place; track NOT merged.`;
    console.error(`[pr-flow] ${msg}`);
    await postToCollectors(`/track/${trackNumber}/comment`, { author: 'system', body: `⚠️ ${msg}` }).catch(() => {});
    await patchTrackPrFields(trackNumber, { pr_status: 'error' });
  }
}

async function patchTrackPrFields(trackNumber, fields) {
  if (getIsLocalFs()) return; // no collector to report to
  const { url, token } = primaryCollector();
  if (!url) return;
  await patch(url, token, `/track/${trackNumber}/action`, fields)
    .catch(err => console.error(`[pr-flow] CRITICAL: failed to persist PR fields for track ${trackNumber}: ${err.message}`));
}

async function mergeAndRemoveWorktree(trackNumber) {
  const mainBranch = getMainBranch();

  const result = await mergeWorktreeBranch({ repoRoot: process.cwd(), trackNumber, mainBranch });

  if (!result.merged) {
    if (result.reason === 'no-branch') {
      console.warn(`[worktree] Branch track-${trackNumber} not found, skipping merge`);
    } else if (result.reason === 'conflict') {
      console.error(`[worktree] Merge conflict for track ${trackNumber}: ${(result.conflictPaths || []).join(', ')}`);
      console.log(`[worktree] Leaving branch and worktree in place for manual conflict resolution`);
    }
    return;
  }

  console.log(`[worktree] Merged branch track-${trackNumber} into ${mainBranch} (${result.mergeCommit})`);
  console.log(result.worktreeRemoved
    ? `[worktree] Removed worktree for track ${trackNumber}`
    : `[worktree] Worktree directory absent for track ${trackNumber} — merge completed without it`);
  console.log(`[worktree] Completed merge and cleanup for track ${trackNumber}`);
}

// Track 1112 Phase 3 (RC-B fix / REQ-4): the exit-handler call above is a
// fast path that only fires when THIS worker's own action lands a track on
// done:success. This is the safety net — a state-driven pass (D-2) that
// merges any track-* branch whose track is at done:success and unmerged,
// regardless of which route (UI drag, `lc move`, a quality gate on another
// machine) put it there. Idempotent, quiet when there's nothing to do
// (REQ-4), and skips anything actively locked by a running worker (REQ-5).
async function reconcileWorktrees() {
  if (getGitConfig().reconcile_worktrees === false) return;

  const mainBranch = getMainBranch();
  let rows;
  try {
    rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch });
  } catch (err) {
    console.error(`[reconcile] Audit failed: ${err.message}`);
    return;
  }

  const lockDir = join(process.cwd(), '.conductor', 'locks');
  for (const row of rows) {
    if (row.classification !== 'mergeable' && row.classification !== 'stranded') continue;
    if (!row.trackNumber) continue;
    if (existsSync(join(lockDir, `${row.trackNumber}.lock`))) continue; // actively claimed — never merge out from under a running worker
    // Track 10018 (TC-2.5): this safety net must never locally merge a
    // pr-mode track's branch — that's exactly the "parked, awaiting human
    // approval" state the mode exists to create. reconcilePrTracks() below
    // is the pr-mode equivalent of this loop.
    if (readTrackMergeMode(process.cwd(), row.trackNumber) === 'pr') continue;

    const result = await mergeWorktreeBranch({ repoRoot: process.cwd(), trackNumber: row.trackNumber, mainBranch });
    if (result.merged) {
      console.log(`[reconcile] Merged track-${row.trackNumber} into ${mainBranch} (was ${row.classification}, ${result.mergeCommit})`);
    } else if (result.reason === 'conflict') {
      console.warn(`[reconcile] track-${row.trackNumber} conflicts with ${mainBranch}: ${(result.conflictPaths || []).join(', ')} — left unmerged, worktree intact`);
    }
  }
}

// Track 10018 Phase 3: the pr-mode counterpart to reconcileWorktrees — polls
// every open-PR track via `gh pr view` and drives its pr_status, converging
// to the same local cleanup reconcileWorktrees uses once GitHub reports the
// PR merged. Deliberately does NOT run a local git merge on MERGED — by
// then the merge commit already exists on the remote; bringing it into the
// local primary checkout is the existing git-divergence safe-pull
// mechanism's job (see checkAndPullDivergence below), not this function's.
// Tolerates `gh` transient failures by simply leaving state untouched
// (pollTrackPr/resolvePrStatus both return null on failure — see TC-3.5).
async function reconcilePrTracks() {
  const tracksDir = join(process.cwd(), 'conductor', 'tracks');
  if (!existsSync(tracksDir)) return;

  const mainBranch = getMainBranch();
  const repoRoot = resolvePrimaryRepoRoot(process.cwd());

  for (const dirName of readdirSync(tracksDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const trackNumberMatch = dirName.match(/^(\d+)-/);
    if (!trackNumberMatch) continue;
    const trackNumber = trackNumberMatch[1];
    const indexPath = join(tracksDir, dirName, 'index.md');
    if (!existsSync(indexPath)) continue;

    let content;
    try { content = readFileSync(indexPath, 'utf8'); } catch { continue; }
    if (resolveMergeMode({ merge_mode: parseMergeModeMarker(content) }) !== 'pr') continue;

    const prNumberMatch = content.match(/\*\*PR Number\*\*:\s*(\d+)/i);
    if (!prNumberMatch) {
      // openTrackPrOnDone is normally fired once, in-process, by spawnCli's
      // own exit handler right after a track reaches done:success — a
      // single fire-and-forget call with no retry: a worker restart at the
      // wrong instant (or anything else interrupting that continuation)
      // drops it silently, forever, with nothing to notice or retry.
      // Observed live: tracks sitting at done:success with merge_mode 'pr'
      // and no PR for DAYS (track 1111, since 2026-08-20) — not just
      // restart-interrupted ones from the same session. Make PR creation a
      // reconciled invariant instead of a one-shot action, mirroring how
      // reconcileWorktrees() already self-heals direct-mode merges the
      // same way (see its own Track 10018 TC-2.5 comment).
      const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
      const laneStatusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
      const isDoneSuccess = laneMatch?.[1]?.trim().toLowerCase() === 'done'
        && laneStatusMatch?.[1]?.trim().toLowerCase() === 'success';
      if (!isDoneSuccess) continue; // not finished yet — nothing to open a PR for
      const worktreePath = join(repoRoot, '.worktrees', trackNumber);
      if (!existsSync(worktreePath)) continue; // nothing left to push from
      if (existsSync(join(process.cwd(), '.conductor', 'locks', `${trackNumber}.lock`))) continue; // actively claimed — don't race a running session
      console.log(`[reconcile-pr] track ${trackNumber}: done:success with merge_mode=pr and no PR yet — opening one`);
      await openTrackPrOnDone(trackNumber, worktreePath);
      continue; // openTrackPrOnDone writes its own PR markers; picked up by polling next cycle
    }
    const currentStatusMatch = content.match(/\*\*PR Status\*\*:\s*(\S+)/i);
    if (currentStatusMatch && ['merged', 'closed'].includes(currentStatusMatch[1].toLowerCase())) continue; // terminal — nothing left to poll

    const prNumber = parseInt(prNumberMatch[1], 10);
    const poll = pollTrackPr({ repoRoot, prNumber });
    const newStatus = resolvePrStatus(poll);
    if (!newStatus) continue; // transient gh failure — leave state exactly as-is (TC-3.5)

    if (currentStatusMatch?.[1]?.toLowerCase() !== newStatus) {
      console.log(`[reconcile-pr] track ${trackNumber} PR #${prNumber}: ${currentStatusMatch?.[1] || '(none)'} → ${newStatus}`);
      writeIndexMarker(indexPath, 'PR Status', newStatus);
      await patchTrackPrFields(trackNumber, { pr_status: newStatus });
    }

    if (newStatus === 'merged') {
      await cleanupMergedPrTrack(trackNumber, mainBranch, repoRoot);
    }
  }
}

// Small, self-contained marker writer (mirrors updateHeader's pattern used
// elsewhere in this file) — kept local rather than exported since it's only
// ever called against a file this function just read moments ago.
function writeIndexMarker(indexPath, marker, value) {
  try {
    let content = readFileSync(indexPath, 'utf8');
    const regex = new RegExp(`\\*\\*${marker}\\*\\*:\\s*[^\\n]+`, 'i');
    content = regex.test(content)
      ? content.replace(regex, `**${marker}**: ${value}`)
      : content.trim() + `\n**${marker}**: ${value}\n`;
    writeFileSync(indexPath, content, 'utf8');
  } catch (err) {
    console.warn(`[reconcile-pr] Failed to write **${marker}** marker to ${indexPath}: ${err.message}`);
  }
}

// Track 10018 Phase 3: local cleanup once GitHub reports a track's PR
// merged. Only deletes the local track-N branch once its commits are
// provably already reachable from local mainBranch — never races ahead of
// the git-divergence safe-pull that's responsible for actually bringing the
// merge commit into the local primary checkout. Worktree removal is always
// safe regardless (it never touches the branch ref).
async function cleanupMergedPrTrack(trackNumber, mainBranch, repoRoot) {
  const branch = `track-${trackNumber}`;
  let isAncestor = false;
  try {
    gitExec(`git merge-base --is-ancestor ${branch} ${mainBranch}`, repoRoot);
    isAncestor = true;
  } catch { /* not an ancestor yet (or one of the refs isn't local yet) */ }

  await removeWorktree(trackNumber);

  if (isAncestor) {
    try {
      gitExec(`git branch -D ${branch}`, repoRoot);
      console.log(`[reconcile-pr] Deleted local branch ${branch} (merged into ${mainBranch} via GitHub PR)`);
    } catch (err) {
      console.warn(`[reconcile-pr] Failed to delete local branch ${branch}: ${err.message}`);
    }
  } else {
    console.log(`[reconcile-pr] track ${trackNumber}: PR merged on GitHub but ${branch} isn't an ancestor of local ${mainBranch} yet — worktree removed, branch left for a later pass once the merge commit is pulled locally`);
  }
}

// Track 10018 Phase 11: test-only override for BOTH reconcile loops below,
// same pattern as LC_HEARTBEAT_INTERVAL_MS above — a real subprocess test
// exercising reconcilePrTracks (push → gh pr create → poll → cleanup)
// would otherwise need to wait a full 60s per assertion, or poll flakily.
// Kept as a single shared constant so the two loops can't drift apart —
// Phase 3 Task 4's "same cadence" invariant applies to the override too,
// not just the production default.
const RECONCILE_INTERVAL_MS = Number(process.env.LC_RECONCILE_INTERVAL_MS) || 60000;

// Track 1112 Phase 3: runs on every worker regardless of mode (local-fs
// included — worktrees are a git-local concept, not a DB one) so the RC-B
// safety net applies no matter how a track reached done:success.
setInterval(() => {
  reconcileWorktrees().catch(err => console.error('[reconcile error]:', err.message));
}, RECONCILE_INTERVAL_MS);

// Track 10018 Phase 3: same cadence as reconcileWorktrees — the pr-mode
// tracks this polls are a strict subset of what that function already scans
// (both walk conductor/tracks), so there's no reason for a different period.
setInterval(() => {
  reconcilePrTracks().catch(err => console.error('[reconcile-pr error]:', err.message));
}, RECONCILE_INTERVAL_MS);

// Track 10019 (Phase 4/REQ-8, REQ-9, REQ-12): the board/DB/chat only ever
// saw a live-worktree track's docs (plan.md/spec.md/test.md/index.md) at
// the START of a run and again at the END, via copyWorktreeArtifactsToPrimary()
// — a real run takes 20-30+ minutes, so for nearly all of it, main's copy
// is stale. This closes that gap: same machinery, same safety guards,
// just also run periodically WHILE a track is live. Deliberately does NOT
// gate on getIsLocalFs() (unlike refreshWorktreeSummaryCache) — worktrees
// and their docs are a git-local concept, independent of DB mode, same
// reasoning as reconcileWorktrees() above. Deliberately does NOT skip
// actively-locked tracks (unlike reconcileWorktrees) — a running, locked
// track is exactly the case this exists to keep fresh; only the merge
// path needs to avoid touching a live run.
const staleDocSignal = new Map(); // `${trackNumber}:${file}` -> true, while a guard-skip is unresolved (REQ-11)
async function syncWorktreeDocsToPrimary() {
  let worktrees;
  try {
    worktrees = listTrackWorktrees({ repoRoot: process.cwd() });
  } catch (err) {
    console.error(`[doc-sync] Listing worktrees failed: ${err.message}`);
    return;
  }

  for (const { trackNumber, worktreePath } of worktrees) {
    // Track 1102 F21: skipStatusMarkers — a reused per-cycle worktree's
    // Lane/Lane Status is frozen at the PREVIOUS cycle's terminal value
    // until this cycle's own exit handler runs; letting it flow through
    // here clobbers the "running" marker the dispatcher just wrote onto
    // primary, and reconcileActiveDispatch()'s next tick then closes the
    // dispatch out while the real child process is still alive (confirmed
    // live on track 10019's review and quality-gate dispatches). Every
    // other marker this copies is safe to keep live-syncing.
    const { copied, skipped } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber, isSuccess: false,
      primaryRoot: process.cwd(), resolveTrackFolder, skipUnchanged: true, skipStatusMarkers: true,
    });

    if (copied.length) {
      console.log(`[doc-sync] track-${trackNumber}: synced ${copied.join(', ')} from worktree to primary`);
      if (copied.includes('index.md')) {
        const tracksDir = join(process.cwd(), 'conductor', 'tracks');
        const trackDir = resolveTrackFolder(tracksDir, trackNumber);
        if (trackDir) {
          await syncTrack(join(tracksDir, trackDir, 'index.md'))
            .catch(err => console.warn(`[doc-sync] Failed to sync index.md to DB for track ${trackNumber}: ${err.message}`));
        }
      }
    }

    // Track 10019 (Phase 5/REQ-11): surface guard-skipped copies instead
    // of silently serving a primary copy known to be behind. Only warns
    // on the transition INTO stale (not every tick the guard keeps
    // declining) — the periodic pass runs every 60s and would otherwise
    // spam conversation.md for as long as the underlying shrink persists.
    for (const skip of skipped) {
      const key = `${trackNumber}:${skip.file}`;
      console.warn(`[doc-sync] track-${trackNumber}: declined to sync ${skip.file} (${skip.reason}: incoming ${skip.incomingSize}b vs existing ${skip.existingSize}b)`);
      if (staleDocSignal.has(key)) continue;
      staleDocSignal.set(key, true);
      try {
        const tracksDir = join(process.cwd(), 'conductor', 'tracks');
        const trackDir = resolveTrackFolder(tracksDir, trackNumber);
        if (trackDir) {
          const convPath = join(tracksDir, trackDir, 'conversation.md');
          if (existsSync(convPath)) {
            appendFileSync(convPath,
              `\n> **system**: ⚠️ Docs may be stale — ${skip.file} did not sync from the live worktree (incoming ${skip.incomingSize}b looked suspiciously smaller than the existing ${skip.existingSize}b copy). Will retry automatically as the track continues.\n`,
              'utf8');
          }
        }
      } catch (err) {
        console.warn(`[doc-sync] Failed to post stale-docs notice for track ${trackNumber}: ${err.message}`);
      }
    }
    // Clear the signal for any file that just synced successfully again.
    for (const file of copied) staleDocSignal.delete(`${trackNumber}:${file}`);
  }
}
// LC_DOC_SYNC_INTERVAL_MS: test-only override (default stays 60s) — same
// reasoning as LC_DISPATCH_POLL_MS above: a test proving something survives
// (or is clobbered by) several doc-sync ticks shouldn't have to wait out
// real minutes to observe it.
setInterval(() => {
  syncWorktreeDocsToPrimary().catch(err => console.error('[doc-sync error]:', err.message));
}, Number(process.env.LC_DOC_SYNC_INTERVAL_MS) || 60000);

// Track 1112 Phase 5 (REQ-8...REQ-11): a third-party `git push` straight to
// `origin/<main>` — bypassing LaneConductor entirely — was previously
// invisible to every worker; the only fetch anywhere ran solely as a side
// effect of claiming a git lock, and nothing read its result. This detects
// that divergence on its own schedule and, only when D-4's conditions all
// hold, pulls it in — never a bare `git pull`.
let lastGitDivergenceCheck = 0;
async function checkOutOfBandGitSync() {
  const fetchIntervalMs = getGitConfig().fetch_interval_ms ?? 300000;
  if (fetchIntervalMs === 0) return; // explicitly disabled
  if (Date.now() - lastGitDivergenceCheck < fetchIntervalMs) return;
  lastGitDivergenceCheck = Date.now();

  const mainBranch = getMainBranch();
  const divergence = await checkDivergence({ repoRoot: process.cwd(), mainBranch });
  if (!divergence.fetchOk) {
    console.warn(`[git-sync] Fetch of origin/${mainBranch} failed — will retry next interval`);
    return;
  }
  if (divergence.behind === 0) return; // nothing to report — stay quiet, no per-tick log spam

  console.log(`[git-sync] Local ${mainBranch} is ${divergence.behind} commit(s) behind origin/${mainBranch}` +
    (divergence.ahead > 0 ? ` and ${divergence.ahead} ahead (diverged)` : '') +
    ` — fast-forward ${divergence.canFastForward ? 'available' : 'NOT available'}.`);

  if (!divergence.canFastForward) return; // diverged — never auto-pull, detection only

  const autoPull = getGitConfig().auto_pull !== false;
  if (!autoPull) {
    console.log(`[git-sync] git.auto_pull is disabled — reporting only, not pulling.`);
    return;
  }

  const result = await safePull({ repoRoot: process.cwd(), mainBranch, autoPull: true });
  if (result.pulled) {
    console.log(`[git-sync] Pulled ${divergence.behind} commit(s) into ${mainBranch}: ${result.beforeSha.slice(0, 7)} → ${result.afterSha.slice(0, 7)}`);
    for (const relPath of result.changedTrackFiles) {
      const fullPath = join(process.cwd(), relPath);
      if (existsSync(fullPath)) {
        await syncTrack(fullPath).catch(err => console.warn(`[git-sync] Failed to resync ${relPath} to DB: ${err.message}`));
      }
    }
  } else if (result.reason === 'dirty-overlap') {
    console.warn(`[git-sync] Not pulling — local uncommitted change(s) overlap incoming commits: ${(result.overlapPaths || []).join(', ')}`);
  } else if (result.reason !== 'up-to-date') {
    console.warn(`[git-sync] Not pulling — ${result.reason}`);
  }
}
setInterval(() => {
  checkOutOfBandGitSync().catch(err => console.error('[git-sync error]:', err.message));
}, 30000); // ticks every 30s; actual fetch cadence is governed by git.fetch_interval_ms above

async function spawnCli(command, args, label, trackNumber, cli, model, tier, laneStatus, laneConfig = {}, projectId = null, session = null, trigger = null) {
  let lockFile = null;
  let worktreePath = null;
  let globalMainModeLockAcquired = false;

  // Fallback to getting projectId if not provided
  if (!projectId) {
    const proj = getProject();
    projectId = proj?.id;
  }

  // Track 1115: resolve this action's workspace mode BEFORE touching lock/worktree —
  // 'main' skips createWorktree() entirely (still takes the lock, per D1/REQ-2).
  // Read from process.cwd(), which at this point is always the primary checkout
  // (no worktree has been created yet this call).
  const primaryTracksDir = join(process.cwd(), 'conductor', 'tracks');
  const primaryTrackDirName = resolveTrackFolder(primaryTracksDir, trackNumber);
  const primaryIndexPath = primaryTrackDirName ? join(primaryTracksDir, primaryTrackDirName, 'index.md') : null;
  const primaryIndexContent = primaryIndexPath ? (readIfExists(primaryIndexPath) || '') : '';
  const workspaceMode = resolveWorkspaceMode({
    laneStatus,
    workspaceMarker: parseWorkspaceMarker(primaryIndexContent),
    trackType: parseTrackKind(primaryIndexContent),
    trigger,
    projectWorkspaceMode: getProject()?.workspace_mode ?? null,
  });

  // D10/REQ-10: main mode must refuse to start on a dirty checkout — any
  // dirty path outside the track's OWN folder risks an agent's commit
  // sweeping in unrelated human WIP. The track's own folder is excluded
  // because the caller has already written **Lane Status**: running into
  // it just before calling spawnCli. What counts as safely-exempt
  // "worker bookkeeping" vs genuinely disqualifying WIP lives in
  // findDisqualifyingDirtyPaths (workspace-mode.mjs) — extracted there so
  // it's unit-testable directly; see its own doc comment for the full
  // history (worker runtime state, file_sync_queue.md, other tracks'
  // routinely-resynced status markers).
  if (workspaceMode === 'main') {
    const dirtyPaths = (() => {
      try {
        return execSync('git status --porcelain', { cwd: process.cwd(), encoding: 'utf8' })
          .split('\n').map(l => l.slice(3).trim()).filter(Boolean);
      } catch {
        return [];
      }
    })();
    const ownFolderPrefix = primaryTrackDirName ? `conductor/tracks/${primaryTrackDirName}/` : null;
    const disqualifying = findDisqualifyingDirtyPaths(dirtyPaths, ownFolderPrefix);
    if (disqualifying.length > 0) {
      console.warn(`[${label}] Track ${trackNumber}: main-mode spawn blocked — dirty paths outside the track's own folder: ${disqualifying.join(', ')}`);
      if (primaryIndexPath) {
        const revertedContent = primaryIndexContent.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
        writeFileSync(primaryIndexPath, revertedContent, 'utf8');
      }
      if (primaryTrackDirName) {
        const convPath = join(primaryTracksDir, primaryTrackDirName, 'conversation.md');
        const comment = `\n> **system**: ⚠️ Main-mode run blocked — the primary checkout has unrelated uncommitted changes outside this track's folder: ${disqualifying.join(', ')}. Not spawning; will retry next cycle once the checkout is clean.\n`;
        try {
          appendFileSync(convPath, comment, 'utf8');
        } catch { /* best-effort — the console.warn above is the durable record either way */ }
      }
      const err = new Error(`[workspace-mode] main-mode spawn blocked by dirty checkout for track ${trackNumber}`);
      err.workspaceGuardBlocked = true;
      throw err;
    }
  }

  // Dogfooding 2026-08-25: at most one main-mode session may run at a time
  // — see checkAndClaimGlobalMainModeLock's own doc comment for why
  // (main mode has no worktree, so two concurrent main-mode sessions share
  // one working directory with zero isolation; confirmed live, one
  // deleted another's uncommitted work mid-run). Checked/claimed here,
  // same guard style as the dirty-checkout block just above, so a
  // blocked-by-lock main-mode spawn reports and retries exactly the same
  // way a blocked-by-dirty-checkout one already does.
  if (workspaceMode === 'main' && !getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
    try {
      await checkAndClaimGlobalMainModeLock(trackNumber);
      globalMainModeLockAcquired = true;
    } catch (lockErr) {
      console.warn(`[${label}] Track ${trackNumber}: ${lockErr.message}`);
      if (primaryIndexPath) {
        const revertedContent = primaryIndexContent.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
        writeFileSync(primaryIndexPath, revertedContent, 'utf8');
      }
      if (primaryTrackDirName) {
        const convPath = join(primaryTracksDir, primaryTrackDirName, 'conversation.md');
        const comment = `\n> **system**: ⚠️ Main-mode run blocked — ${lockErr.message}. Not spawning; will retry next cycle once main-mode is free.\n`;
        try {
          appendFileSync(convPath, comment, 'utf8');
        } catch { /* best-effort — the console.warn above is the durable record either way */ }
      }
      const err = new Error(`[workspace-mode] main-mode spawn blocked by global lock for track ${trackNumber}: ${lockErr.message}`);
      err.workspaceGuardBlocked = true;
      throw err;
    }
  }

  if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
    try {
      lockFile = await checkAndClaimGitLock(trackNumber);
      if (workspaceMode === 'branch') {
        worktreePath = await createWorktree(trackNumber);
      }
    } catch (err) {
      console.error(`[${label}] Failed to setup lock/worktree for track ${trackNumber}: ${err.message}`);
      if (worktreePath) await removeWorktree(trackNumber).catch(() => { });
      if (lockFile) await releaseGitLock(trackNumber).catch(() => { });
      if (globalMainModeLockAcquired) await releaseGlobalMainModeLock().catch(() => { });
      throw err;
    }
  }

  // ── Context Injection Preparation ──────────────────────────────────────────
  let contextPrompt = '';
  try {
    // SKILL.md is too large to inject into every prompt.
    // The agent already gets contextMsg in buildCliArgs which points to it.
    // Project context
    const docs = {
      'product.md': 'conductor/product.md',
      'tech-stack.md': 'conductor/tech-stack.md',
      'workflow.md': 'conductor/workflow.md'
    };
    for (const [name, path] of Object.entries(docs)) {
      const content = capContentForArgv(readIfExists(path), 10_000);
      if (content) contextPrompt += `\n<project_context file="${name}">\n${content}\n</project_context>\n`;
    }

    // Track context
    const tracksDir = join(process.cwd(), 'conductor', 'tracks');
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    if (trackDirName) {
      const trackPath = join(tracksDir, trackDirName);
      // Confirmed live (dogfooding 2026-08-24): this whole contextPrompt is
      // embedded as a single argv element passed to spawn() — and on this
      // system a single argv element over ~131072 bytes fails with
      // `spawn E2BIG`, silently making a track undispatchable (not a
      // content-quality issue, an OS execve() limit). A track's own
      // conversation.md is the one file here with no natural size bound —
      // it grows for as long as the track is worked on, so it's the one
      // most likely to cross that ceiling on any sufficiently long-lived
      // track, independent of anything unusual about that track's content.
      // capContentForArgv keeps the TAIL for conversation.md specifically
      // (most recent activity is what actually matters for continuing
      // work) and a smaller flat cap for the rest, keeping the worst-case
      // total safely under the ~131KB ceiling with real margin for the
      // GOAL/freshness-marker suffix added after this.
      const trackDocs = {
        'index.md': [join(trackPath, 'index.md'), 12_000, false],
        'spec.md': [join(trackPath, 'spec.md'), 12_000, false],
        'plan.md': [join(trackPath, 'plan.md'), 12_000, false],
        'test.md': [join(trackPath, 'test.md'), 12_000, false],
        'conversation.md': [join(trackPath, 'conversation.md'), 30_000, true],
      };
      for (const [name, [path, maxBytes, keepTail]] of Object.entries(trackDocs)) {
        const content = capContentForArgv(readIfExists(path), maxBytes, keepTail);
        if (content) contextPrompt += `\n<track_context file="${name}">\n${content}\n</track_context>\n`;
      }
      contextPrompt += `\nYour workspace is at: ${worktreePath || process.cwd()}\n`;
      contextPrompt += `The track you are working on is in: conductor/tracks/${trackDirName}/\n`;
      // Track 1115 REQ-4: no track branch exists to attribute main-mode
      // commits to, so ask the agent to reference the track explicitly —
      // this is what closes the "commits with no track record" gap
      // motivating this track (see conductor/workflow.md's commit convention).
      if (workspaceMode === 'main') {
        contextPrompt += `\nYou are working DIRECTLY on the primary checkout (no worktree, no track branch — this track's workspace mode is 'main'). Every commit you make MUST reference this track, e.g. "feat(track-${trackNumber}): ..." or "fix(track-${trackNumber}): ...", per conductor/workflow.md's commit convention.\n`;
      }
    }
  } catch (ctxErr) {
    console.warn(`[context] Failed to gather rich context: ${ctxErr.message}`);
  }

  // Track 10020: the moment conversation.md's content was actually read
  // into contextPrompt above — this run's own knowledge of the human's
  // side of the conversation is frozen as of here, for however long the
  // run then takes (seconds to many minutes). Compared against
  // conversation.md's own mtime in the exit handler below, to detect a
  // human message that arrived DURING the run and was therefore never
  // seen by it — not a millisecond race, a deterministic architectural
  // gap: nothing re-reads this file once the run has started.
  const contextFrozenAt = Date.now();

  // Track 10020 (fixes a self-inflicted regression from the original
  // contextFrozenAt-vs-mtime check below): capture which HUMAN messages
  // were already unanswered at context-freeze time specifically, not just
  // conversation.md's raw mtime. A plain mtime comparison also fires on the
  // AGENT's own normal writes during its run (status comments, closing
  // responses — routine, expected, happens on nearly every dispatch) —
  // confirmed live: that false positive stuck track 10017's implement
  // stage in a queue loop twice in a row, since it legitimately posts its
  // own progress comments as part of real work. Comparing the unanswered-
  // human-tail specifically (same extractUnansweredHumanTail used for
  // resumed sessions below) only flags a genuine new human message, not
  // the agent talking to itself.
  let humanTailAtFreeze = null;
  try {
    const tracksDirForTail = join(worktreePath || process.cwd(), 'conductor', 'tracks');
    const trackDirForTail = resolveTrackFolder(tracksDirForTail, trackNumber);
    const convPathForTail = trackDirForTail ? join(tracksDirForTail, trackDirForTail, 'conversation.md') : null;
    humanTailAtFreeze = convPathForTail ? extractUnansweredHumanTail(readIfExists(convPathForTail)) : null;
  } catch { /* best-effort baseline — treat as "no prior unanswered tail" */ }

  // Inject context into the prompt (usually follows -p) — skipped on a
  // resumed session (track 1086): Claude already has this loaded from
  // earlier in the same session, re-injecting it every call is exactly the
  // redundant-context-reload cost this track exists to remove.
  if (contextPrompt && session?.isFresh !== false) {
    const pIndex = args.indexOf('-p');
    if (pIndex !== -1 && pIndex + 1 < args.length) {
      const originalPrompt = args[pIndex + 1];
      args[pIndex + 1] = `${contextPrompt}\n\nGOAL: ${originalPrompt}`;
    } else if (args.length > 0) {
      // Fallback to last arg if no -p found (custom CLIs)
      const originalPrompt = args[args.length - 1];
      args[args.length - 1] = `${contextPrompt}\n\nGOAL: ${originalPrompt}`;
    }
  } else if (session && session.isFresh === false) {
    // Track 10020: a resumed session skips the full reload above by
    // design, but that leaves it with no reliable way to learn a human
    // posted something new since its last turn — it only finds out if it
    // happens to re-check conversation.md on its own initiative, which is
    // exactly the inconsistency observed live on track 1102 (some resumed
    // turns caught a new note, most didn't, including one that explicitly
    // said "nothing new" while the human's message sat unread). Inject
    // just the trailing unanswered human message(s), not the whole file —
    // a small, targeted addition, not the redundant-reload cost this
    // track exists to avoid.
    try {
      const tracksDirForTail = join(worktreePath || process.cwd(), 'conductor', 'tracks');
      const trackDirForTail = resolveTrackFolder(tracksDirForTail, trackNumber);
      const convPathForTail = trackDirForTail ? join(tracksDirForTail, trackDirForTail, 'conversation.md') : null;
      const unansweredTail = convPathForTail ? extractUnansweredHumanTail(readIfExists(convPathForTail)) : null;
      if (unansweredTail) {
        const pIndex = args.indexOf('-p');
        const injectAt = pIndex !== -1 && pIndex + 1 < args.length ? pIndex + 1 : args.length - 1;
        if (injectAt >= 0) {
          const originalPrompt = args[injectAt];
          args[injectAt] = `UNANSWERED MESSAGE(S) FROM THE HUMAN SINCE YOUR LAST TURN — address this before anything else:\n\n${unansweredTail}\n\nGOAL: ${originalPrompt}`;
        }
      }
    } catch (err) {
      console.warn(`[context] Failed to check for unanswered human messages: ${err.message}`);
    }
  }

  // ── Scaffold track folder in main repo if missing ────────────────────────
  // This ensures lc show, status, and sync-to-file work independent of worktrees.
  try {
    const tracksDir = join(process.cwd(), 'conductor', 'tracks');
    if (existsSync(tracksDir)) {
      const existing = resolveTrackFolder(tracksDir, trackNumber);
      if (!existing) {
        // Try to get title from API
        let title = trackNumber;
        try {
          const { url, token } = primaryCollector();
          const resp = await get(url, token, `/track/${trackNumber}`).catch(() => null);
          if (resp?.title) title = resp.title;
        } catch (_) { }
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const folderName = `${trackNumber}-${slug}`;
        const folderPath = join(tracksDir, folderName);
        mkdirSync(folderPath, { recursive: true });
        const indexContent = `# Track ${trackNumber}: ${title}\n\n**Lane**: ${laneStatus}\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n**Summary**: Scaffolded for ${laneStatus}\n`;
        writeFileSync(join(folderPath, 'index.md'), indexContent, 'utf8');
        console.log(`[scaffold] Created folder: ${folderName}`);
      }
    }
  } catch (scaffoldErr) {
    console.warn(`[scaffold] Failed for track ${trackNumber}: ${scaffoldErr.message}`);
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const logPath = join(process.cwd(), 'conductor', 'logs', `${label}-${trackNumber}-${Date.now()}.log`);
  const out = openSync(logPath, 'a');
  const proc = spawn(command, args, { detached: true, stdio: ['ignore', out, out], cwd: worktreePath || process.cwd(), env });

  updateWorkerHeartbeat('busy', `${label.replace('auto-', '')} track ${trackNumber}`);
  const { url, token } = primaryCollector();

  const timeoutMs = Number(process.env.LC_SPAWN_TIMEOUT_MS) || config.worker?.spawn_timeout_ms || 300000;
  // Track 1086/1102: flag read by the exit handler so conversation.md can
  // say WHY a run died — "FAIL (exit 143)" alone hides that it was our own
  // timeout killer, which reads like a real failure (bitten live on the
  // 1104 walkthrough: 90 turns of work, SIGTERM at 15min, terse FAIL line).
  let killedByTimeout = false;
  // Track 1102 F11: a single setTimeout(timeoutMs) killed a genuinely
  // progressing run just because Phase 1 took longer than the configured
  // window — the log was growing the entire time (90 productive turns),
  // so it wasn't the hang this mechanism exists to catch. Poll for
  // genuine staleness instead of a fixed deadline: track when the log
  // file last grew, and only kill once it's been quiet for the FULL
  // timeout window, not merely "timeoutMs since spawn." A run that's
  // actively producing output gets to keep running as long as it keeps
  // producing it. Checked at timeoutMs/10 (clamped 5-30s) rather than a
  // fixed cadence, so a short test timeout still gets several checks in.
  let lastLogSize = 0;
  let lastProgressAt = Date.now();
  const livenessCheckMs = Math.min(30000, Math.max(1000, Math.floor(timeoutMs / 10)));
  const killer = setInterval(async () => {
    if (!runningPids.has(proc.pid)) { clearInterval(killer); return; }
    let currentSize = 0;
    try { currentSize = statSync(logPath).size; } catch { /* log not written yet — no progress to report */ }
    if (currentSize > lastLogSize) {
      lastLogSize = currentSize;
      lastProgressAt = Date.now();
      return; // still producing output — not stalled
    }
    if (Date.now() - lastProgressAt < timeoutMs) return; // quiet, but not for the full window yet

    clearInterval(killer);
    killedByTimeout = true;
    console.log(`[timeout] killing PID ${proc.pid} — no log growth for ${timeoutMs}ms (genuinely stalled)`);
    process.kill(-proc.pid, 'SIGTERM');
    await patch(url, token, `/track/${trackNumber}/action`, {
      project_id: projectId,
      lane_action_status: 'failure', lane_action_result: 'timeout',
      auto_planning_launched: null, auto_implement_launched: null, auto_review_launched: null,
      last_log_tail: tailLog(logPath), active_cli: cli,
    }).catch(() => { });
  }, livenessCheckMs);

  // Track 1087 Phase 2: for claude spawns (stream-json output, Phase 1),
  // the old 5s raw-text last_log_tail PATCH is replaced by incremental
  // JSONL event pushes (REQ-2) — non-claude CLIs keep the original
  // mechanism unchanged (REQ-1/Task 4), since they don't produce
  // stream-json and have no structured events to push.
  const tailInterval = cli === 'claude' ? null : setInterval(async () => {
    if (runningPids.has(proc.pid)) {
      await patch(url, token, `/track/${trackNumber}/action`, {
        project_id: projectId,
        last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    } else {
      clearInterval(tailInterval);
    }
  }, 5000);

  let jsonTailOffset = 0;
  const streamTailInterval = cli === 'claude' ? setInterval(async () => {
    if (!runningPids.has(proc.pid)) { clearInterval(streamTailInterval); return; }
    if (!existsSync(logPath)) return;
    const content = readFileSync(logPath, 'utf8');
    const { events, newOffset } = parseNewJsonlLines(content, jsonTailOffset);
    jsonTailOffset = newOffset;
    for (const event of events) {
      await notifyApi('session:event', { trackNumber, projectId, event });
    }
  }, 500) : null;

  proc.unref();
  runningPids.add(proc.pid);
  runningLaneMap.set(proc.pid, laneStatus);
  runningTrackMap.set(proc.pid, trackNumber);
  // Track 1086: persist the session id only now that we know the process
  // actually spawned — resolving it earlier (buildCliArgs) and persisting
  // there would orphan a session row on any bail-out (no provider
  // available, CLI blocked) that never reaches spawn.
  if (session) persistTrackSession(trackNumber, session.claude_session_id);
  proc.on('exit', async (code) => {
    console.log(`[${label}] EXIT EVENT TRIGGERED: PID ${proc.pid}, Code: ${code}`);
    clearInterval(killer);
    clearInterval(tailInterval);
    clearInterval(streamTailInterval);
    runningPids.delete(proc.pid);
    runningLaneMap.delete(proc.pid);
    runningTrackMap.delete(proc.pid);
    updateWorkerHeartbeat('idle', null);

    // Track 1110 Phase 4: release this track's local-fs claim marker, if
    // one was created (auto-launch's local-fs branch, above). Harmless
    // no-op for every other spawnCli caller (dispatch, chat, API mode) —
    // releaseTrackClaim is best-effort and silently does nothing when the
    // marker never existed. Runs unconditionally so a failed/killed run
    // still frees the track rather than leaning solely on the startup
    // sweep's staleness window.
    {
      const tracksDirForClaim = 'conductor/tracks';
      const trackDirForClaim = resolveTrackFolder(tracksDirForClaim, trackNumber);
      if (trackDirForClaim) releaseTrackClaim(tracksDirForClaim, trackDirForClaim);
    }

    const isSuccess = code === 0;
    const logContent = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

    // Track 1102 F21 (original variant, distinct from the escalated
    // mid-run-doc-sync-clobber one already fixed): an agent that
    // backgrounds a long command and lets its own final turn end exits 0
    // — a clean CLI-session termination — even though the actual coding
    // work never reached its own completion marker. `isSuccess` alone
    // can't tell this apart from a genuine pass; the agent's own last
    // word (the WORKTREE's index.md, read here BEFORE anything below
    // patches it) can — but ONLY for a real CLI that follows the SKILL's
    // self-transition protocol ("Transition: ... set **Lane** ... to
    // exactly what is defined in lanes.X.on_success", written by the
    // agent itself as its own last action). `cli === 'mock'` is this
    // codebase's universal test sentinel (see buildCliArgs / the
    // 'LaneConductor Collectors' log line comment) — mock-cli.mjs never
    // simulates that self-transition by design, relying entirely on this
    // exit handler's own Phase 5 write instead, same as every other test
    // in this suite. Without this gate, EVERY dispatch-driven mock-cli
    // test would misread as "ended mid-work" (caught via a real
    // regression: track-1102-f11-progress-keepalive.test.mjs went from
    // 2/2 to 1/2 before this gate was added).
    let endedMidWork = false;
    if (isSuccess && cli !== 'mock') {
      try {
        const midWorkCheckDir = worktreePath || process.cwd();
        const midWorkTrackDir = resolveTrackFolder(join(midWorkCheckDir, 'conductor', 'tracks'), trackNumber);
        if (midWorkTrackDir) {
          const rawIndexContent = readFileSync(join(midWorkCheckDir, 'conductor', 'tracks', midWorkTrackDir, 'index.md'), 'utf8');
          endedMidWork = /\*\*Lane Status\*\*:\s*running/i.test(rawIndexContent);
        }
      } catch (e) { /* best-effort detection only — never block the exit handler on it */ }
    }

    // Detect provider quota exhaustion — re-queue without consuming a retry
    let isExhausted = false;
    if (!isSuccess && logContent) {
      isExhausted = isProviderExhausted(logContent, cli);
      if (isExhausted) {
        console.log(`[${label}] Provider ${cli} quota exhausted — re-queuing track ${trackNumber} without consuming retry`);
        await checkExhaustion(logPath, cli);
      }

      // Track 1086 Phase 4: a --resume attempt failing because the session
      // was pruned/corrupted is not an ordinary task failure — invalidate
      // the stored session so the next attempt (retry or manual dispatch)
      // cold-starts instead of retrying the exact same broken --resume
      // forever. Detected against the real claude CLI's actual error text,
      // not guessed — see session-resilience-utils.mjs.
      if (session && !session.isFresh && isResumeFailure(logContent)) {
        console.log(`[${label}] Detected resume failure for track ${trackNumber} (session ${session.claude_session_id}) — invalidating stored session`);
        await invalidateTrackSession(trackNumber);
      }
    }

    // Track 10020: a dispatched lane action can end its turn on a genuine
    // blocking question (post_turn_summary status_category === 'blocked')
    // instead of finishing the work — e.g. "should I apply this DB
    // migration?". Left undetected, that question is stranded in the raw
    // transcript: never posted to conversation.md/track_comments (the only
    // path a human reply flows through), so the Inbox's comment-driven
    // bucket logic confidently reports nothing's wrong. Detected here,
    // regardless of exit code, since a clean stop on a question is a
    // normal end_turn (isSuccess === true).
    const blockedQuestion = extractBlockedQuestion(logContent);
    const isBlockedTurn = !!blockedQuestion;
    if (isBlockedTurn) {
      console.log(`[${label}] Track ${trackNumber}: ended its turn on a blocking question — flagging for human input instead of transitioning lanes`);
    }

    // Track 10020: a human can post a conversation.md message any time
    // after this run's context was frozen (contextFrozenAt / humanTailAtFreeze,
    // captured right when conversation.md was read into the prompt) — not a
    // millisecond race, a deterministic gap: nothing re-reads this file for
    // the rest of the run, however long it takes. If a genuinely NEW
    // unanswered human message exists now that wasn't there at freeze time,
    // this run never saw it, regardless of what it concluded ("nothing new
    // has arrived" can be true from the run's own frozen view and still be
    // wrong by the time it finishes). Don't let this run's outcome stand as
    // final — force it back to 'queue' at the same lane so the very next
    // dispatch starts with fresh context that DOES include the message.
    //
    // Deliberately NOT a raw mtime check (that was this fix's own first
    // draft, and a real regression): the agent's OWN normal writes to
    // conversation.md during its run — status comments, closing responses,
    // routine on nearly every dispatch — bump the mtime just as much as a
    // genuine human message would, incorrectly blocking any session that
    // posts even one comment from ever advancing a lane. Confirmed live:
    // stuck track 10017's implement stage in a queue loop twice in a row.
    // Comparing the unanswered-human-tail specifically (same
    // extractUnansweredHumanTail used for resumed sessions below) only
    // flags a genuine new human message, not the agent talking to itself.
    let isStaleAgainstNewMessage = false;
    try {
      const convPath = join(worktreePath || process.cwd(), 'conductor', 'tracks',
        resolveTrackFolder(join(worktreePath || process.cwd(), 'conductor', 'tracks'), trackNumber) || '', 'conversation.md');
      const humanTailNow = existsSync(convPath) ? extractUnansweredHumanTail(readIfExists(convPath)) : null;
      if (humanTailNow && humanTailNow !== humanTailAtFreeze) {
        isStaleAgainstNewMessage = true;
        console.log(`[${label}] Track ${trackNumber}: a new unanswered human message arrived after this run's context was frozen — re-queuing instead of finalizing so the next run sees it`);
      }
    } catch (err) {
      console.warn(`[${label}] Failed to check conversation.md freshness for track ${trackNumber}: ${err.message}`);
    }

    // 1. Check retry count using latest config (in case workflow.json reloaded)
    const currentLaneConfig = workflowConfig?.lanes?.[laneStatus] || laneConfig;
    let failCountBefore = 0;
    const maxRetries = currentLaneConfig.max_retries ?? workflowConfig?.defaults?.max_retries ?? 1;

    if (getIsLocalFs()) {
      const tracksDir = join(process.cwd(), 'conductor', 'tracks');
      const trackDir = resolveTrackFolder(tracksDir, trackNumber);
      if (trackDir) {
        const retryPath = join(tracksDir, trackDir, '.retry-count');
        const retryLanePath = join(tracksDir, trackDir, '.retry-lane');

        // Reset if lane changed
        const lastRetryLane = readIfExists(retryLanePath);
        if (lastRetryLane && lastRetryLane !== laneStatus) {
          if (existsSync(retryPath)) rmSync(retryPath);
          if (existsSync(retryLanePath)) rmSync(retryLanePath);
          failCountBefore = 0;
        } else {
          failCountBefore = parseInt(readIfExists(retryPath) || '0');
        }

        if (!isSuccess && !isExhausted) {
          writeFileSync(retryPath, String(failCountBefore + 1), 'utf8');
          writeFileSync(retryLanePath, laneStatus, 'utf8');
        } else if (isSuccess) {
          if (existsSync(retryPath)) rmSync(retryPath);
          if (existsSync(retryLanePath)) rmSync(retryLanePath);
        }
      }
    } else {
      const res = await get(url, token, `/track/${trackNumber}/retry-count`).catch(() => ({ count: 0 }));
      failCountBefore = res.count ?? 0;
    }

    // A failure triggers 'max_retries_reached' only if the count BEFORE this failure 
    // was already at or above maxRetries. (e.g. maxRetries=1 means 1 retry allowed).
    const isMaxRetries = !isSuccess && !isExhausted && failCountBefore >= maxRetries;

    // 2. Resolve target lane and status
    // Conversation/brainstorm runs (local-fs-answer) must not trigger workflow lane transitions
    // — nor must a blocked turn: advancing the lane on a question that was
    // never actually answered would misrepresent the track as further along
    // than it really is (Track 10020).
    const isConversationRun = label === 'local-fs-answer';
    const transitionValue = (isConversationRun || isBlockedTurn || isStaleAgainstNewMessage)
      ? null
      : (isSuccess
        ? (currentLaneConfig?.on_success || workflowConfig?.defaults?.on_success)
        : (isMaxRetries ? (currentLaneConfig?.on_failure || workflowConfig?.defaults?.on_failure) : null));

    let { lane: targetLane, status: nextActionStatus } = resolveTransition(transitionValue, laneStatus, isSuccess, isMaxRetries);
    // Force straight back to 'queue' (not resolveTransition's default
    // 'success' for a same-lane stay) — this run's outcome is genuinely
    // stale, not a normal success sitting still.
    if (isStaleAgainstNewMessage) nextActionStatus = 'queue';

    // F21: never advance the lane or report success on an ended-mid-work
    // exit — stay put, re-queue, so the next claim resumes (worktree +
    // session both persist) instead of moving forward as if the work were
    // actually verified complete.
    if (endedMidWork) {
      targetLane = laneStatus;
      nextActionStatus = 'queue';
    }

    console.log(`[${label}] Track ${trackNumber}: ${endedMidWork ? 'ENDED MID-WORK' : (isSuccess ? 'PASS' : 'FAIL')} (exit: ${code}). Next Action Status: ${nextActionStatus}${targetLane !== laneStatus ? `, Moving to: ${targetLane}` : ''}`);

    const patchData = {
      project_id: projectId,
      lane_action_status: nextActionStatus,
      lane_action_result: endedMidWork ? 'ended_mid_work' : (isSuccess ? 'success' : (isExhausted ? 'provider_exhausted' : (isMaxRetries ? 'max_retries_reached' : `error (code ${code})`))),
      last_log_tail: tailLog(logPath), active_cli: cli,
    };

    // Phase 5: Update Lane Status in files and commit (always execute)
    //
    // Track 1102 F9: this block used to READ from `process.cwd()` (the
    // PRIMARY checkout) but WRITE the result to `worktreePath ||
    // process.cwd()` below — an asymmetric read/write location. By this
    // point in a worktree run, the agent's own edits exist ONLY in the
    // worktree; the primary checkout is stale. Reading primary's stale
    // content, regex-patching just a few markers into it, and writing
    // that hybrid BACK INTO THE WORKTREE clobbered the agent's actual
    // finished work before the later worktree→primary copy-back step
    // ever ran — so copy-back faithfully propagated the clobbered
    // (stale body + patched markers) version into primary, discarding
    // real work with no error anywhere. Confirmed live via
    // conductor/tests/track-1102-f9-index-producer.test.mjs before this
    // fix (a distinguishing marker written into the worktree's index.md
    // was completely gone from primary's copy after the run). Reading
    // from the same location this block writes to fixes it.
    try {
      const tracksDir = join(worktreePath || process.cwd(), 'conductor', 'tracks');
      const trackDir = resolveTrackFolder(tracksDir, trackNumber);
      if (trackDir) {
        const indexPath = join(tracksDir, trackDir, 'index.md');
        if (existsSync(indexPath)) {
          let content = readFileSync(indexPath, 'utf8');
          let updated = false;

          // 1. Always write the correct Lane from workflow.json (ignore whatever agent wrote)
          const effectiveLane = targetLane || laneStatus || Lanes.PLAN;
          if (content.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${effectiveLane}`);
          } else if (content.match(/(# [^\n]+\n)/i)) {
            content = content.replace(/(# [^\n]+\n)/i, `$1\n**Lane**: ${effectiveLane}\n`);
          } else {
            content = `**Lane**: ${effectiveLane}\n` + content;
          }
          updated = true;
          // 2. Update Lane Status
          if (content.match(/\*\*Lane Status\*\*:\s*\w+/i)) {
            content = content.replace(/\*\*Lane Status\*\*:\s*\w+/i, `**Lane Status**: ${nextActionStatus}`);
          } else if (content.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
            content = content.replace(/(\*\*Lane\*\*:\s*[^\n]+)/i, `$1\n**Lane Status**: ${nextActionStatus}`);
          } else if (content.match(/(# [^\n]+\n)/i)) {
            content = content.replace(/(# [^\n]+\n)/i, `$1\n**Lane Status**: ${nextActionStatus}\n`);
          } else {
            content = `**Lane Status**: ${nextActionStatus}\n` + content;
          }
          updated = true;

          // ── Integration Hooks ──
          if (isSuccess) {
            executeIntegrationHooks(trackNumber, laneStatus, 'success');
          } else if (isMaxRetries) {
            executeIntegrationHooks(trackNumber, laneStatus, 'failure');
          }

          if (targetLane && targetLane !== laneStatus) {
            patchData.lane_status = targetLane;
          }
          updated = true;

          // 3. Update Progress if success (skip for conversation runs, blocked
          // turns, and stale-against-newer-message runs — don't force 100% on
          // unfinished work; also skip for F21's ended-mid-work case — nothing
          // was actually verified complete, forcing 100% would be a false signal)
          if (isSuccess && !isConversationRun && !isBlockedTurn && !isStaleAgainstNewMessage && !endedMidWork) {
            const progressContent = content.replace(/\*\*Progress\*\*:\s*\d+%/i, `**Progress**: 100%`);
            if (progressContent !== content) {
              content = progressContent;
              updated = true;
            }
          }

          // 3b. Conversation runs: clear waitingForReply so worker doesn't immediately re-fire
          if (isConversationRun) {
            if (content.match(/\*\*Waiting for reply\*\*:\s*[^\n]+/i)) {
              content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, `**Waiting for reply**: no`);
            }
            patchData.waiting_for_reply = false;
            updated = true;
          }

          // 3c. Track 10020: a blocked turn is the opposite of 3b — SET
          // waitingForReply so the Inbox (comment-driven bucket logic) and
          // the existing conversation-reply resume path (autoLaunchLocalFs's
          // waitingForReply handling) both pick this up correctly, exactly
          // as they already do for a real human-asked question.
          if (isBlockedTurn) {
            if (content.match(/\*\*Waiting for reply\*\*:\s*[^\n]+/i)) {
              content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, `**Waiting for reply**: yes`);
            } else {
              content = content.trim() + `\n**Waiting for reply**: yes\n`;
            }
            patchData.waiting_for_reply = true;
            updated = true;
          }
          // 4. Update Last Run
          // e.g. claude/haiku (primary) or gemini (secondary)
          const runBy = `${cli}${model !== 'default' ? '/' + model : ''} (${tier})`;
          if (content.match(/\*\*Last Run\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Last Run\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
          } else if (content.match(/\*\*Last Run By\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Last Run By\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
          } else {
            content = content.replace(/(\*\*Progress\*\*:\s*[^\n]+)/i, `$1\n**Last Run**: ${runBy}`);
          }
          updated = true;

          // Track 1102 F9b: workDir used to be declared inside the sibling
          // `if (updated)` block below, so the `git add` for last_run.log
          // (which runs before that block) referenced it out of scope —
          // ReferenceError, swallowed by that call's own empty catch, so
          // last_run.log was written to disk but never staged. Both blocks
          // now share this one declaration.
          const workDir = worktreePath || process.cwd();

          // 4. Write last run log to the track folder for worker context
          const lastRunLog = tailLog(logPath, 100);
          if (lastRunLog) {
            const lastRunLogPath = join(tracksDir, trackDir, 'last_run.log');
            writeFileSync(lastRunLogPath, lastRunLog, 'utf8');
            const relLogPath = join('conductor', 'tracks', trackDir, 'last_run.log');
            try {
              execSync(`git add "${relLogPath}"`, { cwd: workDir, stdio: 'pipe' });
            } catch (e) {
              console.warn(`[${label}] Failed to stage last_run.log: ${e.message}`);
            }
          }

          // 5. Write changes and commit to git
          if (updated) {
            const relIndexPath = join('conductor', 'tracks', trackDir, 'index.md');
            const targetIndexPath = join(workDir, relIndexPath);

            writeFileSync(targetIndexPath, content, 'utf8');
            console.log(`[${label}] Updated file for track ${trackNumber}: Lane Status → ${nextActionStatus}${targetLane ? `, Lane → ${targetLane}` : ''}`);

            // Commit changes to git (in worktree context)
            try {
              execSync(`git add "${relIndexPath}"`, { cwd: workDir, stdio: 'pipe' });
              execSync(`git commit -m "Track ${trackNumber}: ${isSuccess ? 'success' : 'failed'} (exit: ${code})"`, { cwd: workDir, stdio: 'pipe' });
              console.log(`[${label}] Committed file changes for track ${trackNumber}`);
            } catch (e) {
              console.warn(`[${label}] Failed to commit file changes: ${e.message}`);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[${label}] Error updating filesystem for track ${trackNumber}: ${err.message}`);
    }

    // Track 1102 F21: surface an ended-mid-work exit as its own distinct,
    // human-visible outcome — not gated on `session` (unlike the audit-trail
    // block below) so this shows up regardless of CLI/provider, and leads
    // with ⚠️ per the Completion Comment Convention so the Inbox buckets it
    // as "needs your input" rather than "recent activity".
    if (endedMidWork) {
      try {
        const tracksDirForMidWork = join(process.cwd(), 'conductor', 'tracks');
        const trackDirForMidWork = resolveTrackFolder(tracksDirForMidWork, trackNumber);
        if (trackDirForMidWork) {
          const convPathForMidWork = join(tracksDirForMidWork, trackDirForMidWork, 'conversation.md');
          appendFileSync(
            convPathForMidWork,
            `\n> **system**: ⚠️ Run ended mid-work — the process exited cleanly (code 0) but ` +
            `the agent's own completion marker was never written (likely a backgrounded ` +
            `command still running when its final turn ended). Nothing was lost: the ` +
            `worktree and session both persist. Re-run this lane action to resume where ` +
            `it left off.\n`,
            'utf8'
          );
        }
      } catch (e) {
        console.warn(`[${label}] Failed to post ended-mid-work comment for track ${trackNumber}: ${e.message}`);
      }
    }

    // Track 1086 Phase 4 Task 2: append a lightweight, auto-derived
    // audit-trail entry to conversation.md for every session-tracked turn —
    // regardless of whether the command itself explicitly posts a comment
    // (e.g. a plain successful `implement` phase doesn't). Gated on
    // `session` (claude-only, session-tracked calls) — local-fs and
    // non-claude CLI paths are untouched, matching this track's scope
    // throughout. Appended via the normal file-write path, so it flows
    // through the existing conversation.md FS→DB sync (syncConversation)
    // like any other entry — no separate plumbing to the DB needed.
    if (session) {
      try {
        const tracksDirForConv = join(process.cwd(), 'conductor', 'tracks');
        const trackDirForConv = resolveTrackFolder(tracksDirForConv, trackNumber);
        if (trackDirForConv) {
          const convPath = join(tracksDirForConv, trackDirForConv, 'conversation.md');
          const sessionState = session.isFresh ? 'started' : 'resumed';
          const outcome = isSuccess ? 'PASS' : 'FAIL';
          // Track 1086 conversation-gap fix (2026-08-12): the terse
          // PASS/FAIL line alone made the Conversation tab useless as a
          // record of what actually happened — the transcript had rich
          // content, conversation.md got one line. Now: name the kill
          // reason when it was our own timeout (an exit-143 FAIL that's
          // really "we cut it off at 15min" must not read like a real
          // failure), and append the run's closing assistant message as a
          // proper claude-authored entry, every line `>`-prefixed so the
          // sync parser treats it as one comment (see the conversation.md
          // format protocol — unprefixed lines silently don't sync).
          const reason = killedByTimeout ? ` — killed by spawn timeout after ${Math.round(timeoutMs / 1000)}s, not an agent failure` : '';
          let entry = `\n> **system**: Session turn — ${label} (${sessionState} session): ${outcome} (exit ${code}${reason}).\n`;
          try {
            const finalText = extractFinalAssistantText(readFileSync(logPath, 'utf8'));
            if (finalText) {
              const quoted = finalText.split('\n').map(l => `> ${l}`).join('\n');
              entry += `\n> **claude**: ${label} — closing response:\n${quoted}\n`;
            }
          } catch { /* log unreadable — keep the terse line alone */ }
          appendFileSync(convPath, entry, 'utf8');
        }
      } catch (err) {
        console.warn(`[${label}] Failed to append session-turn entry to conversation.md: ${err.message}`);
      }
    }

    // Track 10020: post the blocked question itself as a real claude-authored
    // conversation.md entry — independent of the `session` gate above, since
    // a track without a persisted session can still hit a blocking question.
    // This is what actually closes the gap: once this is a real comment,
    // the Inbox's existing bucket logic (driven entirely by track_comments)
    // correctly classifies the track as needing your input, the same way it
    // already does for any other unresolved claude/gemini comment.
    if (isBlockedTurn) {
      try {
        const tracksDirForBlock = join(process.cwd(), 'conductor', 'tracks');
        const trackDirForBlock = resolveTrackFolder(tracksDirForBlock, trackNumber);
        if (trackDirForBlock) {
          const convPath = join(tracksDirForBlock, trackDirForBlock, 'conversation.md');
          const quoted = blockedQuestion.split('\n').map(l => `> ${l}`).join('\n');
          appendFileSync(convPath, `\n> **claude**: ⏸️ Needs your input before continuing:\n${quoted}\n`, 'utf8');
        }
      } catch (err) {
        console.warn(`[${label}] Failed to append blocked-question entry to conversation.md: ${err.message}`);
      }
    }

    // Track 1112 dogfood incident (2026-08-13): this PATCH is the ONLY
    // thing that tells the DB (and therefore the UI) a run finished — the
    // file/git-level update above can succeed while this silently fails
    // (network blip, server error, timeout), leaving the track frozen at
    // lane_action_status='running' forever with no signal anywhere that
    // anything went wrong. Previously `.catch(() => {})` swallowed that
    // completely, unlike every other patch() call site in this file, which
    // at minimum logs a warning. Logged loudly (error, not warn) because
    // this one specifically has no other path to recovery — the caller
    // still needs an unblocked way to notice a stuck track.
    if (!getIsLocalFs()) await patch(url, token, `/track/${trackNumber}/action`, patchData)
      .catch(err => console.error(`[${label}] CRITICAL: failed to report completion for track ${trackNumber} — DB will show stale state until reconciled: ${err.message}`));

    // Cleanup git lock and worktree (API modes only — local-fs skips; LC_SKIP_GIT_LOCK skips in tests)
    if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
      try {
        // ── Copy artifacts from worktree → main repo before cleanup ──────────
        // Track 1112/1110 Phase 6: shared with the startup reconciliation
        // pass — see copyWorktreeArtifactsToPrimary() in worktree-artifact-merge.mjs.
        if (worktreePath && existsSync(worktreePath)) {
          const { copied, destDir } = copyWorktreeArtifactsToPrimary({
            worktreePath, trackNumber, isSuccess, primaryRoot: process.cwd(), resolveTrackFolder,
          });
          if (copied.length) {
            console.log(`[worktree] Copied artifacts to main repo: ${copied.join(', ')}`);
            const indexPath = join(destDir, 'index.md');
            if (existsSync(indexPath)) {
              await syncTrack(indexPath).catch(e => console.warn(`[worktree] Failed to sync artifacts to DB: ${e.message}`));
            }
          }
        }
        if (lockFile) await releaseGitLock(trackNumber);
        if (globalMainModeLockAcquired) await releaseGlobalMainModeLock();

        // Worktree lifecycle management
        if (worktreePath) {
          const lifecycle = getWorktreeLifecycle();
          if (lifecycle === 'per-cycle' && targetLane === 'done' && isSuccess) {
            // Track 10018: fork on this track's own merge_mode before ever
            // touching main. 'direct' keeps today's behavior byte-for-byte;
            // 'pr' (the default) opens a PR instead and leaves the branch/
            // worktree alone — see openTrackPrOnDone's own doc comment for
            // why it never falls back to a local merge on failure.
            const mergeMode = readTrackMergeMode(worktreePath, trackNumber);
            if (mergeMode === 'direct') {
              // Per-cycle: Merge and remove worktree on done:success
              console.log(`[worktree] Per-cycle mode: Merging track ${trackNumber} and cleaning up`);
              await mergeAndRemoveWorktree(trackNumber);
            } else {
              console.log(`[worktree] Per-cycle mode: merge_mode=pr for track ${trackNumber} — opening PR instead of merging`);
              await openTrackPrOnDone(trackNumber, worktreePath);
            }
          } else if (lifecycle === 'per-lane') {
            // Per-lane: Always remove after each run
            await removeWorktree(trackNumber);
          } else if (lifecycle === 'per-cycle') {
            // Per-cycle: Keep worktree if not done or not success
            console.log(`[worktree] Per-cycle mode: Preserving worktree for track ${trackNumber} (target lane: ${targetLane}, success: ${isSuccess})`);
          }
        }
      } catch (err) {
        console.error(`[${label}] Error during cleanup: ${err.message}`);
      }
    }


    if (!isSuccess) {
      if (!isExhausted) await checkExhaustion(logPath, cli);
      const commentBody = isExhausted
        ? `⏳ Provider ${cli} quota exhausted. Track re-queued automatically — retry count not consumed.`
        : `⚠️ Automation failed (PID: ${proc.pid}, Exit Code: ${code}).\nResult: ${patchData.lane_action_result}\nCheck logs for details.`;
      await postToCollectors(`/track/${trackNumber}/comment`, {
        project_id: projectId,
        author: cli === 'npx' ? 'worker' : cli,
        body: commentBody,
      }).catch(() => { });
    }
    console.log(`[${label}] Process ${proc.pid} exited with code ${code}`);
  });

  console.log(`[${label}] Launched (PID: ${proc.pid}) — ${command} ${args.join(' ')}`);
  return proc.pid;
}

// Track 1086: resolve (or mint) this worker's session for a track, so
// buildCliArgs can pass --resume instead of cold-starting. Returns
// { claude_session_id, isFresh } or null if session persistence isn't
// available (local-fs mode, or not yet registered) — null means "cold-start,
// same as before this track" everywhere it's checked.
async function resolveTrackSession(trackNumber) {
  if (getIsLocalFs() || !myWorkerId) return null;
  const { url, token } = primaryCollector();
  if (!url) return null;
  try {
    const { claude_session_id } = await get(url, token, `/track/${trackNumber}/session`);
    if (claude_session_id) return { claude_session_id, isFresh: false };
  } catch (err) {
    console.warn(`[session] Failed to look up session for track ${trackNumber} (cold-starting): ${err.message}`);
    return null;
  }
  return { claude_session_id: randomUUID(), isFresh: true };
}

// Persists a session id after a spawn actually happens — not at resolution
// time, so a track/CLI-unavailable bail-out (buildCliArgs returning null)
// never orphans a session row for a process that never ran.
async function persistTrackSession(trackNumber, claudeSessionId) {
  if (getIsLocalFs() || !myWorkerId) return;
  const { url, token } = primaryCollector();
  if (!url) return;
  await post(url, token, `/track/${trackNumber}/session`, { claude_session_id: claudeSessionId })
    .catch(err => console.warn(`[session] Failed to persist session for track ${trackNumber}: ${err.message}`));
}

// Track 1086 Phase 4: called after detecting a resume-failure — clears the
// stale session so the next attempt cold-starts.
async function invalidateTrackSession(trackNumber) {
  if (getIsLocalFs() || !myWorkerId) return;
  const { url, token } = primaryCollector();
  if (!url) return;
  await del(url, token, `/track/${trackNumber}/session`)
    .catch(err => console.warn(`[session] Failed to invalidate session for track ${trackNumber}: ${err.message}`));
}

async function buildCliArgs(skill, command, trackNumber, customPrompt = null, laneConfig = {}) {
  // Track 1086: resolve session before building args, so both the mock-CLI
  // test path and the real claude path can reflect --session-id vs
  // --resume consistently. Scoped to claude only, matching track_sessions'
  // claude_session_id-specific design — gemini/antigravity/generic CLI
  // paths are untouched, still cold-start every call.
  const session = await resolveTrackSession(trackNumber);
  const sessionArgs = session ? [session.isFresh ? '--session-id' : '--resume', session.claude_session_id] : [];
  const freshnessMarker = session ? `FRESH_SESSION: ${session.isFresh}\n\n` : '';

  // LC_MOCK_CLI overrides the CLI for testing (e.g. node conductor/tests/mock-cli.mjs)
  if (process.env.LC_MOCK_CLI) {
    const [cmd, ...rest] = process.env.LC_MOCK_CLI.split(' ');
    // sessionArgs deliberately NOT appended to the mock CLI's own argv:
    // mock-cli.mjs has no -p flag, so spawnCli's context-injection fallback
    // (which replaces args[args.length-1], assuming it's the prompt-like
    // last arg — the correct behavior for genuinely custom CLIs) would
    // clobber a trailing session id instead. Session selection is still
    // fully exercised and verifiable here via `session` (the 6th tuple
    // element, threaded to spawnCli) and the collector's own
    // GET/POST /track/:num/session calls — see
    // track-1086-session-worker.test.mjs, which asserts on mock-collector's
    // session state and on context-injection (PRODUCT_MD_MARKER) presence,
    // not on argv content.
    // Track 1102 F21: normally hardcoded 'mock' (the universal test
    // sentinel other code already relies on — see the LaneConductor
    // Collectors log line above). LC_MOCK_CLI_REPORTED_CLI lets a test
    // that specifically needs to exercise cli-identity-gated behavior
    // (e.g. the F21 ended-mid-work check, which only applies to real CLIs
    // that follow the SKILL's self-transition protocol) report a
    // different identity while still running the mock binary.
    const reportedCli = process.env.LC_MOCK_CLI_REPORTED_CLI || 'mock';
    return [cmd, [...rest, command, trackNumber], reportedCli, 'default', 'primary', session];
  }
  const proj = getProject();
  // Track 1116 REQ-7: a track's own **Model** marker beats the lane's
  // primary_model. Read directly off the track's index.md (not the DB) so
  // this works identically in local-fs mode, same reasoning buildCliArgs
  // already uses for everything else here — the worker has no DB dependency
  // by design. A stray **Provider** marker is detected and warned about,
  // never honored (provider stays project-fixed — same rule as lanes).
  let trackModel = null;
  if (!process.env.LC_MOCK_CLI) {
    const tracksDir = 'conductor/tracks';
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    const trackIndexContent = trackDirName ? readIfExists(join(tracksDir, trackDirName, 'index.md')) : null;
    if (trackIndexContent) {
      trackModel = parseModelOverrideMarker(trackIndexContent);
      const strayProvider = parseTrackProviderMarkerForWarning(trackIndexContent);
      if (strayProvider) {
        logger.warn({ trackNumber, strayProvider }, '[config] track index.md has a **Provider** marker — provider must stay fixed project-wide (REQ-7). Ignoring it.');
      }
    }
  }
  // Track 1111: cli stays project-wide fixed (REQ-3); only model varies
  // per lane (REQ-2's precedence — lane's primary_model wins over any
  // manual override in proj.primary.model), now with Track 1116's
  // track-level tier taking priority over both.
  const { cli: primary, model: primaryModel } = resolveLaneCliAndModel({ laneConfig, proj, track: { model: trackModel } });
  const secondary = proj.secondary?.cli;
  const secondaryModel = proj.secondary?.model;

  let chosenCli = primary, chosenModel = primaryModel;
  let chosenTier = 'primary';
  const primaryAvailable = await isProviderAvailable(primary);
  const secondaryAvailable = secondary ? await isProviderAvailable(secondary) : false;

  if (primary === 'claude') {
    const hasCapacity = await checkClaudeCapacity();
    if (!hasCapacity && secondary && secondaryAvailable) {
      console.log(`[fallback] Claude capacity exhausted, switching to secondary: ${secondary}`);
      chosenCli = secondary; chosenModel = secondaryModel;
      chosenTier = 'secondary';
    } else if (!hasCapacity && !secondaryAvailable) {
      console.log(`[blocked] Claude capacity exhausted and secondary ${secondary || ''} unavailable`);
      return null;
    }
  }

  if (!primaryAvailable) {
    if (secondary && secondaryAvailable) {
      console.log(`[fallback] ${primary} exhausted (quota), switching to secondary: ${secondary}`);
      chosenCli = secondary; chosenModel = secondaryModel;
      chosenTier = 'secondary';
    } else {
      console.log(`[blocked] ${primary} exhausted and no available secondary`);
      return null;
    }
  }

  const skillPath = `./.claude/skills/${skill}/SKILL.md`;
  const contextMsg = `Use the /${skill} skill. Skill definition is at: ${skillPath}. `;
  // Map lane-based commands to Skill command internal names if different
  let skillCommand = command;
  if (command === 'quality-gate') skillCommand = 'qualityGate';

  const prompt = customPrompt || `/${skill} ${skillCommand} ${trackNumber}`;

  if (chosenCli === 'gemini') {
    // Track 1077 Phase 4: Gemini CLI is retired (Google no longer supports
    // this tier for individual accounts — `npx @google/gemini-cli` fails
    // every dispatch with IneligibleTierError, confirmed live against
    // track 10014). Antigravity is the supported successor and is already
    // what discoverAvailableModels() falls back to for gemini's model
    // list; route actual execution there too. `chosenCli` stays 'gemini'
    // in the returned tuple — only the spawned command changes.
    const args = ['--dangerously-skip-permissions', '-p', `${contextMsg}${prompt}`];
    if (chosenModel) args.push('--model', chosenModel);
    return ['agy', args, chosenCli, chosenModel || 'default', chosenTier];
  }
  if (chosenCli === 'antigravity' || chosenCli === 'agy') {
    const args = ['--dangerously-skip-permissions', '-p', `${contextMsg}${prompt}`];
    if (chosenModel) args.push('--model', chosenModel);
    return ['agy', args, chosenCli, chosenModel || 'default', chosenTier];
  }
  if (chosenCli === 'claude') {
    // Inject skill context even for Claude to ensure it uses the right skill definition
    const fullPrompt = customPrompt ? `${contextMsg}\n\n${prompt}` : prompt;
    // Track 1087 Phase 1: stream-json output so the worker can parse
    // structured events as they're written, instead of tailing plain text
    // every 5s (see claude-cli-args.mjs for the --verbose requirement).
    const args = buildClaudeArgs({ sessionArgs, freshnessMarker, prompt: fullPrompt, model: chosenModel });
    return ['claude', args, chosenCli, chosenModel || 'default', chosenTier, session];
  }
  const args = ['-p', `${contextMsg}${prompt}`];
  if (chosenModel) args.push('--model', chosenModel);
  return [chosenCli, args, chosenCli, chosenModel || 'default', chosenTier];
}

setInterval(() => checkFileSyncQueue(), 5000);
setInterval(() => processFileSyncQueue().catch(e => console.error('[file-queue error]:', e.message)), 5000);

// Track 1110 Phase 4: local-fs mode's counterpart to Phase 3's DB claim —
// there's no Postgres to ask "is this track still mine," so this uses the
// OS's own atomic file creation instead. `wx` fails with EEXIST if the
// path already exists; unlike a plain existsSync-then-writeFileSync (the
// read-then-write gap that made the race real in the first place), there
// is no window between "check" and "claim" for a second process to slip
// through — the kernel resolves the race, not this process's own timing.
function claimTrackPath(tracksDir, trackDir) {
  return join(tracksDir, trackDir, '.claim-lock');
}

function claimTrackFile(tracksDir, trackDir) {
  try {
    closeSync(openSync(claimTrackPath(tracksDir, trackDir), 'wx'));
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function releaseTrackClaim(tracksDir, trackDir) {
  try { rmSync(claimTrackPath(tracksDir, trackDir), { force: true }); } catch { /* best-effort */ }
}

// Track 1110 Phase 4: a worker that dies (crash, SIGKILL) between claiming
// a track and spawnCli's exit handler releasing it would otherwise leave
// that track permanently unclaimable — nothing else ever removes the
// marker.
//
// Deliberately NOT a blind "no PIDs yet, so anything present is stale"
// sweep the way `resetFilesystemRunningStatus` above is — multiple
// legitimate workers (worker_number 1, 2, ...) share this SAME
// conductor/tracks/ directory (track 1084 Phase 0), so "I haven't
// claimed anything yet" says nothing about whether ANOTHER, currently
// live worker claimed a track moments before this one started up. A
// blind sweep would delete a live sibling's claim out from under it —
// reintroducing the exact race this phase exists to close, just moved to
// worker-startup timing instead of auto-launch timing.
//
// Uses mtime-based staleness instead, mirroring `checkAndClaimGitLock`'s
// already-established pattern in this same file for the identical
// problem (a per-track lock that must survive concurrent legitimate
// holders but still recover from a dead one). A claim marker should
// never legitimately outlive spawnCli's own runaway-process timeout by
// more than a small margin, since that timeout SIGTERMs/SIGKILLs the
// process and its exit handler releases the claim either way.
const CLAIM_STALE_MS = (Number(process.env.LC_SPAWN_TIMEOUT_MS) || config.worker?.spawn_timeout_ms || 300000) + 30000;
(function clearStaleClaimMarkers() {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return;
  for (const dir of readdirSync(tracksDir).filter(d => /\d+/.test(d))) {
    const claimPath = claimTrackPath(tracksDir, dir);
    if (!existsSync(claimPath)) continue;
    const ageMs = Date.now() - statSync(claimPath).mtimeMs;
    if (ageMs > CLAIM_STALE_MS) {
      releaseTrackClaim(tracksDir, dir);
      console.log(`[startup] Cleared stale claim marker for ${dir} (age: ${Math.round(ageMs / 1000)}s)`);
    }
  }
})();

// ── Local-fs auto-launch (Mode 1: no API) ─────────────────────────────────────
// Scans conductor/tracks/*/index.md for queued tracks, respects workflow.json limits.
// claimableSet (Track 1084 Phase 3): in API mode, the set of track_numbers this
// worker is currently allowed to claim (from /claimable-tracks — see caller).
// null means no restriction (local-fs mode, or a fetch failure — see caller).
async function autoLaunchLocalFs(globalLimit, claimableSet = null) {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return;

  const proj = getProject();
  const projectId = proj?.id;

  // Track AM-1119 Phase 6: prefix-agnostic, matching every other track-
  // folder scan in this file (see "Protocol: Locating Tracks") and `lc
  // new`'s own naming (bin/lc.mjs) — `INITIALS-NNN-slug` (e.g.
  // `AM-1000-app-skeleton`), not just the legacy bare `NNN-slug`. Anchoring
  // to the start of the string here (`/^\d+/`) silently excluded every
  // prefixed folder from auto-launch entirely — found live via this
  // track's own Phase 3 auto-generated tracks (which use the modern
  // prefixed convention) never getting claimed by a real running worker.
  const dirs = readdirSync(tracksDir)
    .filter(d => /\d+/.test(d))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));  // process lowest track numbers first

  const currentlyRunningPerLane = {};
  // Track AM-1119 Phase 3 (Task 2): one pass to know every track's current
  // lane up front, so the dependency gate below (**Depends On**) can check
  // "is track X done?" without a second directory scan per candidate.
  const laneStatusByTrackNumber = {};
  for (const dir of dirs) {
    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;
    const content = readFileSync(indexPath, 'utf8');
    const laneMatchForMap = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
    const trackNumMatchForMap = dir.match(/(\d+)/);
    if (laneMatchForMap && trackNumMatchForMap) {
      laneStatusByTrackNumber[trackNumMatchForMap[1]] = laneMatchForMap[1].trim();
    }
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*running/i);
    if (statusMatch) {
      const laneMatch = laneMatchForMap;
      if (laneMatch) {
        const lane = laneMatch[1].trim();
        currentlyRunningPerLane[lane] = (currentlyRunningPerLane[lane] || 0) + 1;
      }
    }
  }

  const lanesClaimedThisRound = new Map();

  for (const dir of dirs) {
    if (runningPids.size >= globalLimit) break;

    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;

    const content = readFileSync(indexPath, 'utf8');
    const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
    if (!laneMatch) continue;

    const lane_status = laneMatch[1].trim();
    const lane_action_status = statusMatch?.[1]?.trim() ?? 'queue';

    const trackNumMatch = dir.match(/(\d+)/);
    if (!trackNumMatch) continue;
    const track_number = trackNumMatch[1];

    const waitingForReply = parseWaitingForReply(content);
    const autoRun = parseAutoRun(content);

    // Track AM-1119 Phase 3 (Task 2): a track naming dependencies via
    // **Depends On** may not be auto-launched until every one of them has
    // reached lane `done` — used to gate the wizard-generated deploy track
    // behind its feature tracks. Bypassed for waitingForReply, same as the
    // autoRun/claimableSet gates above: a track already mid-conversation
    // must still get answered regardless of unrelated dependency state.
    // A dependency that doesn't exist (bad data, or it was deleted) is
    // treated as unmet rather than satisfied — fails closed, not open.
    if (!waitingForReply) {
      const dependsOn = parseDependsOn(content);
      if (dependsOn.length > 0) {
        const unmet = dependsOn.filter(dep => laneStatusByTrackNumber[dep] !== 'done');
        if (unmet.length > 0) {
          console.log(`[local-fs] Track ${track_number}: waiting on dependencies [${unmet.join(', ')}] to reach done — skipping`);
          continue;
        }
      }
    }

    // ── Supervised implement: "done" reply transitions to quality-gate with scheduling ──
    if (waitingForReply && lane_status === 'implement') {
      const trackType = parseTrackType(content);
      if (trackType !== 'dev') {
        const convPath = join(tracksDir, dir, 'conversation.md');
        if (existsSync(convPath)) {
          const convContent = readFileSync(convPath, 'utf8');
          // Find the last human message — if it's "done" (or contains "done"), transition
          const lastHumanMatch = convContent.match(/>\s+\*\*human\*\*:\s+([^\n]+)(?:\n[\s\S]*)?$/im);
          if (lastHumanMatch && /\bdone\b/i.test(lastHumanMatch[1])) {
            console.log(`[local-fs] Track ${track_number}: supervised implement "done" detected — scheduling quality gate`);
            // Parse KPI window from spec.md
            const specPath = join(tracksDir, dir, 'spec.md');
            let windowMs = 0;
            if (existsSync(specPath)) {
              const spec = readFileSync(specPath, 'utf8');
              const windowMatch = spec.match(/\*\*Window\*\*:\s*([^\n]+)/i);
              if (windowMatch) {
                const w = windowMatch[1].trim();
                const hours = w.match(/(\d+)h/i)?.[1];
                const days = w.match(/(\d+)d/i)?.[1];
                windowMs = ((parseInt(hours || 0) + parseInt(days || 0) * 24) * 60 * 60 * 1000);
              }
            }
            const now = new Date();
            const checkAfter = new Date(now.getTime() + (windowMs || 0));
            const updateHeader = (c, h, v) => {
              const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
              return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
            };
            let updated = content;
            updated = updateHeader(updated, 'Waiting for reply', 'no');
            updated = updateHeader(updated, 'Lane', workflowConfig?.lanes?.implement?.on_success || 'quality-gate');
            updated = updateHeader(updated, 'Lane Status', 'queue');
            if (windowMs > 0) {
              updated = updateHeader(updated, 'KPI Check After', checkAfter.toISOString());
              updated = updateHeader(updated, 'KPI Scheduled At', now.toISOString());
            }
            writeFileSync(indexPath, updated, 'utf8');
            console.log(`[local-fs] Track ${track_number}: transitioned to quality-gate${windowMs > 0 ? `, KPI check after ${checkAfter.toISOString()}` : ''}`);
            continue; // Don't spawn a CLI — the file change will trigger normal pickup next cycle
          }
        }
      }
    }

    // ── KPI scheduling: skip quality-gate if kpi_check_after hasn't passed ──
    if (lane_status === 'quality-gate' && lane_action_status === 'queue') {
      const kpiCheckAfter = parseKpiCheckAfter(content);
      if (kpiCheckAfter && !isNaN(kpiCheckAfter) && kpiCheckAfter > new Date()) {
        const remainingMs = kpiCheckAfter - new Date();
        const remainingH = Math.round(remainingMs / 3600000 * 10) / 10;
        console.log(`[local-fs] Track ${track_number}: KPI window not reached — ${remainingH}h remaining. Skipping.`);
        continue;
      }
    }

    // Normally only process 'queue' status
    // EXCEPTION: if we are answering a human, bypass 'queue' check
    if (lane_action_status !== 'queue' && !waitingForReply) continue;

    // Track 1084 Phase 3: assignee/pin gating (API mode only — claimableSet is
    // null in local-fs mode). Bypassed for waitingForReply the same way the
    // concurrency/retry checks below are — a track already mid-conversation
    // should get answered regardless of who's currently "assigned" to claim
    // new queue work, and claimableSet only covers queue-status tracks anyway.
    //
    // Track 1109: the operator allowlist (--only-tracks) is applied in the
    // same predicate, but it NARROWS ONLY and is NOT bypassed for
    // waitingForReply — see claim-scope.mjs for why that asymmetry is
    // deliberate.
    //
    // Track 10017: a track's own `**Auto Run**` marker (default false) is a
    // second, independent gate in the same predicate — a queued track is not
    // auto-picked unless it opts in, bypassed only for waitingForReply.
    if (!isTrackClaimable(track_number, { claimableSet, onlyTracks, waitingForReply, autoRun })) continue;

    // Passive lanes should not trigger auto-automation actions
    if ((lane_status === 'done' || lane_status === 'backlog') && !waitingForReply) continue;

    let laneConfig = workflowConfig?.lanes?.[lane_status];
    if (!laneConfig && waitingForReply) laneConfig = {}; // Allow auto-answer on any lane

    if (!laneConfig) continue;

    const laneLimit = laneConfig.parallel_limit ?? workflowConfig?.defaults?.parallel_limit ?? 1;
    const fromFiles = currentlyRunningPerLane[lane_status] || 0;
    // Cross-check with internal state for reliability
    let internalRunning = 0;
    for (const l of runningLaneMap.values()) if (l === lane_status) internalRunning++;

    const alreadyRunning = Math.max(fromFiles, internalRunning);
    const alreadyClaimed = lanesClaimedThisRound.get(lane_status) || 0;

    // BYPASS concurrency limits if we are just answering a question
    if (alreadyRunning + alreadyClaimed >= laneLimit) {
      console.log(`[local-fs] Lane "${lane_status}" at limit ${laneLimit} (Running: ${alreadyRunning}, Claimed: ${alreadyClaimed}). Skipping ${dir}.`);
      continue;
    }

    // Check retry count (stored in .retry-count file next to index.md)
    // BYPASS retry check if we are answering a user question
    const retryCountPath = join(tracksDir, dir, '.retry-count');
    const retryCount = parseInt(readIfExists(retryCountPath) || '0');
    const maxRetries = laneConfig.max_retries ?? workflowConfig?.defaults?.max_retries ?? 1;
    if (retryCount >= maxRetries && !waitingForReply) {
      console.log(`[local-fs] Track ${track_number} max retries (${maxRetries}) reached. Marking failure.`);
      let failed = content.replace(/\*\*Lane Status\*\*:\s*\w+/i, '**Lane Status**: failure');
      const onFailure = laneConfig.on_failure ?? workflowConfig?.defaults?.on_failure;
      if (onFailure && onFailure !== 'stay') {
        failed = failed.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${onFailure}`);
        console.log(`[local-fs] Track ${track_number} failure transition: ${lane_status} → ${onFailure}`);
      }
      writeFileSync(indexPath, failed, 'utf8');
      continue;
    }

    let cmd_type = lane_status;
    let label = `local-fs-${lane_status}`;
    let customPrompt = null;

    if (waitingForReply) {
      label = 'local-fs-answer';
      // Respect the current lane's skill if it's an active one, otherwise fallback to implement
      if (['plan', 'implement', 'review', 'quality-gate'].includes(lane_status)) {
        cmd_type = lane_status;
      } else {
        cmd_type = 'implement';
      }

      // Detect if the latest unanswered message is a brainstorm-tagged message
      const convPath = join(tracksDir, dir, 'conversation.md');
      const isBrainstormReply = existsSync(convPath) &&
        readFileSync(convPath, 'utf8').match(/>\s+\*\*human\*\*\s+\(brainstorm\)/i);

      if (isBrainstormReply) {
        // Delegate entirely to the skill — it has the full brainstorm protocol
        // (read all context files, ask one question at a time, set waitingForReply, etc.)
        customPrompt = null;
        cmd_type = 'brainstorm';
      } else {
        customPrompt = `The user has sent a message in the track conversation. Read conductor/tracks/${dir}/conversation.md to find their message.
Use /laneconductor comment ${track_number} to post your reply directly in the conversation. If it is a question, answer it. If it is a decision, acknowledge and incorporate it.
You MUST use /laneconductor pulse ${track_number} ${lane_status} ${parseProgress(content)} "Answered user question" when done.`;
      }
    }

    const cliArgs = await buildCliArgs('laneconductor', cmd_type, track_number, customPrompt, laneConfig);
    if (!cliArgs) {
      console.log(`[local-fs] No available provider for track ${track_number}. Skipping.`);
      continue;
    }

    // Track 1110 Phase 3: in API mode, everything above this point is
    // still a LOCAL decision from this process's own reading of
    // index.md — exactly the read-then-write with no lock between them
    // that made the claim race real (see conductor/tracks/1110-*/spec.md).
    // Before actually spawning, ask the DB to atomically claim this ONE
    // track (POST /tracks/claim-queue, FOR UPDATE SKIP LOCKED — already
    // built and tested, just never called by this loop before). If the
    // DB says someone else already has it, don't spawn, don't write —
    // this process simply lost the race for this track this cycle.
    // Skipped for local-fs mode (no DB to ask; Phase 4 covers that case
    // with its own FS-atomic primitive) and for waitingForReply (an
    // answer-flow isn't driven by lane_action_status==='queue', which is
    // what claim-queue's own WHERE clause requires — it would never
    // match and would incorrectly skip a legitimate reply).
    if (!getIsLocalFs() && !waitingForReply) {
      try {
        const { url, token } = primaryCollector();
        const { tracks: won } = await post(url, token, '/tracks/claim-queue', { limit: 1, track_number });
        if (!won || won.length === 0) {
          console.log(`[local-fs] Track ${track_number}: lost the DB claim race this cycle (another worker already has it). Skipping.`);
          continue;
        }
      } catch (err) {
        console.error(`[local-fs] Track ${track_number}: claim-queue call failed (${err.message}) — skipping rather than spawning unclaimed.`);
        continue;
      }
    }

    // Track 1110 Phase 4: local-fs mode's counterpart — no DB to ask, so
    // this uses the OS's own atomic file creation instead
    // (claimTrackFile, defined above this function). Same reasoning as
    // Phase 3's block: without this, two worker processes sharing this
    // directory could both read 'queue' in the same tick and both spawn
    // for the same track — the exact race Phase 1's reproduction proved
    // real. waitingForReply is excluded for the same reason as Phase 3:
    // an answer-flow isn't a queue-claim.
    if (getIsLocalFs() && !waitingForReply) {
      if (!claimTrackFile(tracksDir, dir)) {
        console.log(`[local-fs] Track ${track_number}: lost the file claim race this cycle (another worker already has it). Skipping.`);
        continue;
      }
    }

    try {
      const [cmd, args, cli, model, tier, session] = cliArgs;

      // Update file to running status so UI/tests can see it
      const updateHeader = (content, header, value) => {
        const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
        if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
        return content.trim() + `\n**${header}**: ${value}\n`;
      };
      const runningContent = updateHeader(content, 'Lane Status', 'running');
      writeFileSync(indexPath, runningContent, 'utf8');

      // Track 1115 REQ-3: same call site handles both the normal queue claim
      // and the waitingForReply answer-flow — trigger is computed inline from
      // the local already in scope, not threaded from two separate sites.
      const trigger = waitingForReply ? 'manual-dispatch' : 'auto-queue';
      const spawnedPid = await spawnCli(cmd, args, label, track_number, cli, model, tier, lane_status, laneConfig, projectId, session, trigger);
      lanesClaimedThisRound.set(lane_status, alreadyClaimed + 1);
      console.log(`[local-fs] Track ${track_number} → ${laneConfig.auto_action} (PID: ${spawnedPid})`);
    } catch (err) {
      console.error(`[local-fs] Failed to spawn track ${track_number}:`, err.message);
    }
  }
}

// ── Track 1085: Manual Worker Dispatch ───────────────────────────────────────
// Per-worker command inbox, checked every sync tick regardless of
// sync-only/sync+poll mode — this is the only way a sync-only worker (which
// never polls the general queue) does anything at all. Requires the
// Collector API (myWorkerId/primaryCollector are both null in local-fs
// mode), so this is a no-op there — dispatch inherently needs a place to
// store "which worker" outside the filesystem.
//
// track_number -> dispatch id, for lane-action entries that have been
// claimed and spawned but haven't finished yet. spawnCli itself is
// fire-and-forget (see autoLaunchLocalFs), so completion is detected by
// polling the same Lane Status field spawnCli's own exit handler
// already writes to index.md, rather than adding a second completion path
// into spawnCli's already-complex internals.
const activeDispatch = new Map();

// Track 1114: "Complete & Merge" autopilot. Same poll-based completion
// detection as activeDispatch (reads Lane/Lane Status from index.md) but
// chains multiple stages instead of reporting after one — track_number ->
// { dispatchId, stagesRun: string[], currentLane: string }.
const activeAutoComplete = new Map();

async function reportAutoCompleteResult(dispatchId, status, resultText) {
  const { url, token } = primaryCollector();
  if (!url) return;
  await patch(url, token, `/worker-dispatch/${dispatchId}`, { status, result: resultText })
    .catch(err => logger.warn({ dispatchId, err: err.message }, '[dispatch] Failed to report auto-complete-track result'));
}

// Kicks off ONE stage (the track's current lane) and registers it in
// activeAutoComplete for reconcileAutoComplete to pick up once it finishes
// — mirrors the manual lane-action dispatch path in checkDispatchInbox
// (buildCliArgs → write Lane Status: running → spawnCli), kept as its own
// copy rather than refactored to share code, since that path is
// already well-tested and this needed a from-scratch call site anyway
// (no `entry` object here — the "entry" is the ongoing sequence itself).
async function startNextAutoCompleteStage(trackNumber, dispatchId, stagesRun) {
  const tracksDir = 'conductor/tracks';
  const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
  if (!trackDirName) {
    await reportAutoCompleteResult(dispatchId, 'failed', `Stopped after [${stagesRun.join(' → ') || 'no stages'}]: track ${trackNumber} not found locally`);
    activeAutoComplete.delete(trackNumber);
    return;
  }
  const indexPath = join(tracksDir, trackDirName, 'index.md');
  const content = readFileSync(indexPath, 'utf8');
  const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
  const currentLane = laneMatch?.[1]?.trim();

  if (currentLane === 'done') {
    // Already done when this stage would have started (e.g. dispatched
    // against a track that reached done:success some other way) — skip
    // straight to merge instead of trying to "run" a done lane.
    await finishAutoCompleteWithMerge(trackNumber, dispatchId, stagesRun);
    return;
  }

  const laneConfig = workflowConfig?.lanes?.[currentLane];
  if (!currentLane || !laneConfig) {
    await reportAutoCompleteResult(dispatchId, 'failed', `Stopped after [${stagesRun.join(' → ') || 'no stages'}]: track ${trackNumber} is in an unrecognized lane "${currentLane}"`);
    activeAutoComplete.delete(trackNumber);
    return;
  }

  const cliArgs = await buildCliArgs('laneconductor', currentLane, trackNumber, null, laneConfig);
  if (!cliArgs) {
    await reportAutoCompleteResult(dispatchId, 'failed', `Stopped after [${stagesRun.join(' → ') || 'no stages'}]: no available provider for track ${trackNumber} at lane ${currentLane}`);
    activeAutoComplete.delete(trackNumber);
    return;
  }

  const [cmd, args, cli, model, tier, session] = cliArgs;
  const updateHeader = (c, h, v) => {
    const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
    return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
  };
  const originalLaneActionStatus = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() || 'queue';
  writeFileSync(indexPath, updateHeader(content, 'Lane Status', 'running'), 'utf8');
  const proj = getProject();
  // Unlike checkDispatchInbox's identical spawnCli call, this one had no
  // try/catch — a lock-contention or worktree-setup failure (observed
  // live: a second auto-complete-track stage racing an already-running
  // one for the same track) threw straight out of this async function,
  // permanently stuck the file's Lane Status on 'running' with nothing to
  // ever revert it, and left the dispatch row silently 'claimed' forever.
  let spawnedPid;
  try {
    spawnedPid = await spawnCli(cmd, args, `auto-complete-${currentLane}`, trackNumber, cli, model, tier, currentLane, laneConfig, proj?.id, session, 'auto-complete');
  } catch (err) {
    logger.warn({ trackNumber, currentLane, dispatchId, err: err.message }, '[auto-complete] spawnCli failed');
    writeFileSync(indexPath, updateHeader(content, 'Lane Status', originalLaneActionStatus), 'utf8');
    const resultText = `Stopped after [${stagesRun.join(' → ') || 'no stages'}]: could not start ${currentLane}: ${err.message}`;
    await reportAutoCompleteResult(dispatchId, 'failed', resultText);
    try {
      appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
    } catch (writeErr) {
      logger.warn({ trackNumber, err: writeErr.message }, '[auto-complete] Failed to post spawn-failure conversation comment');
    }
    activeAutoComplete.delete(trackNumber);
    return;
  }
  logger.info({ trackNumber, currentLane, spawnedPid, dispatchId }, '[auto-complete] stage started');
  // stagesRun is the history BEFORE this stage — appended with the lane
  // just started so reconcileAutoComplete's next check has an accurate
  // record regardless of what the caller already had.
  activeAutoComplete.set(trackNumber, { dispatchId, stagesRun: [...stagesRun, currentLane], currentLane });
}

async function finishAutoCompleteWithMerge(trackNumber, dispatchId, stagesRun) {
  activeAutoComplete.delete(trackNumber);

  // Track 1115 REQ-5/D8: a main-mode track was never on a branch, so
  // "already on main" IS the merged state — no mergeWorktreeBranch() call,
  // and no `{ merged: false, reason: 'no-branch' }` surfaced as a failure.
  const finishTracksDir = 'conductor/tracks';
  const finishTrackDirName = resolveTrackFolder(finishTracksDir, trackNumber);
  const finishIndexContent = finishTrackDirName ? (readIfExists(join(finishTracksDir, finishTrackDirName, 'index.md')) || '') : '';
  const finishWorkspaceMode = resolveWorkspaceMode({
    laneStatus: 'done',
    workspaceMarker: parseWorkspaceMarker(finishIndexContent),
    trackType: parseTrackKind(finishIndexContent),
    trigger: null,
    projectWorkspaceMode: getProject()?.workspace_mode ?? null,
  });

  let mergeResult;
  const stageList = stagesRun.join(' → ') || '(already done)';
  let resultText;
  if (finishWorkspaceMode === 'main') {
    mergeResult = { merged: true, reason: 'already-on-main' };
    resultText = `Completed [${stageList}] — already on main, no merge needed.`;
  } else if (resolveMergeMode({ merge_mode: parseMergeModeMarker(finishIndexContent) }) === 'pr') {
    // Found live (track 1119): this function called mergeWorktreeBranch()
    // unconditionally, regardless of merge_mode — every OTHER place in this
    // file that reaches "done" forks on mode first (direct: merge locally;
    // pr: openTrackPrOnDone), e.g. the per-cycle worktree-lifecycle branch
    // above. This one didn't, so a pr-mode track's "Complete & Merge" tried
    // a raw local merge, hit a real conflict, and failed with a confusing
    // message instead of doing what pr-mode actually asked for: push the
    // branch and open a PR.
    const worktreePath = join(process.cwd(), '.worktrees', String(trackNumber));
    if (!existsSync(worktreePath)) {
      mergeResult = { merged: false, reason: 'no-worktree-for-pr' };
      resultText = `Completed [${stageList}] but could not open a PR: no worktree found for track ${trackNumber}.`;
    } else {
      await openTrackPrOnDone(trackNumber, worktreePath);
      // openTrackPrOnDone() handles its own error reporting (a track
      // comment + pr_status: 'error') and never throws — re-read its own
      // markers to tell success from failure here, same as reconcilePrTracks
      // already does elsewhere in this file.
      const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
      const wtTrackDir = resolveTrackFolder(wtTracksDir, trackNumber);
      const wtContent = wtTrackDir ? (readIfExists(join(wtTracksDir, wtTrackDir, 'index.md')) || '') : '';
      const prNumber = wtContent.match(/\*\*PR Number\*\*:\s*(\d+)/i)?.[1];
      mergeResult = prNumber ? { merged: true, reason: 'pr-opened' } : { merged: false, reason: 'pr-open-failed' };
      resultText = prNumber
        ? `Completed [${stageList}] — merge_mode is pr, opened PR #${prNumber} instead of merging locally.`
        : `Completed [${stageList}] but opening a PR failed — see the track's own comments for details.`;
    }
  } else {
    try {
      mergeResult = await mergeWorktreeBranch({ repoRoot: process.cwd(), trackNumber: String(trackNumber), mainBranch: getMainBranch() });
    } catch (err) {
      mergeResult = { merged: false, reason: 'error', error: err.message };
    }
    resultText = mergeResult.merged
      ? `Completed [${stageList}] and merged track-${trackNumber} into main (${mergeResult.mergeCommit}).`
      : `Completed [${stageList}] but merge failed: ${mergeResult.reason}${mergeResult.error ? `: ${mergeResult.error}` : ''}${mergeResult.conflictPaths?.length ? ` (${mergeResult.conflictPaths.join(', ')})` : ''}`;
  }
  await reportAutoCompleteResult(dispatchId, mergeResult.merged ? 'done' : 'failed', resultText);
  try {
    const tracksDir = 'conductor/tracks';
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    if (trackDirName) appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
  } catch (err) {
    logger.warn({ trackNumber, err: err.message }, '[auto-complete] Failed to post completion conversation comment');
  }
}

// Poll in-flight auto-complete sequences for the CURRENT stage's
// completion, same 5s cadence as reconcileActiveDispatch.
async function reconcileAutoComplete() {
  if (activeAutoComplete.size === 0) return;
  const tracksDir = 'conductor/tracks';

  for (const [trackNumber, entry] of activeAutoComplete) {
    const { dispatchId, stagesRun, currentLane: beforeLane } = entry;
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    const indexPath = trackDirName ? join(tracksDir, trackDirName, 'index.md') : null;
    if (!indexPath || !existsSync(indexPath)) {
      await reportAutoCompleteResult(dispatchId, 'failed', `Stopped after [${stagesRun.join(' → ')}]: track ${trackNumber} not found locally`);
      activeAutoComplete.delete(trackNumber);
      continue;
    }

    const content = readFileSync(indexPath, 'utf8');
    const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
    const afterLane = laneMatch?.[1]?.trim();
    const afterStatus = statusMatch?.[1]?.trim();

    const outcome = classifyAutoCompleteOutcome({ beforeLane, afterLane, afterStatus });

    if (outcome.action === 'wait') continue;

    if (outcome.action === 'stop') {
      activeAutoComplete.delete(trackNumber);
      const resultText = `Stopped after [${stagesRun.join(' → ')}]: ${outcome.reason}. Track left at ${afterLane}/${afterStatus} for review.`;
      await reportAutoCompleteResult(dispatchId, 'failed', resultText);
      try {
        if (trackDirName) appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
      } catch (err) {
        logger.warn({ trackNumber, err: err.message }, '[auto-complete] Failed to post stop conversation comment');
      }
      continue;
    }

    if (outcome.action === 'merge') {
      await finishAutoCompleteWithMerge(trackNumber, dispatchId, [...stagesRun, afterLane]);
      continue;
    }

    // action === 'advance'
    await startNextAutoCompleteStage(trackNumber, dispatchId, stagesRun);
  }
}

// Track 1091 Phase 3: reads the manager's own projects-directory config
// (written by `lc worker start --manager --projects-dir <path>`, see
// bin/lc.mjs) directly — same pattern this file already uses for
// ~/.laneconductorrc/~/.laneconductor-auth.json rather than threading the
// value through as a spawn arg.
function readManagerProjectsDir() {
  const configPath = join(os.homedir(), '.laneconductor', 'manager-config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')).projectsDir || null;
  } catch {
    return null;
  }
}

// Track 1091 Phase 3: manager-worker-only handler for a create-project
// dispatch. Reuses the existing /laneconductor setup scaffold generate
// skill command (unmodified, spec.md REQ-4) rather than rebuilding
// scaffold generation. Deliberately does NOT register the new project via
// direct SQL — this worker never touches Postgres directly, only through
// the Collector API — instead it spawns a normal `lc worker start` at the
// new location, which self-registers through the exact same
// upsertWorker()/POST /project/ensure/POST /worker/register pipeline every
// other project already uses.
// Track AM-1119 Phase 3 (Task 2): writes the folders + file_sync_queue.md
// entries for a derived track plan (see services/wizard-track-plan.mjs),
// mirroring exactly the format `lc new` (bin/lc.mjs) writes for a
// human-created track — `**Auto Run**: yes` and (on the final track, when
// present) `**Depends On**` are the only additions beyond that template,
// since these must run unattended and the deploy track must wait for its
// siblings. `targetPath` is the NEW project's directory, not this
// manager's own — getAuthorInfo runs `git config` inside it once it's a
// repo (falls back to global config exactly like `lc new` does, since git
// config is inherited unless the new repo has its own local override).
function writeGeneratedTracks({ targetPath, projectName, brainstormSummary, deploymentProvider }) {
  const trackPlan = deriveTrackPlan({ projectName, brainstormSummary, deploymentProvider });
  if (trackPlan.length === 0) return [];

  const tracksDir = join(targetPath, 'conductor', 'tracks');
  mkdirSync(tracksDir, { recursive: true });
  const queuePath = join(tracksDir, 'file_sync_queue.md');

  const author = getAuthorInfo(targetPath);

  const existingDirNumStrs = readdirSync(tracksDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name.match(/(\d+)/)?.[1])
    .filter(Boolean);
  let nextNum = existingDirNumStrs.length ? Math.max(...existingDirNumStrs.map(s => parseInt(s, 10))) + 1 : 1000;

  const generated = [];
  for (const t of trackPlan) {
    const numStr = String(nextNum);
    const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const displayId = `${author.initials}-${numStr}`;
    const folderName = `${displayId}-${slug}`;
    const trackPath = join(tracksDir, folderName);
    mkdirSync(trackPath, { recursive: true });

    // Only the final (deploy) track sets dependsOnAll — depends on every
    // track generated ahead of it in this same batch (scaffold + feature
    // tracks), not on anything pre-existing in the project.
    const dependsLine = t.dependsOnAll && generated.length
      ? `**Depends On**: ${generated.map(g => g.trackNumber).join(', ')}\n`
      : '';
    const summary = `${t.problem} ${t.solution}`.slice(0, 200);
    const indexContent = `# Track ${displayId}: ${t.title}\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n**Type**: dev\n**Auto Run**: yes\n${dependsLine}**Author**: ${author.initials}\n**Created By**: ${author.email}\n**Summary**: ${summary}\n\n## Problem\n\n${t.problem}\n\n## Solution\n\n${t.solution}\n`;
    writeFileSync(join(trackPath, 'index.md'), indexContent, 'utf8');

    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${numStr}: ${t.title}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${t.title}\n**Description**: ${t.solution}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;
    if (existsSync(queuePath)) {
      let existingQueue = readFileSync(queuePath, 'utf8');
      existingQueue = existingQueue.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
      writeFileSync(queuePath, existingQueue);
    } else {
      writeFileSync(queuePath, `# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n${queueEntry}\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n`);
    }

    generated.push({ trackNumber: numStr, displayId, folderName, title: t.title });
    nextNum += 1;
  }

  return generated;
}

async function runCreateProject(entry) {
  const repoSource = entry.payload?.repo_source;
  const scaffoldContext = entry.payload?.scaffold_context;
  if (!repoSource || !scaffoldContext) {
    return { ok: false, error: 'payload.repo_source and payload.scaffold_context are required' };
  }

  // Task 6: only same-machine creation is supported today — 1089 (remote
  // provisioning) doesn't exist yet to hand off to. target_machine is an
  // optional hint the dispatch creator can set; absent means "here".
  if (repoSource.target_machine && repoSource.target_machine !== hostname) {
    return {
      ok: false,
      error: `create-project targeting a different machine (${repoSource.target_machine}) requires remote provisioning (track 1089), which doesn't exist yet — not supported`,
    };
  }

  const projectsDir = readManagerProjectsDir();
  const resolved = resolveRepoTarget({ repoSource, scaffoldContext, projectsDir });
  if (!resolved.ok) return resolved;
  const { targetPath, needsClone, gitUrl } = resolved;

  if (needsClone) {
    if (existsSync(targetPath)) return { ok: false, error: `Target path already exists: ${targetPath}` };
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      execSync(`git clone "${gitUrl}" "${targetPath}"`, { stdio: 'pipe' });
    } catch (err) {
      return { ok: false, error: `git clone failed: ${err.message}` };
    }
  } else if (!existsSync(targetPath)) {
    return { ok: false, error: `repo_source.type is "path" but ${targetPath} does not exist` };
  }

  mkdirSync(join(targetPath, 'conductor'), { recursive: true });
  writeFileSync(join(targetPath, 'conductor', '.setup-scaffold-context.json'), JSON.stringify(scaffoldContext, null, 2));

  // Points at the CANONICAL skill file, not a per-project symlink — the new
  // project doesn't have its own .claude/skills/laneconductor yet, since
  // creating that symlink is itself one of this command's own steps.
  const installPath = getInstallPath();
  const skillPath = installPath ? join(installPath, '.claude/skills/laneconductor/SKILL.md') : './.claude/skills/laneconductor/SKILL.md';
  const prompt = `Use the /laneconductor skill. Skill definition is at: ${skillPath}. /laneconductor setup scaffold generate`;

  const scaffoldResult = await new Promise((resolvePromise) => {
    let cmd, args;
    if (process.env.LC_MOCK_CLI) {
      const [c, ...rest] = process.env.LC_MOCK_CLI.split(' ');
      cmd = c; args = [...rest, 'setup-scaffold-generate', 'create-project'];
    } else {
      cmd = 'claude';
      args = buildClaudeArgs({ prompt });
    }
    const logPath = join(process.cwd(), 'conductor', 'logs', `create-project-${Date.now()}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const out = openSync(logPath, 'a');
    const proc = spawn(cmd, args, { cwd: targetPath, stdio: ['ignore', out, out], env: { ...process.env } });
    proc.on('exit', (code) => resolvePromise({ code, logPath }));
    proc.on('error', (err) => resolvePromise({ code: 1, error: err.message, logPath }));
  });

  if (scaffoldResult.code !== 0) {
    return { ok: false, error: `setup scaffold generate exited ${scaffoldResult.code} — see ${scaffoldResult.logPath}` };
  }

  // Track AM-1119 Phase 2 (Task 3, REQ-2/AC-2): the wizard's Deployment
  // step already produced a fully-formed { provider, environments }
  // choice client-side — no LLM brainstorm needed to turn that into
  // deploy.json/deployment-stack.md/.env.example, unlike `lc setup-deploy`
  // (which exists to interview a human about an unknown existing repo).
  // Written deterministically, same shape the deploy-config API route
  // reads/writes, so DeployPanel works against it unchanged. MUST run
  // after the scaffold-generate step above, not before: the skill's
  // `setup scaffold generate` command unconditionally (re)writes
  // conductor/deployment-stack.md as an unconfigured stub, so writing
  // wizard-derived content earlier would just get clobbered. Skipped
  // entirely when the wizard picked "skip" or wasn't used at all (legacy
  // Quick create dispatch has no `wizard` key) — deployment-stack.md then
  // stays the stub `setup scaffold generate` just wrote.
  const wizardDeployment = entry.payload?.wizard?.deployment;
  if (wizardDeployment && wizardDeployment.provider !== 'skip') {
    const projectName = scaffoldContext.project?.name || basename(targetPath);
    const deployJson = buildDeployJson({ ...wizardDeployment, projectName });
    if (deployJson) {
      writeFileSync(join(targetPath, 'conductor', 'deploy.json'), JSON.stringify(deployJson, null, 2) + '\n');
      writeFileSync(join(targetPath, 'conductor', 'deployment-stack.md'), buildDeploymentStackMd({ ...wizardDeployment, projectName }));
      const envExample = buildEnvExample({ provider: wizardDeployment.provider });
      if (envExample) writeFileSync(join(targetPath, '.env.example'), envExample);
    }
  }

  // Track AM-1119 Phase 3 (Task 1-3, REQ-3): generate the initial track
  // breakdown from the wizard's own product/deployment answers, via the
  // SAME file_sync_queue.md protocol `/laneconductor newTrack` uses —
  // folder written directly (for immediate visibility) plus a queue entry
  // appended (so the normal processFileSyncQueue()/handleTrackCreate()
  // path registers each one in the DB on the next cycle, same as any
  // other track). Every generated track carries `**Auto Run**: yes` so a
  // sync+poll worker claims it with no human dragging. Skipped for legacy
  // Quick create dispatches (no `wizard` key at all) — deriveTrackPlan
  // still runs for a wizard dispatch with an empty product step, since it
  // always yields at least an "App Skeleton" track.
  const generatedTracks = entry.payload?.wizard
    ? writeGeneratedTracks({
        targetPath,
        projectName: scaffoldContext.project?.name || basename(targetPath),
        brainstormSummary: scaffoldContext.brainstorm_summary,
        deploymentProvider: wizardDeployment?.provider,
      })
    : [];

  // Sensible-default .laneconductor.json for the new project — same
  // mode/collector URLs/UI port as this manager's own, so it joins the
  // same LaneConductor instance rather than needing separate onboarding.
  // Deliberately strips machine_token from each collector entry: that's
  // this manager's own resolved auth credential (added to its config by
  // its own upsertWorker() after registering) — the new project's worker
  // must register fresh and get its own, not start out authenticating as
  // the manager.
  const proj = getProject();
  const newConfig = {
    mode: config.mode,
    project: {
      name: scaffoldContext.project?.name || basename(targetPath),
      repo_path: targetPath,
      primary: proj.primary || { cli: 'claude' },
    },
    collectors: (config.collectors || []).map(c => ({ url: c.url, token: c.token ?? null })),
    ui: config.ui || { port: 8090 },
  };
  writeFileSync(join(targetPath, '.laneconductor.json'), JSON.stringify(newConfig, null, 2) + '\n');

  // Track 1102 F7: the project must be a git repo with at least one commit
  // before any lane action can run — spawnCli takes a git lock and runs
  // `git worktree add -B <branch> <path> HEAD` for every action. Without
  // this, the very first plan dies with "not a git repository" and the
  // project is one where nothing can ever run (found live 2026-08-12).
  //
  // The initial commit is NOT optional: on a repo with no commits,
  // `git worktree add ... HEAD` fails with "fatal: invalid reference:
  // HEAD" (verified directly, not assumed). A `git init` alone would move
  // the failure rather than fix it.
  //
  // Skipped when the target is already a repo — `repo_source.type: 'git'`
  // clones arrive with history, and an existing local path may be a repo
  // the user cares about. Never re-initialises or commits over one.
  // DELIBERATELY NARROW: only auto-init when this directory contains
  // nothing but the scaffold we just wrote. `git add -A` on a directory
  // the user pointed at could commit node_modules, .env files, build
  // artifacts and secrets into a brand-new history — with no .gitignore
  // yet to stop it. That's not ours to decide silently, and committing a
  // secret is not cheaply undone. If there's pre-existing content, say so
  // and let the user run git init themselves.
  // `.env.example` (Track AM-1119 Phase 2, Task 3) is explicitly safe to
  // allowlist here despite that warning: it's a template of variable
  // NAMES only, written by us above from buildEnvExample(), never actual
  // secret values — unlike `.env` itself, which stays excluded.
  const SCAFFOLD_ENTRIES = new Set(['.laneconductor.json', 'conductor', '.claude', '.agents', '.git', '.env.example']);
  try {
    const isRepo = existsSync(join(targetPath, '.git'));
    if (!isRepo) {
      const preExisting = readdirSync(targetPath).filter(e => !SCAFFOLD_ENTRIES.has(e));
      if (preExisting.length > 0) {
        return {
          ok: false,
          error: `Scaffolded ${targetPath}, but it is not a git repository and already contains other files `
            + `(${preExisting.slice(0, 5).join(', ')}${preExisting.length > 5 ? ', …' : ''}). `
            + `Lane actions need a git repo with at least one commit. Refusing to \`git add -A\` here — `
            + `that could commit secrets or build output. Run \`git init && git add … && git commit\` in that `
            + `directory yourself (with a .gitignore), then retry.`,
        };
      }
      execSync('git init -q', { cwd: targetPath, stdio: 'pipe' });
      execSync('git add -A', { cwd: targetPath, stdio: 'pipe' });
      // -c user.* so this works on machines with no global git identity;
      // this is a setup step, not an authored change.
      execSync(
        'git -c user.email=laneconductor@localhost -c user.name=LaneConductor ' +
        'commit -q -m "chore: initial LaneConductor project scaffold"',
        { cwd: targetPath, stdio: 'pipe' }
      );
      logger.info({ targetPath }, '[create-project] Initialised git repo with initial commit');
    }
  } catch (err) {
    // Report rather than silently producing a project that can't run
    // anything — that silence is exactly what made F7 hard to spot.
    return { ok: false, error: `Scaffolded ${targetPath} but git init failed: ${err.stderr?.toString().trim() || err.message}. Lane actions require a git repo with a commit.` };
  }

  // `lc worker start` there — reuses the full CLI wrapper (pidfile,
  // logging, resolveSyncScript's canonical-vs-local fallback) rather than
  // re-implementing any of that inline; it self-registers on startup via
  // its own normal upsertWorker() call, same as every other project.
  spawn('lc', ['worker', 'start'], { cwd: targetPath, detached: true, stdio: 'ignore' }).unref();

  return { ok: true, targetPath, generatedTracks };
}

// Track 1091 Phase 7: manager-only sweep for laneconductor.sync.mjs
// processes on this host that aren't any currently-registered worker —
// see orphan-worker-detection.mjs's doc comment for the incident that
// motivated this (18 leftover test-harness processes, none registered,
// 3 spinning at ~80% CPU for 13+ hours against a deleted cwd).
//
// Grace period default: long enough that no real test run (seconds to a
// few minutes) or freshly-spawned real worker (registers within one
// heartbeat interval, ~10s) is ever mistaken for an orphan.
const ORPHAN_WORKER_GRACE_MS = 30 * 60 * 1000;

async function reapOrphanedWorkerProcesses() {
  if (!isManager) return;
  const { url, token } = primaryCollector();
  if (!url) return;

  let rows;
  try {
    const psOutput = execSync('ps -eo pid,etimes,args --no-headers', { encoding: 'utf8' });
    rows = parsePsWorkerRows(psOutput);
  } catch (err) {
    logger.warn({ err: err.message }, '[orphan-reap] Failed to list local processes (skipping this cycle)');
    return;
  }

  let workers;
  try {
    workers = await get(url, token, '/api/workers');
  } catch (err) {
    logger.warn({ err: err.message }, '[orphan-reap] Failed to fetch registered workers (skipping this cycle)');
    return;
  }

  const registeredPids = new Set(
    workers.filter(w => w.hostname === hostname && w.pid).map(w => Number(w.pid))
  );

  const orphans = findOrphanedWorkerProcesses(rows, {
    registeredPids,
    selfPid: process.pid,
    graceMs: ORPHAN_WORKER_GRACE_MS,
  });

  for (const orphan of orphans) {
    logger.warn(
      { pid: orphan.pid, ageMinutes: Math.round(orphan.ageMs / 60000), cmd: orphan.cmd },
      `[orphan-reap] Killing unregistered laneconductor.sync.mjs process (pid ${orphan.pid}, ${Math.round(orphan.ageMs / 60000)}m old, not in this host's registered worker set)`
    );
    try {
      process.kill(orphan.pid, 'SIGTERM');
    } catch (err) {
      logger.warn({ pid: orphan.pid, err: err.message }, '[orphan-reap] Failed to kill orphaned process');
    }
  }
}

// Track 1110 Phase 6: runs once, right after this process's first
// successful registration. Reconciles dispatches THIS worker claimed but
// never reported an outcome for — the class of bug where the sync worker
// process restarts while a dispatch's spawned CLI child is still running,
// orphaning the in-memory `on('exit')` listener that would normally
// finalize it. The child keeps running independently and finishes on its
// own; nothing else ever notices. Detection reads the WORKTREE's own
// index.md `**Lane Status**` marker (written by the agent doing the actual
// lane work, independent of whether the wrapping exit-handler machinery
// ever runs) rather than a specific commit shape — an earlier version of
// this fix looked for the exit handler's own completion commit, which is
// wrong: that commit is written BY the exit handler, the exact code that
// never runs in this bug. Same semantics as reconcileActiveDispatch()'s
// existing in-memory-only version of this idea, sourced from a
// DB-persisted `claimed` dispatch instead of a Map that doesn't survive a
// restart.
async function reconcileOrphanedDispatches() {
  if (getIsLocalFs() || !myWorkerId) return;
  const { url, token } = primaryCollector();
  if (!url) return;

  let entries;
  try {
    ({ entries } = await get(url, token, `/worker/${myWorkerId}/dispatch/claimed`));
  } catch (err) {
    console.warn(`[orphan-reconcile] Failed to fetch claimed dispatches: ${err.message}`);
    return;
  }
  if (!entries || entries.length === 0) return;

  for (const entry of entries) {
    const trackNumber = entry.track_number;
    if (!trackNumber) continue; // not track-scoped (e.g. refresh-worktrees) — nothing to reconcile from
    const worktreePath = join(process.cwd(), '.worktrees', String(trackNumber));
    if (!existsSync(worktreePath)) continue; // no worktree left to check — genuinely nothing recoverable here

    const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
    const wtTrackDir = existsSync(wtTracksDir) ? resolveTrackFolder(wtTracksDir, trackNumber) : null;
    const wtIndexPath = wtTrackDir ? join(wtTracksDir, wtTrackDir, 'index.md') : null;
    if (!wtIndexPath || !existsSync(wtIndexPath)) continue;

    const wtIndexContent = readFileSync(wtIndexPath, 'utf8');
    const laneStatus = wtIndexContent.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1];
    const wtLane = wtIndexContent.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1];
    const classification = classifyOrphanedDispatch({ laneStatus, lane: wtLane, action: entry.action, workflowConfig });
    if (!classification.orphaned) continue; // still genuinely "running", or nothing to go on yet

    console.warn(`[orphan-reconcile] Dispatch ${entry.id} (track ${trackNumber}, action ${entry.action}) finished after a worker restart orphaned it — worktree's own Lane Status reads "${laneStatus}"`);

    // A lane/action mismatch means the worktree's markers belong to a
    // phase EARLIER than the one this dispatch was for — copying/syncing
    // them would regress the primary's already-more-advanced lane_status
    // back to that stale snapshot (see classifyOrphanedDispatch's own
    // comment). Only copy artifacts back when the worktree's own state
    // genuinely reflects this dispatch's action having run.
    if (!classification.skipArtifactCopy) {
      const isSuccess = classification.status === 'done';
      const { copied, destDir } = copyWorktreeArtifactsToPrimary({
        worktreePath, trackNumber, isSuccess, primaryRoot: process.cwd(), resolveTrackFolder,
      });
      if (copied.length) {
        console.log(`[orphan-reconcile] Copied artifacts to main repo: ${copied.join(', ')}`);
        const indexPath = join(destDir, 'index.md');
        if (existsSync(indexPath)) {
          await syncTrack(indexPath).catch(e => console.warn(`[orphan-reconcile] Failed to sync artifacts to DB: ${e.message}`));
        }
      }
    } else {
      console.warn(`[orphan-reconcile] Skipping artifact copy for track ${trackNumber} — worktree lane "${wtLane}" doesn't match dispatched action "${entry.action}"; leaving the primary's own state untouched`);
      // Track 1117 Bug 2 (REQ-4): a mismatch that ISN'T a recognized
      // workflow.json transition is a genuine anomaly, not routine — surface
      // it to a human rather than letting it sit as a console-only warning.
      if (classification.flagForHuman) {
        try {
          const tracksDir = 'conductor/tracks';
          const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
          if (trackDirName) {
            appendFileSync(
              join(tracksDir, trackDirName, 'conversation.md'),
              `\n> **system**: ⚠️ Orphan-reconcile skipped artifact copy for this dispatch — worktree lane "${wtLane}" doesn't match dispatched action "${entry.action}" and isn't a recognized workflow.json transition. Please review the worktree manually.\n`,
            );
          }
        } catch (err) {
          console.warn(`[orphan-reconcile] Failed to post mismatch flag to conversation.md: ${err.message}`);
        }
      }
    }

    await patch(url, token, `/worker-dispatch/${entry.id}`, {
      status: classification.status,
      result: classification.result || `Reconciled after worker restart orphaned this dispatch — worktree's own Lane Status: "${laneStatus}"`,
    }).catch(err => console.warn(`[orphan-reconcile] Failed to update dispatch ${entry.id}: ${err.message}`));
  }
}

async function checkDispatchInbox() {
  if (getIsLocalFs() || !myWorkerId) return;
  const { url, token } = primaryCollector();
  if (!url) return;

  let entries;
  try {
    ({ entries } = await get(url, token, `/worker/${myWorkerId}/dispatch`));
  } catch (err) {
    console.warn(`[dispatch] Failed to fetch inbox (skipping this cycle): ${err.message}`);
    return;
  }
  if (!entries || entries.length === 0) return;

  for (const entry of entries) {
    // Track 1113 Phase 3 (REQ-6): a chat turn and a lane action for the same
    // track would otherwise run as two concurrent CLI processes against one
    // worktree — checkDispatchInbox's interval is fully independent of the
    // lane-action loop. Leave the entry `pending` (do NOT claim) so a later
    // cycle picks it up once the lane action's process has exited.
    if (entry.action === 'track_chat') {
      const pendingTrack = entry.payload?.track_number ?? entry.track_number ?? null;
      if (pendingTrack && activeDispatch.has(String(pendingTrack))) {
        logger.info({ dispatchId: entry.id, trackNumber: pendingTrack },
          '[dispatch] Deferring chat turn — lane action still in flight for this track');
        continue;
      }
    }

    try {
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'claimed' });
    } catch (err) {
      console.warn(`[dispatch] Failed to claim dispatch ${entry.id}: ${err.message}`);
      continue;
    }

    if (entry.action === 'build' || entry.action === 'build_and_deploy') {
      console.log(`[dispatch] Triggering worker build artifact creation (dispatch ${entry.id})`);
      updateWorkerHeartbeat('busy', `building release artifact (dispatch ${entry.id})`);
      
      let buildArtifact = null;
      let buildErr = null;
      try {
        buildArtifact = createBuildArtifact(process.cwd(), {
          createdBy: entry.payload?.createdBy || 'Worker Dispatch',
          trackIds: entry.payload?.trackIds
        });
        console.log(`[dispatch] Created build artifact: ${buildArtifact.id}`);
      } catch (err) {
        buildErr = err.message;
        console.error(`[dispatch] Build artifact creation failed: ${err.message}`);
      }

      if (entry.action === 'build') {
        updateWorkerHeartbeat('idle', null);
        await patch(url, token, `/worker-dispatch/${entry.id}`, {
          status: buildArtifact ? 'done' : 'failed',
          result: buildArtifact ? `Build ${buildArtifact.id} created` : `Build failed: ${buildErr}`
        }).catch(err => console.warn(`[dispatch] Failed to report build result for ${entry.id}: ${err.message}`));
        continue;
      }

      // If action is build_and_deploy
      if (!buildArtifact) {
        updateWorkerHeartbeat('idle', null);
        await patch(url, token, `/worker-dispatch/${entry.id}`, {
          status: 'failed',
          result: `Build step failed: ${buildErr}`
        }).catch(err => console.warn(`[dispatch] Failed to report build_and_deploy result for ${entry.id}: ${err.message}`));
        continue;
      }

      const env = entry.payload?.environment || 'prod';
      const extraEnv = {
        CONDUCTOR_BUILD_ID: buildArtifact.id,
        CONDUCTOR_BUILD_COMMIT: buildArtifact.git?.commit || '',
        CONDUCTOR_BUILD_TRACKS: (buildArtifact.tracks || []).join(',')
      };

      console.log(`[dispatch] Running deploy to ${env} with build ${buildArtifact.id} (dispatch ${entry.id})`);
      updateWorkerHeartbeat('busy', `deploying ${buildArtifact.id} to ${env} (dispatch ${entry.id})`);
      const result = await runDeploy(process.cwd(), env, { extraEnv });
      updateWorkerHeartbeat('idle', null);

      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.ok ? 'done' : 'failed',
        result: result.ok ? `Built & deployed ${buildArtifact.id}` : (result.error || `exit ${result.exitCode} at step: ${result.failedStep}`),
      }).catch(err => console.warn(`[dispatch] Failed to report deploy result for ${entry.id}: ${err.message}`));
      continue;
    }

    if (entry.action === 'deploy') {
      const env = entry.payload?.environment || 'prod';
      const buildId = entry.payload?.buildId || entry.payload?.build_id;
      let extraEnv = {};
      if (buildId) {
        const build = getBuildById(process.cwd(), buildId);
        if (build) {
          extraEnv = {
            CONDUCTOR_BUILD_ID: build.id,
            CONDUCTOR_BUILD_COMMIT: build.git?.commit || '',
            CONDUCTOR_BUILD_TRACKS: (build.tracks || []).join(',')
          };
          logger.info({ dispatchId: entry.id, buildId }, `[dispatch] Build artifact ${buildId} attached (commit ${build.git?.shortCommit || 'unknown'})`);
        } else {
          logger.warn({ dispatchId: entry.id, buildId }, `[dispatch] Build artifact ${buildId} not found, proceeding with workspace HEAD`);
        }
      }
      logger.info({ dispatchId: entry.id, env, buildId }, `[dispatch] Running deploy to ${env}${buildId ? ` (${buildId})` : ''}`);
      // Track 1087 Phase 6 Task 3: deploy never went through spawnCli, so
      // the worker never reported busy for it — WorkerActivityLatch had
      // nothing to detect. current_task format ("deploy <env> (dispatch
      // <id>)") is parsed by ui/src/lib/workerTaskInfo.js.
      updateWorkerHeartbeat('busy', `deploy ${env}${buildId ? ` (${buildId})` : ''} (dispatch ${entry.id})`);
      const result = await runDeploy(process.cwd(), env, { extraEnv });
      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.ok ? 'done' : 'failed',
        result: result.ok ? null : (result.error || `exit ${result.exitCode} at step: ${result.failedStep}`),
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report deploy result'));
      continue;
    }

    // Track 1112 Phase 7 (D-7): the "Merge to main" button's target — a
    // pure git operation with no LLM context needed, but still routed
    // through the assignee's own worker (the API resolves worker_id via
    // 1084's resolveAssignee/resolvePinnedWorkers before creating this
    // dispatch entry) so it's consistent with every other track-scoped
    // dispatch. Calls Phase 4's shared mergeWorktreeBranch() primitive —
    // no second copy of the merge logic.
    if (entry.action === 'merge-worktree') {
      const trackNumber = entry.payload?.track_number;
      const force = entry.payload?.force === true;
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, `[dispatch] merge-worktree track ${trackNumber}`);
      updateWorkerHeartbeat('busy', `merge-worktree track ${trackNumber} (dispatch ${entry.id})`);

      const mainBranch = getMainBranch();
      let result;
      let forcedDoneWithoutChecks = false;
      try {
        const rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch });
        const row = rows.find(r => r.trackNumber === String(trackNumber));
        const isDoneSuccess = row?.lane === 'done' && row?.laneStatus === 'success';
        if (!row) {
          result = { merged: false, reason: 'not-found' };
        } else if (!isDoneSuccess && !force) {
          result = { merged: false, reason: 'not-done-success' };
        } else {
          // Track 1114 (explicit request — "not recommended, but allow
          // it"): force on a track that hasn't actually reached
          // done:success also marks it done:success first, on the
          // BRANCH itself, before merging — otherwise the code lands in
          // main while the board still shows "review"/"implement", a
          // confusing split state where the merge silently happened but
          // the card looks untouched. Only handles the case where a
          // worktree is actually checked out (the realistic case for
          // in-progress work); if none exists, falls through to a plain
          // git-only force merge exactly like before, with the branch's
          // own lane state left as-is.
          if (!isDoneSuccess && force && row.hasWorktree && row.worktreePath) {
            const wtIndexPath = join(row.worktreePath, 'conductor', 'tracks', resolveTrackFolder(join(row.worktreePath, 'conductor', 'tracks'), trackNumber) || '', 'index.md');
            if (existsSync(wtIndexPath)) {
              const wtContent = readFileSync(wtIndexPath, 'utf8');
              const updateHeader = (c, h, v) => {
                const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
                return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
              };
              let updated = updateHeader(wtContent, 'Lane', 'done');
              updated = updateHeader(updated, 'Lane Status', 'success');
              writeFileSync(wtIndexPath, updated, 'utf8');
              try {
                gitExec(`git add "${wtIndexPath}"`, row.worktreePath);
                gitExec(`git commit -m "Track ${trackNumber}: force-marked done:success (review/quality-gate skipped)"`, row.worktreePath);
                forcedDoneWithoutChecks = true;
              } catch (commitErr) {
                logger.warn({ dispatchId: entry.id, trackNumber, err: commitErr.message }, '[dispatch] force-merge: failed to commit done:success marker');
              }
            }
          }
          result = await mergeWorktreeBranch({ repoRoot: process.cwd(), trackNumber: String(trackNumber), mainBranch });
          if (result.merged && forcedDoneWithoutChecks) {
            await patch(url, token, `/track/${trackNumber}/action`, {
              project_id: (getProject())?.id, lane_status: 'done', lane_action_status: 'success', progress_percent: 100,
            }).catch(err => logger.warn({ dispatchId: entry.id, trackNumber, err: err.message }, '[dispatch] force-merge: failed to sync done:success to DB'));
          }
        }
      } catch (err) {
        result = { merged: false, reason: 'error', error: err.message };
      }
      updateWorkerHeartbeat('idle', null);

      const resultText = result.merged
        ? `Merged track-${trackNumber} into ${mainBranch} (${result.mergeCommit})${forcedDoneWithoutChecks ? ' — ⚠️ forced done:success without running review/quality-gate' : ''}`
        : `Not merged: ${result.reason}${result.conflictPaths?.length ? ` (${result.conflictPaths.join(', ')})` : ''}${result.error ? `: ${result.error}` : ''}`;

      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.merged ? 'done' : 'failed',
        result: resultText,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report merge-worktree result'));

      try {
        const tracksDir = join(process.cwd(), 'conductor/tracks');
        const trackDirName = resolveTrackFolder(tracksDir, String(trackNumber));
        if (trackDirName) {
          appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
        }
      } catch (err) {
        logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to post merge-worktree conversation comment');
      }
      continue;
    }

    // Track 10018: the Worktrees panel's "Create PR" button — the rescue
    // path for a pr-mode track that's already done:success (via
    // auditWorktrees, same precondition style as merge-worktree above) but
    // has no PR yet (e.g. openTrackPrOnDone's own gh-auth/push failure, or
    // a stranded branch someone wants under PR review after the fact).
    // Reuses openTrackPrOnDone directly — no second copy of the PR-opening
    // logic.
    if (entry.action === 'create-pr') {
      const trackNumber = entry.payload?.track_number;
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, `[dispatch] create-pr track ${trackNumber}`);
      updateWorkerHeartbeat('busy', `create-pr track ${trackNumber} (dispatch ${entry.id})`);

      let resultText;
      try {
        const rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch: getMainBranch() });
        const row = rows.find(r => r.trackNumber === String(trackNumber));
        if (!row || !row.hasWorktree) {
          resultText = 'Not opened: no live worktree found for this track';
        } else if (row.lane !== 'done' || row.laneStatus !== 'success') {
          resultText = `Not opened: track is at ${row.lane || '?'}:${row.laneStatus || '?'}, not done:success`;
        } else if (row.prNumber) {
          resultText = `PR #${row.prNumber} already exists — nothing to do`;
        } else {
          await openTrackPrOnDone(trackNumber, row.worktreePath);
          resultText = 'PR create dispatched — see track conversation for the result';
        }
      } catch (err) {
        resultText = `Error: ${err.message}`;
      }
      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'done', result: resultText })
        .catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report create-pr result'));
      continue;
    }

    // Track 10018: the Worktrees panel's "Merge PR" button — merges
    // through GitHub (never a local git merge), so branch protection and
    // required checks stay authoritative. Actual local cleanup (worktree
    // removal, branch deletion, lane transition bookkeeping) happens on
    // reconcilePrTracks()'s next poll once GitHub reports the merge, same
    // as a merge done directly in the GitHub UI — this handler's only job
    // is to trigger it.
    if (entry.action === 'merge-pr') {
      const trackNumber = entry.payload?.track_number;
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, `[dispatch] merge-pr track ${trackNumber}`);
      updateWorkerHeartbeat('busy', `merge-pr track ${trackNumber} (dispatch ${entry.id})`);

      let resultText;
      try {
        const rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch: getMainBranch() });
        const row = rows.find(r => r.trackNumber === String(trackNumber));
        if (!row?.prNumber) {
          resultText = 'Not merged: no open PR number recorded for this track';
        } else {
          mergeTrackPr({ repoRoot: resolvePrimaryRepoRoot(process.cwd()), prNumber: parseInt(row.prNumber, 10) });
          resultText = `Merge requested for PR #${row.prNumber} — GitHub will process it; cleanup follows on the next reconcile pass`;
        }
      } catch (err) {
        resultText = `Error: ${err.message}`;
      }
      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: resultText.startsWith('Error') || resultText.startsWith('Not merged') ? 'failed' : 'done', result: resultText })
        .catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report merge-pr result'));

      // Found live (track 1119): unlike merge-worktree/ai-resolve-conflict,
      // this handler never posted a conversation comment — the dispatch
      // row's own status/result isn't surfaced anywhere the Kanban card
      // reads from, so a real failure (e.g. GitHub reports the PR as
      // CONFLICTING) was completely invisible: the button just reverted to
      // "Merge PR" with nothing to explain why, indistinguishable from the
      // click not having registered at all.
      try {
        const tracksDir = join(process.cwd(), 'conductor/tracks');
        const trackDirName = resolveTrackFolder(tracksDir, String(trackNumber));
        if (trackDirName) {
          appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
        }
      } catch (err) {
        logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to post merge-pr conversation comment');
      }
      continue;
    }

    // Track 1114: "Remove Worktree" for detached/orphaned scratch
    // worktrees the panel had no cleanup path for. Deliberately only
    // discards the worktree's own uncommitted changes (`git worktree
    // remove --force`) — does not touch the branch/commits, which stay
    // recoverable. Re-audits and matches against the CURRENT real worktree
    // list rather than trusting the client-supplied path directly, so a
    // stale or malformed payload can't be used to force-remove an
    // arbitrary directory.
    if (entry.action === 'remove-worktree') {
      const branch = entry.payload?.branch || null;
      const requestedPath = entry.payload?.worktree_path || null;
      if (!branch && !requestedPath) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.branch or payload.worktree_path is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, branch, requestedPath }, '[dispatch] remove-worktree');
      updateWorkerHeartbeat('busy', `remove-worktree (dispatch ${entry.id})`);

      let result;
      try {
        const rows = await auditWorktrees({ repoRoot: process.cwd(), mainBranch: getMainBranch() });
        const row = rows.find(r => r.hasWorktree && (
          (branch && r.branch === branch) || (requestedPath && r.worktreePath === requestedPath)
        ));
        if (!row) {
          result = { removed: false, reason: 'not-found — no live worktree matches that branch/path' };
        } else {
          gitExec(`git worktree remove --force "${row.worktreePath}"`, process.cwd());
          result = { removed: true, path: row.worktreePath, branch: row.branch };
        }
      } catch (err) {
        result = { removed: false, reason: 'error', error: err.message };
      }
      updateWorkerHeartbeat('idle', null);

      const resultText = result.removed
        ? `Removed worktree ${result.path} (${result.branch || 'no branch'})`
        : `Not removed: ${result.reason}${result.error ? `: ${result.error}` : ''}`;

      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.removed ? 'done' : 'failed',
        result: resultText,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report remove-worktree result'));
      continue;
    }

    // Track 10015 Phase 1: refresh-worktrees is never track-scoped (the
    // enqueue side, ui/server/index.mjs:3415, deliberately doesn't
    // require a track_number for it) — but with no dedicated branch here
    // it fell through to the generic "Lane action dispatch" fallback
    // below, which unconditionally requires one and failed every single
    // time with "missing track_number" (confirmed live: 7 consecutive
    // real dispatches). Forces an immediate re-audit instead of waiting
    // for refreshWorktreeSummaryCache()'s own 60s interval.
    if (entry.action === 'refresh-worktrees') {
      logger.info({ dispatchId: entry.id }, '[dispatch] refresh-worktrees');
      updateWorkerHeartbeat('busy', `refresh-worktrees (dispatch ${entry.id})`);
      let status, result;
      try {
        await refreshWorktreeSummaryCache();
        status = 'done';
        result = 'Worktree cache refreshed';
      } catch (err) {
        status = 'failed';
        result = err.message;
      }
      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status, result })
        .catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report refresh-worktrees result'));
      continue;
    }

    // Track 1114 Phase 15: "Discard" — a track whose worktree is never
    // going to be merged (a product decision changed, e.g. dropping a
    // PayPal-integration track after moving to a different provider).
    // Removes the worktree exactly like Remove Worktree (branch/commits
    // stay recoverable) and moves the track's Lane to `backlog` with an
    // explicit note, so the board stops showing it as active work
    // awaiting its turn. Deliberately NEVER writes done:success — that
    // would misrepresent abandoned work as shipped and risk being merged
    // by something else (Complete & Merge, Force Merge) later.
    if (entry.action === 'discard-track') {
      const trackNumber = entry.payload?.track_number;
      const reason = (entry.payload?.reason && String(entry.payload.reason).trim()) || 'Discarded via Worktrees panel — not merging.';
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, `[dispatch] discard-track ${trackNumber}`);
      updateWorkerHeartbeat('busy', `discard-track ${trackNumber} (dispatch ${entry.id})`);

      const repoRoot = resolvePrimaryRepoRoot(process.cwd());
      let result;
      try {
        const rows = await auditWorktrees({ repoRoot, mainBranch: getMainBranch() });
        const row = rows.find(r => r.trackNumber === String(trackNumber));

        let removedWorktree = false;
        if (row?.hasWorktree && row.worktreePath) {
          gitExec(`git worktree remove --force "${row.worktreePath}"`, repoRoot);
          removedWorktree = true;
        }

        const tracksDir = join(repoRoot, 'conductor', 'tracks');
        const trackDirName = resolveTrackFolder(tracksDir, String(trackNumber));
        if (!trackDirName) {
          result = { discarded: false, reason: 'track-not-found' };
        } else {
          const indexPath = join(tracksDir, trackDirName, 'index.md');
          const content = readFileSync(indexPath, 'utf8');
          const updateHeader = (c, h, v) => {
            const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
            return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
          };
          let updated = updateHeader(content, 'Lane', 'backlog');
          updated = updateHeader(updated, 'Lane Status', 'queue');
          updated = updateHeader(updated, 'Summary', reason);
          writeFileSync(indexPath, updated, 'utf8');
          gitExec(`git add "${indexPath}"`, repoRoot);
          gitExec(`git commit -m "Track ${trackNumber}: discarded (${reason})" --quiet`, repoRoot);

          await patch(url, token, `/track/${trackNumber}/action`, {
            project_id: (getProject())?.id, lane_status: 'backlog', lane_action_status: 'queue',
          }).catch(err => logger.warn({ dispatchId: entry.id, trackNumber, err: err.message }, '[dispatch] discard-track: failed to sync backlog lane to DB'));

          result = { discarded: true, removedWorktree, branch: row?.branch ?? `track-${trackNumber}` };
        }
      } catch (err) {
        result = { discarded: false, reason: 'error', error: err.message };
      }
      updateWorkerHeartbeat('idle', null);

      const resultText = result.discarded
        ? `Discarded track ${trackNumber}${result.removedWorktree ? ' (worktree removed, branch kept)' : ' (no live worktree)'} — moved to backlog, not merged`
        : `Not discarded: ${result.reason}${result.error ? `: ${result.error}` : ''}`;

      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.discarded ? 'done' : 'failed',
        result: resultText,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report discard-track result'));

      try {
        const tracksDir = join(repoRoot, 'conductor', 'tracks');
        const trackDirName = resolveTrackFolder(tracksDir, String(trackNumber));
        if (trackDirName) {
          appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
        }
      } catch (err) {
        logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to post discard-track conversation comment');
      }
      continue;
    }

    // Track 1114 Phase 18b: "AI resolve conflict" — for `conflicted` rows
    // Phase 17's bookkeeping-only auto-resolve doesn't cover (a real
    // content conflict). Deliberately NOT built on spawnCli — that
    // machinery is lane-workflow-shaped (creates its own worktree, moves
    // Lane/Lane Status through workflow.json, git-locks) and this is a
    // one-off remediation, not a lane. Runs a REAL `git merge` (not the
    // dry-run `merge-tree` check auditWorktrees uses for classification)
    // directly in the track's existing worktree, spawns a scoped one-shot
    // Claude session to resolve the resulting conflict markers (same raw
    // spawn pattern as the `track_chat`/`worker_adhoc_chat` handler
    // above — a single prompt/response turn, no lane semantics), then
    // verifies nothing is left unresolved before ever committing anything.
    // Explicitly conservative: if verification doesn't clearly show a
    // clean, agent-staged resolution, this aborts the merge and reports
    // failure rather than guessing — same philosophy as
    // mergeWorktreeBranch's own "never call it mergeable without
    // positively confirming a clean merge."
    if (entry.action === 'ai-resolve-conflict') {
      const trackNumber = entry.payload?.track_number;
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, `[dispatch] ai-resolve-conflict ${trackNumber}`);
      updateWorkerHeartbeat('busy', `ai-resolve-conflict ${trackNumber} (dispatch ${entry.id})`);

      const repoRoot = resolvePrimaryRepoRoot(process.cwd());
      const mainBranch = getMainBranch();
      let result;
      try {
        const rows = await auditWorktrees({ repoRoot, mainBranch });
        const row = rows.find(r => r.trackNumber === String(trackNumber));

        if (!row?.hasWorktree || !row.worktreePath) {
          result = { resolved: false, reason: 'no-worktree — a live worktree is required to run the merge in' };
        } else {
          const worktreePath = row.worktreePath;
          let hadConflict = false;
          try {
            gitExec(`git merge "${mainBranch}" --no-edit`, worktreePath);
          } catch (mergeErr) {
            hadConflict = true; // `git merge` exits non-zero when it leaves real conflict markers
          }

          if (!hadConflict) {
            // State moved on since classification (e.g. someone else already
            // fixed it) — merged cleanly with no AI involvement needed.
            const mergeResult = await mergeWorktreeBranch({ repoRoot, trackNumber: String(trackNumber), mainBranch });
            result = { resolved: true, aiInvolved: false, merged: mergeResult.merged, mergeCommit: mergeResult.mergeCommit };
          } else {
            const prompt = `You are resolving a real git merge conflict. The current directory is a git worktree mid-merge (\`git merge ${mainBranch}\` was just run and produced conflicts). Run \`git status\` to see which files conflict. Open each one, resolve the conflict markers by understanding BOTH sides' intent — this branch's own changes AND ${mainBranch}'s changes — do not blindly prefer one side. Do not drop functionality from either side unless it is genuinely redundant or superseded. Once every file is resolved, stage them with \`git add\`. Do NOT run \`git commit\` yourself — leave the merge staged; a separate step finalizes it. If you cannot confidently resolve a conflict, leave it unresolved (unstaged) and say why in your final message instead of guessing.`;

            const { stdout: agentOutput } = await new Promise((resolvePromise) => {
              const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], { cwd: worktreePath, stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '';
              proc.stdout.on('data', d => { out += d.toString(); });
              proc.stderr.on('data', d => { out += d.toString(); });
              proc.on('exit', () => resolvePromise({ stdout: out }));
              proc.on('error', e => resolvePromise({ stdout: e.message }));
            });

            // A linked worktree's `.git` is a FILE pointing at the real
            // gitdir (`.git/worktrees/<name>/`), not a directory — joining
            // `worktreePath, '.git', 'MERGE_HEAD'` directly resolves to a
            // path that can never exist, silently reporting "no merge in
            // progress" even when one genuinely is (found live verifying
            // this very fixture: a real agent-resolved merge would have
            // been misreported as failed). `git rev-parse` resolves refs
            // correctly from any worktree's cwd regardless of this layout.
            let mergeHeadExists = true;
            try { gitExec('git rev-parse -q --verify MERGE_HEAD', worktreePath); } catch { mergeHeadExists = false; }
            const statusLines = gitExec('git status --porcelain', worktreePath).toString().split('\n').filter(Boolean);
            const stillUnmerged = statusLines.some(l => /^(UU|AA|DD|AU|UA|UD|DU) /.test(l));

            if (!mergeHeadExists || stillUnmerged) {
              // Either the agent committed/aborted on its own (unexpected —
              // instructed not to) or real conflicts remain either way, too
              // ambiguous to trust silently. Abort if a merge is still
              // genuinely in progress; otherwise leave state as the agent
              // left it for a human to inspect.
              if (mergeHeadExists) gitExec('git merge --abort', worktreePath);
              result = { resolved: false, reason: stillUnmerged ? 'unresolved-conflicts-remain' : 'agent-did-not-leave-a-clean-staged-merge', agentOutput: agentOutput.slice(-2000) };
            } else {
              gitExec('git commit --no-edit', worktreePath);
              const mergeResult = await mergeWorktreeBranch({ repoRoot, trackNumber: String(trackNumber), mainBranch });
              result = mergeResult.merged
                ? { resolved: true, aiInvolved: true, merged: true, mergeCommit: mergeResult.mergeCommit }
                : { resolved: true, aiInvolved: true, merged: false, reason: mergeResult.reason, note: 'conflict resolved and committed on the branch, but the merge-into-main step itself failed — branch left in its resolved state for manual merge' };
            }
          }
        }
      } catch (err) {
        result = { resolved: false, reason: 'error', error: err.message };
      }
      updateWorkerHeartbeat('idle', null);

      const resultText = result.resolved
        ? (result.merged
          ? `AI-resolved and merged track-${trackNumber} into ${mainBranch}${result.aiInvolved ? '' : ' (no real conflict encountered)'} (${result.mergeCommit}) — review the merge commit`
          : `AI resolved the conflict on track-${trackNumber}'s branch, but merging into ${mainBranch} still failed: ${result.reason}`)
        : `Not resolved: ${result.reason}${result.error ? `: ${result.error}` : ''}`;

      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.resolved ? 'done' : 'failed',
        result: resultText,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report ai-resolve-conflict result'));

      try {
        const tracksDir = join(repoRoot, 'conductor', 'tracks');
        const trackDirName = resolveTrackFolder(tracksDir, String(trackNumber));
        if (trackDirName) {
          appendFileSync(join(tracksDir, trackDirName, 'conversation.md'), `\n> **system**: ${resultText}\n`);
        }
      } catch (err) {
        logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to post ai-resolve-conflict conversation comment');
      }
      continue;
    }

    // Track 1114: "Complete & Merge" — autopilot a track through its
    // remaining lane actions and merge once it reaches done:success.
    // Fire-and-forget the FIRST stage here (matching every other dispatch
    // in this loop — checkDispatchInbox must not block on a run that can
    // take 20-30+ minutes); reconcileAutoComplete (its own interval below)
    // detects each stage's completion and chains the next one.
    if (entry.action === 'auto-complete-track') {
      const trackNumber = entry.payload?.track_number || entry.track_number;
      if (!trackNumber) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'payload.track_number is required' }).catch(() => { });
        continue;
      }
      if (activeAutoComplete.has(trackNumber)) {
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: `An auto-complete sequence is already running for track ${trackNumber}` }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id, trackNumber }, '[dispatch] auto-complete-track started');
      updateWorkerHeartbeat('busy', `auto-complete-track ${trackNumber} (dispatch ${entry.id})`);
      await startNextAutoCompleteStage(trackNumber, entry.id, []);
      continue;
    }

    if (entry.action === 'create-project') {
      // Task 1: defense in depth — the API (Phase 1) already restricts
      // create-project dispatch creation to manager-type workers, but a
      // 'project'-type worker must never claim/execute one even if it
      // somehow ends up addressed to it.
      if (!isManager) {
        logger.warn({ dispatchId: entry.id }, `[dispatch] create-project requires a manager-type worker, this worker is type 'project' — refusing`);
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'worker is not type: manager' }).catch(() => { });
        continue;
      }
      logger.info({ dispatchId: entry.id }, `[dispatch] Running create-project`);
      updateWorkerHeartbeat('busy', `create-project (dispatch ${entry.id})`);
      const result = await runCreateProject(entry);
      updateWorkerHeartbeat('idle', null);
      // Track AM-1119 Phase 3 (Task 3): append the generated track list so
      // Phase 5's "follow your build" view (and, until it lands, anyone
      // polling GET /api/dispatch/:id) can see what was created without a
      // separate lookup. `Created at ${path}` prefix kept exactly as-is —
      // existing tests (track-1091-create-project-worker) match on it.
      const trackListSuffix = result.ok && result.generatedTracks?.length
        ? `\nGenerated tracks: ${result.generatedTracks.map(t => t.displayId).join(', ')}`
        : '';
      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.ok ? 'done' : 'failed',
        result: result.ok ? `Created at ${result.targetPath}${trackListSuffix}` : result.error,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report create-project result'));
      continue;
    }

    if (entry.action === 'set_model') {
      const { cli, model } = entry.payload || {};
      logger.info({ dispatchId: entry.id, cli, model }, `[dispatch] set_model cli=${cli}, model=${model}`);
      if (cli || model !== undefined) {
        if (!config.project) config.project = {};
        if (!config.project.primary) config.project.primary = { cli: 'claude', model: null };
        if (cli) config.project.primary.cli = cli;
        if (model !== undefined) config.project.primary.model = model;
        if (existsSync('.laneconductor.json')) {
          try {
            const current = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
            if (!current.project) current.project = {};
            if (!current.project.primary) current.project.primary = {};
            if (cli) current.project.primary.cli = cli;
            if (model !== undefined) current.project.primary.model = model;
            writeFileSync('.laneconductor.json', JSON.stringify(current, null, 2) + '\n');
          } catch (e) {
            logger.warn({ dispatchId: entry.id, err: e.message }, '[dispatch] set_model failed to write .laneconductor.json');
          }
        }
      }
      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: 'done',
        result: `Model updated to cli=${cli}, model=${model}`,
      }).catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report set_model result'));
      updateWorkerHeartbeat();
      continue;
    }

    // Track 1087 Phase 8: the Activity panel's chat bar. `worker_adhoc_chat`
    // has no track at all; `track_chat` is scoped to one. Both were being
    // created by the UI with no handler here at all, so they fell through
    // to the lane-action path below and died with "missing track_number" —
    // the chat bar could send, but never got a reply.
    //
    // Deliberately NOT routed through spawnCli: that path takes a git lock,
    // creates a worktree, and injects full track context, all of which are
    // meant for a lane action that will *edit the repo*. A chat turn is a
    // question, not a mutation — it shouldn't block the git lock or leave
    // worktrees behind.
    if (entry.action === 'worker_adhoc_chat' || entry.action === 'track_chat') {
      const prompt = entry.payload?.prompt;
      const chatTrack = entry.payload?.track_number ?? entry.track_number ?? null;
      const label = entry.action === 'track_chat' && chatTrack ? `chat track ${chatTrack}` : 'chat';

      if (!prompt || !String(prompt).trim()) {
        const reason = `${entry.action} requires a non-empty payload.prompt`;
        logger.warn({ dispatchId: entry.id }, `[dispatch] ${reason}`);
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: reason }).catch(() => { });
        continue;
      }

      logger.info({ dispatchId: entry.id, action: entry.action, chatTrack }, '[dispatch] Running chat turn');
      updateWorkerHeartbeat('busy', `${label} (dispatch ${entry.id})`);

      // Track 1113 Phase 3 (REQ-5): share the same track_sessions row a lane
      // action for this (track, worker) uses, so chat and lane actions carry
      // one conversation instead of the chat handler cold-starting every turn.
      // worker_adhoc_chat has no track and nothing to resume.
      const chatSession = entry.action === 'track_chat' && chatTrack
        ? await resolveTrackSession(chatTrack)
        : null;
      const resumingChat = !!chatSession && !chatSession.isFresh;
      const chatSessionArgs = chatSession
        ? [chatSession.isFresh ? '--session-id' : '--resume', chatSession.claude_session_id]
        : [];

      // For a track chat, give the model that track's own docs as context —
      // otherwise the question has nothing to ground itself in. On a resumed
      // session that context is already in the conversation, so re-injecting
      // it every turn is the exact waste REQ-5 exists to remove.
      //
      // Merge note (1111 → main): track-1111 branched before REQ-5's
      // `resumingChat` context-skip existed, so its patch unconditionally
      // recomputed context on every turn — that would have silently
      // reintroduced the exact waste REQ-5 removed. `chatTrackLane` (Track
      // 1111 Phase 2 — track_chat follows its track's current lane's
      // primary_model instead of always defaulting to the project's model)
      // is needed on EVERY turn regardless of resume state, since model
      // selection isn't a session-continuity concern — only the full
      // multi-file context injection is. Split accordingly: lane lookup
      // (cheap, index.md only) always runs when chatTrack is set;
      // full context injection stays gated by `!resumingChat`.
      let fullPrompt = String(prompt);
      let chatTrackLane = null;
      if (chatTrack) {
        const trackDirName = resolveTrackFolder('conductor/tracks', chatTrack);
        if (trackDirName) {
          const trackPath = join('conductor/tracks', trackDirName);
          const indexContent = readIfExists(join(trackPath, 'index.md'));
          if (indexContent) {
            chatTrackLane = indexContent.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
          }
          if (!resumingChat) {
            let ctx = '';
            for (const name of ['index.md', 'spec.md', 'plan.md', 'conversation.md']) {
              const content = name === 'index.md' ? indexContent : readIfExists(join(trackPath, name));
              if (content) ctx += `\n<track_context file="${name}">\n${content}\n</track_context>\n`;
            }
            if (ctx) fullPrompt = `${ctx}\nThe user asks about track ${chatTrack}:\n${prompt}`;
          }
        }
      }

      let status, result;
      try {
        let cmd, cliArgs;
        if (process.env.LC_MOCK_CLI) {
          const [c, ...rest] = process.env.LC_MOCK_CLI.split(' ');
          cmd = c;
          cliArgs = [...rest, 'chat', chatTrack ?? 'adhoc', ...chatSessionArgs];
        } else {
          const proj = getProject();
          cmd = proj.primary?.cli || 'claude';
          // Plain `--print` text, deliberately NOT buildClaudeArgs — that
          // builds a stream-json invocation for the transcript pipeline,
          // and its raw JSONL is unreadable as a chat reply (verified
          // live: the first working version returned hook/system events as
          // the "answer"). A chat turn just needs the text back.
          // Merge note (1111 → main): track-1111 branched before Track 1113
          // Phase 3's `chatSessionArgs` (chat session resume) existed, so
          // its patch dropped `...chatSessionArgs` — restored here alongside
          // 1111's own per-lane model resolution, since the two are
          // unrelated (session-resume args vs. which model runs the turn).
          cliArgs = ['--dangerously-skip-permissions', ...chatSessionArgs, '-p', fullPrompt];
          // Track 1111 Phase 2: chatTrackLane's primary_model (if the lane
          // has one configured) wins over the project default — same
          // precedence rule buildCliArgs uses for lane actions (REQ-2),
          // via the same shared resolver.
          const chatLaneConfig = chatTrackLane ? (workflowConfig?.lanes?.[chatTrackLane] ?? {}) : {};
          const { model: chatModel } = resolveLaneCliAndModel({ laneConfig: chatLaneConfig, proj });
          if (cmd === 'claude' && chatModel) cliArgs.push('--model', chatModel);
        }

        const { stdout, code } = await new Promise((resolvePromise) => {
          const proc = spawn(cmd, cliArgs, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '', err = '';
          proc.stdout.on('data', d => { out += d.toString(); });
          proc.stderr.on('data', d => { err += d.toString(); });
          proc.on('exit', c => resolvePromise({ stdout: out || err, code: c }));
          proc.on('error', e => resolvePromise({ stdout: e.message, code: 1 }));
        });

        status = code === 0 ? 'done' : 'failed';
        // The reply itself IS the result — a chat bar with an empty "done"
        // is useless, which is the whole point of this handler.
        result = (stdout || '').trim() || (code === 0 ? '(no output)' : `chat turn exited ${code}`);
      } catch (err) {
        status = 'failed';
        result = `chat turn failed: ${err.message}`;
        logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] chat turn failed');
      }

      // Track 1113 Phase 3 (REQ-5): persist only after the turn actually ran,
      // matching spawnCli's reasoning — resolving-then-persisting on a path
      // that never spawns orphans a session row.
      if (chatSession && status === 'done') {
        await persistTrackSession(chatTrack, chatSession.claude_session_id);
      }

      // Track 1113 Phase 3 (REQ-7): heartbeat writes are last-write-wins with
      // no mutex, so an unconditional 'idle' here would clobber a lane action
      // that is still running on this worker and make it look finished.
      if (runningPids.size === 0) {
        updateWorkerHeartbeat('idle', null);
      } else {
        logger.info({ dispatchId: entry.id, runningLaneActions: runningPids.size },
          '[dispatch] Chat turn done — leaving heartbeat busy, lane action still running');
      }

      // A track_chat reply used to live ONLY in worker_dispatch.result —
      // visible in the live Transcript/chat bar, invisible everywhere else
      // (Conversation tab, the Inbox's unreplied count, any future turn's
      // `conversation.md` re-read). Reported live during this session: a
      // human asked a question via the chat bar and never saw an answer in
      // Conversation, because none was ever written there.
      //
      // Fix: append to conversation.md, the same file every other reply
      // (dispatch-plan/implement/review closing responses, session-turn
      // summaries) already writes to — NOT a direct DB/API write. Writing
      // straight to track_comments was tried and reverted earlier this
      // session: it desyncs the file (the source of truth a future turn
      // reads) from the DB (what the UI shows), and a worker restart mid-
      // sync can then advance the file's cursor past content that was
      // never actually parsed, silently losing it. Appending to the file
      // and letting the EXISTING conv-sync watcher push it to
      // track_comments keeps exactly one source of truth, like every other
      // reply path in this file.
      //
      // Every line must be `>`-prefixed (see "Protocol: conversation.md
      // Format") — a chat reply is often multi-paragraph, and a single
      // unprefixed blank line silently truncates the parsed comment body.
      if (entry.action === 'track_chat' && chatTrack && status === 'done') {
        const trackDirName = resolveTrackFolder('conductor/tracks', chatTrack);
        if (trackDirName) {
          const proj = getProject();
          // Track 1113 REQ-8 fix (found live 2026-08-18): the server's
          // POST /track/:num/comment silently coerces any author outside
          // ['human', 'system', ...PROVIDER_IDS] to 'human' — a raw
          // proj.primary.cli value that isn't an exact PROVIDER_IDS entry
          // (an alias like 'agy', or any non-standard configured CLI id)
          // got mislabeled as human-authored in the Conversation tab,
          // misattributing the AI's own reply to the person it was
          // replying to. normalizeProviderId resolves known aliases
          // ('agy' -> 'antigravity') to what the server actually expects;
          // an unrecognized cli still falls back to 'claude' — a valid,
          // correctly-AI-attributed default — rather than silently
          // becoming 'human' several layers away from here.
          const author = process.env.LC_MOCK_CLI ? 'worker' : normalizeAuthorForComment(proj?.primary?.cli);
          const quoted = result.split('\n').map(line => line ? `> ${line}` : '>').join('\n');
          try {
            appendFileSync(join('conductor/tracks', trackDirName, 'conversation.md'), `\n> **${author}**: ${quoted.slice(2)}\n`, 'utf8');
          } catch (err) {
            logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to append chat reply to conversation.md');
          }
        }
      }

      await patch(url, token, `/worker-dispatch/${entry.id}`, { status, result })
        .catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report chat result'));
      continue;
    }

    if (entry.action === 'provision-worker') {
      // Track 1089 Phase 6 (2026-08-12, redesigned — SSH dropped entirely):
      // start a worker for an existing project on THIS manager's own
      // machine. No SSH: the dispatch inbox is outbound-polling, so a
      // machine that should run workers already has a manager polling from
      // it, and that manager can just start the worker locally. Provisioning
      // "somewhere else" is then simply dispatching to that machine's own
      // manager instead — no inbound network path, no credentials, works
      // through NAT/firewalls. See index.md for the full reasoning.
      const projectName = entry.payload?.project_name;
      const repoPath = entry.payload?.repo_path;
      const workerNumber = parseInt(entry.payload?.worker_number) || 1;

      if (!projectName) {
        const reason = 'provision-worker requires project_name in payload';
        logger.warn({ dispatchId: entry.id }, `[dispatch] ${reason}`);
        await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: reason }).catch(() => { });
        continue;
      }

      const projectsDir = readManagerProjectsDir();

      // Resolution order matters. The project's own repo_path is the only
      // *authoritative* answer, so try it first — it's correct whenever
      // the project is on this machine at the path the DB already knows,
      // which is the common case. Only fall back to guessing under this
      // manager's projectsDir when that path doesn't exist here (a
      // different machine, or a different layout). slugify(name) is the
      // weakest guess and comes last: real folder names often don't match
      // a slugified display name ("FiveElements" lives in 5elements/).
      const candidates = [];
      if (repoPath) candidates.push(repoPath);
      if (projectsDir && repoPath) candidates.push(join(projectsDir, basename(repoPath)));
      if (projectsDir) candidates.push(join(projectsDir, slugify(projectName)));
      const projectPath = candidates.find(p => existsSync(p));

      logger.info({ dispatchId: entry.id, projectName, projectPath }, '[dispatch] Running provision-worker');
      updateWorkerHeartbeat('busy', `provision-worker ${projectName} (dispatch ${entry.id})`);

      let status, result;
      if (!projectPath) {
        status = 'failed';
        result = candidates.length
          ? `Project "${projectName}" not found on ${hostname}. Looked in:\n${candidates.map(p => `  • ${p}`).join('\n')}\nEither the project isn't on this machine, or it lives outside this manager's projects directory${projectsDir ? ` (${projectsDir})` : ''}.`
          : `Project "${projectName}" has no known path, and this manager has no projects directory configured — restart it with \`lc worker start --manager --projects-dir <path>\`.`;
      } else {
        try {
          const cli = entry.payload?.cli;
          const model = entry.payload?.model;
          // Default to sync+poll (auto): the per-track **Auto Run** marker
          // (default no) already gates which tracks get picked up
          // unattended, so the worker-level mode no longer needs to default
          // to the conservative sync-only — see ProvisionWorkerModal.jsx.
          // Only an explicit 'sync-only' request skips --sync-and-work.
          const mode = entry.payload?.mode === 'sync-only' ? 'sync-only' : 'sync+poll';
          let cmd = `lc worker start --worker-number ${workerNumber}`;
          if (cli) cmd += ` --cli ${cli}`;
          if (model) cmd += ` --model ${model}`;
          if (mode === 'sync+poll') cmd += ' --sync-and-work';
          const { stdout } = await execAsync(cmd, {
            cwd: projectPath,
            timeout: 60_000,
            encoding: 'utf8',
          });
          status = 'done';
          result = `Started worker #${workerNumber} for "${projectName}" with CLI "${cli || 'default'}", Model "${model || 'default'}", Mode "${mode}" at ${projectPath} on ${hostname}\n${(stdout || '').trim()}`.trim();
        } catch (err) {
          status = 'failed';
          const stderr = (err.stderr || '').trim();
          const detail = err.killed ? 'timed out after 60s' : (stderr || err.message);
          result = `Failed to start worker #${workerNumber} for "${projectName}" at ${projectPath} — ${detail}`;
          logger.warn({ dispatchId: entry.id, projectName, err: err.message }, '[dispatch] provision-worker failed');
        }
      }

      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status, result })
        .catch(err => logger.warn({ dispatchId: entry.id, err: err.message }, '[dispatch] Failed to report provision-worker result'));
      continue;
    }

    // Lane action dispatch
    const trackNumber = entry.track_number;
    const tracksDir = 'conductor/tracks';
    const trackDirName = trackNumber ? resolveTrackFolder(tracksDir, trackNumber) : null;
    if (!trackDirName) {
      const reason = trackNumber ? 'track not found locally' : 'missing track_number';
      logger.warn({ dispatchId: entry.id, trackNumber, reason }, `[dispatch] ${reason}, skipping`);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: reason }).catch(() => { });
      continue;
    }

    const indexPath = join(tracksDir, trackDirName, 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
    const lane_status = laneMatch?.[1]?.trim();
    const laneConfig = workflowConfig?.lanes?.[lane_status] ?? {};
    const laneStatusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
    const originalLaneActionStatus = laneStatusMatch?.[1]?.trim() || 'queue';

    const cliArgs = await buildCliArgs('laneconductor', entry.action, trackNumber, null, laneConfig);
    if (!cliArgs) {
      logger.warn({ dispatchId: entry.id, trackNumber }, `[dispatch] no available provider for track`);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'no provider available' }).catch(() => { });
      continue;
    }

    const [cmd, args, cli, model, tier, session] = cliArgs;
    const updateHeader = (c, h, v) => {
      const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
      return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
    };
    writeFileSync(indexPath, updateHeader(content, 'Lane Status', 'running'), 'utf8');
    // Mirrors the failure branch's own DB write below (originalLaneActionStatus) —
    // without this, lane_action_status stays 'queue' in the DB (and thus the UI)
    // for the whole run, even though the file and the actual CLI process both
    // agree the track is running.
    await patch(url, token, `/track/${trackNumber}/action`, { lane_action_status: 'running' })
      .catch(e => logger.warn({ dispatchId: entry.id, trackNumber, err: e.message }, '[dispatch] Failed to mark lane_action_status running'));

    const proj = getProject();
    try {
      const spawnedPid = await spawnCli(cmd, args, `dispatch-${entry.action}`, trackNumber, cli, model, tier, lane_status, laneConfig, proj?.id, session, 'manual-dispatch');
      console.log(`[dispatch] Track ${trackNumber} → ${entry.action} (PID: ${spawnedPid}, dispatch ${entry.id})`);
      activeDispatch.set(trackNumber, entry.id);
    } catch (err) {
      // Track 1102 F8: every other dispatch handler (chat, deploy,
      // create-project, provision-worker) wraps its work and reports
      // status: 'failed' with the real error; this branch didn't — a
      // spawnCli failure (git-lock contention, worktree setup, etc.) left
      // the dispatch permanently 'claimed' and the Lane Status marker
      // stuck on the 'running' just written above, with nothing to ever
      // revert either. Report failure the same way the others do, and put
      // the file/DB status back to what it was before this attempt.
      logger.warn({ dispatchId: entry.id, trackNumber, err: err.message }, `[dispatch] spawnCli failed for ${entry.action}`);
      writeFileSync(indexPath, updateHeader(content, 'Lane Status', originalLaneActionStatus), 'utf8');
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: err.message })
        .catch(e => logger.warn({ dispatchId: entry.id, err: e.message }, '[dispatch] Failed to report lane-action failure'));
      await patch(url, token, `/track/${trackNumber}/action`, { lane_action_status: originalLaneActionStatus, lane_action_result: err.message })
        .catch(e => logger.warn({ trackNumber, err: e.message }, '[dispatch] Failed to reset track lane_action_status after spawn failure'));
      // Previously only visible by digging through the dispatch table and
      // lock files (observed live: a lock-contention rejection — a second
      // dispatch racing an already-running session for the same track —
      // left conversation.md and the Inbox with no trace of what happened,
      // making a completely ordinary "another run was already in
      // progress" bounce look like an unexplained stall). Post it where a
      // human is actually looking.
      try {
        appendFileSync(join(tracksDir, trackDirName, 'conversation.md'),
          `\n> **system**: ${entry.action} could not start: ${err.message}\n`);
      } catch (writeErr) {
        logger.warn({ trackNumber, err: writeErr.message }, '[dispatch] Failed to post spawn-failure conversation comment');
      }
    }
  }
}

// Poll in-flight lane-action dispatches for completion (see activeDispatch
// comment above for why this is poll-based rather than an exit callback).
async function reconcileActiveDispatch() {
  if (activeDispatch.size === 0) return;
  const { url, token } = primaryCollector();
  if (!url) return;
  const tracksDir = 'conductor/tracks';

  // Track 10020: reconcileActiveDispatch used to trust the file's current
  // Lane Status text alone — but the agent doing the actual work can
  // transiently write a non-"running" value mid-session (e.g. while
  // investigating something unrelated) without having actually exited.
  // Caught live: a dispatch got marked done and DB pushed to a stale
  // resolved state while the underlying CLI process (confirmed via live
  // PID) kept working for minutes afterward. runningTrackMap is
  // authoritative here — spawnCli's own proc.on('exit') handler is the
  // ONLY thing that ever removes an entry from it, so if this process's
  // own spawned child for a track is still in there, the CLI genuinely
  // hasn't exited yet, regardless of what the file currently says.
  const stillRunningTracks = new Set(runningTrackMap.values());

  for (const [trackNumber, dispatchId] of activeDispatch) {
    if (stillRunningTracks.has(trackNumber)) continue;

    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    const indexPath = trackDirName ? join(tracksDir, trackDirName, 'index.md') : null;
    if (!indexPath || !existsSync(indexPath)) {
      activeDispatch.delete(trackNumber);
      continue;
    }

    const content = readFileSync(indexPath, 'utf8');
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
    const status = statusMatch?.[1]?.trim();
    if (status === 'running') continue; // belt-and-braces, in case runningTrackMap ever missed it

    // Track 1102 F12: the exit handler's own completion PATCH (and
    // copy-back's own DB sync right after it) can both fail — a
    // transient network/DB outage covering the whole exit handler
    // leaves tracks.lane_action_status frozen at 'running' forever,
    // since nothing else ever retries pushing this file's now-terminal
    // state to the DB (confirmed live:
    // conductor/tests/track-1102-f12-stuck-running.test.mjs — a
    // narrower version that only broke the direct completion PATCH did
    // NOT reproduce a stuck track, since copy-back's independent
    // syncTrack() call self-healed it; only a full outage covering both
    // does). Re-push the track here too, and keep retrying (don't
    // delete from activeDispatch) until it actually lands, so a
    // transient outage self-heals on a later 5s tick instead of staying
    // stuck forever with no automatic recovery.
    //
    // syncTrack() catches its own postToCollectors() failure internally
    // and returns the boolean `collectorSynced` rather than rejecting —
    // must check the RETURNED value, not just whether the call resolved
    // (a naive `.then(() => true)` here would treat every call as
    // successful regardless of what actually happened, which is exactly
    // what let this fix's own first draft slip through unnoticed).
    const trackSynced = await syncTrack(indexPath).catch(err => {
      console.warn(`[dispatch] Failed to re-sync track ${trackNumber} to DB (will retry): ${err.message}`);
      return false;
    });
    if (!trackSynced) continue; // retry next tick — leave activeDispatch entry in place

    // resolveTransition() means the value here isn't always a clean
    // success/failure literal: a lane with a configured on_success/
    // on_failure transition can land on 'queue' either because the action
    // succeeded and moved to the next lane, OR because it failed but hasn't
    // hit max_retries yet (same 'queue' value, no way to tell apart from
    // this field alone — that ambiguity is inherent to the existing
    // lane-transition system, not something dispatch tracking can resolve).
    // Only the literal 'failure' status is unambiguous; everything else that
    // isn't 'running' means the run finished, reported as 'done'.
    activeDispatch.delete(trackNumber);
    const dispatchStatus = status === 'failure' ? 'failed' : 'done';
    const result = status === 'failure' ? null : (status === 'success' ? null : `lane status: ${status} (see track for outcome)`);
    await patch(url, token, `/worker-dispatch/${dispatchId}`, { status: dispatchStatus, result })
      .catch(err => console.warn(`[dispatch] Failed to report result for dispatch ${dispatchId}: ${err.message}`));
  }
}

// LC_DISPATCH_POLL_MS: test-only override (default stays 10s). Track 1113's
// deferral path (REQ-6) only engages when an inbox cycle lands *while* a lane
// action is still running; at the 10s default a test would have to hold a
// mock CLI open >10s to observe it, which is both slow and timing-fragile.
setInterval(() => {
  checkDispatchInbox().catch(err => console.error('[dispatch error]:', err.message));
}, Number(process.env.LC_DISPATCH_POLL_MS) || 10000);
// LC_RECONCILE_ACTIVE_POLL_MS: test-only override (default stays 5s) —
// Track 10020's regression test needs several reconcile ticks inside a
// short-lived transient blip to prove the fix doesn't finalize on them.
setInterval(() => {
  reconcileActiveDispatch().catch(err => console.error('[dispatch-reconcile error]:', err.message));
}, Number(process.env.LC_RECONCILE_ACTIVE_POLL_MS) || 5000);
setInterval(() => {
  reconcileAutoComplete().catch(err => console.error('[auto-complete-reconcile error]:', err.message));
}, 5000);

// Track 1084 Phase 8 (2026-08-17 incident, see the comment above
// workerStartedAt): heartbeat gives zero signal that dispatch-polling is
// silently dead, so check for that specific condition directly instead of
// inferring it from symptoms elsewhere. 90s is comfortably past a normal
// registration round-trip (well under 5s in practice) plus retry — a
// worker that's still unregistered at that point has a real, ongoing
// problem, not a slow start.
// Test-only overrides (LC_WORKER_ID_STALE_GRACE_MS / LC_WORKER_ID_WATCHDOG_MS)
// — same reasoning as LC_DISPATCH_POLL_MS above: a test asserting this
// watchdog fires shouldn't have to wait out 90s+60s of real time.
const WORKER_ID_STALE_GRACE_MS = Number(process.env.LC_WORKER_ID_STALE_GRACE_MS) || 90000;
setInterval(() => {
  if (getIsLocalFs() || myWorkerId) return;
  const ageMs = Date.now() - workerStartedAt;
  if (ageMs < WORKER_ID_STALE_GRACE_MS) return;
  if (!workerIdResolvedLoggedStale) {
    workerIdResolvedLoggedStale = true;
    console.error(`[health] No worker id resolved ${Math.round(ageMs / 1000)}s after startup — dispatch-polling has been silently no-oping this entire time (heartbeat does NOT depend on this and looks completely healthy in the meantime). Retrying registration now; will keep retrying until it succeeds.`);
  }
  upsertWorker().catch(err => console.error('[health] Retry registration failed:', err.message));
}, Number(process.env.LC_WORKER_ID_WATCHDOG_MS) || 60000);

// Track 1091 Phase 7: a dedicated interval, not folded into
// checkDispatchInbox's poll above despite Phase 6's plan.md suggesting
// "reuse the create-project check's cadence, don't add a second
// setInterval" — checkDispatchInbox() returns immediately whenever the
// dispatch queue is empty (`if (!entries || entries.length === 0)
// return;`), which is true most of the time a manager is otherwise idle.
// A host-wide process sweep needs to run on its own schedule regardless
// of queue activity, or it would barely run at all in practice.
// LC_ORPHAN_REAP_POLL_MS: test-only override (default 5 min in production).
setInterval(() => {
  reapOrphanedWorkerProcesses().catch(err => logger.warn({ err: err.message }, '[orphan-reap error]'));
}, Number(process.env.LC_ORPHAN_REAP_POLL_MS) || 5 * 60 * 1000);

// ── Auto-launch: concurrent guard ────────────────────────────────────────────
let autoLaunchRunning = false;

// ── Track 1109: --once termination ───────────────────────────────────────────
// Which of the scoped tracks still have work outstanding, read from the
// filesystem (the same source auto-launch makes its decisions from — the DB
// is only heartbeats/UI sync, so asking it here could disagree with what the
// worker will actually do next cycle).
function remainingScopedWork() {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return new Set();
  const remaining = new Set();
  for (const dir of readdirSync(tracksDir)) {
    const m = dir.match(/^(\d+)/);
    if (!m) continue;
    const num = String(parseInt(m[1], 10));
    if (!onlyTracks.has(num)) continue;
    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;
    const status = readFileSync(indexPath, 'utf8')
      .match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase();
    if (status === 'queue' || status === 'running') remaining.add(num);
  }
  return remaining;
}

// Guards the "typo exits instantly with success" case: if the very first
// cycle finds nothing matching, that is almost always a wrong track number,
// not completed work. Say so rather than exiting 0 and looking like success.
let sawScopedWork = false;

async function maybeExitWhenScopedWorkDone() {
  const remaining = remainingScopedWork();
  if (remaining.size > 0 || runningPids.size > 0) { sawScopedWork = true; return; }

  if (!isScopedWorkFinished({ onlyTracks, runningCount: runningPids.size, remainingClaimable: remaining })) return;

  if (!sawScopedWork) {
    console.error(`[LaneConductor] --once: no queued or running track matched [${[...onlyTracks].join(', ')}] — nothing to do. Check the track number(s).`);
    await removeWorker();
    process.exit(1);
  }

  console.log(`[LaneConductor] --once: scoped work complete for [${[...onlyTracks].join(', ')}] — exiting.`);
  await removeWorker();  // same deregistration the SIGTERM path uses; no phantom worker left in the UI
  process.exit(0);
}

// Auto-launch: Pick up one queued track per lane (respects lane limits)
setInterval(async () => {
  if (syncOnly) return; // SKIP auto-launch in sync-only mode
  if (autoLaunchRunning) return;  // prevent concurrent runs (async setInterval)
  autoLaunchRunning = true;
  try {
    workflowConfig = loadWorkflowConfig();
    const globalLimit = workflowConfig?.global?.total_parallel_limit ?? 3;
    if (runningPids.size >= globalLimit) return;

    if (getIsLocalFs()) {
      await autoLaunchLocalFs(globalLimit);
      return;
    }

    // API mode: pull workflow from server and use claim-queue endpoint
    const { url, token } = primaryCollector();
    try {
      await pullWorkflow();
      workflowConfig = loadWorkflowConfig();
      tracksMetadata = loadTracksMetadata();
      const globalLimit = workflowConfig?.global?.total_parallel_limit ?? 3;
      if (runningPids.size >= globalLimit) return;

      // Pre-check provider availability to avoid claim-and-skip loops
      const proj = getProject();
      const primary = proj.primary?.cli;
      const secondary = proj.secondary?.cli;
      const primaryOk = await isProviderAvailable(primary);
      const secondaryOk = secondary ? await isProviderAvailable(secondary) : false;
      let anyAvailable = primaryOk || secondaryOk;

      if (primary === 'claude' && primaryOk && !secondaryOk) {
        anyAvailable = await checkClaudeCapacity();
      }

      if (!anyAvailable) {
        if (!providerStatusCache.has('last_exhaustion_log') || Date.now() - providerStatusCache.get('last_exhaustion_log') > 60000) {
          console.log(`[auto-launch] No providers available (primary ${primary}: ${primaryOk}, secondary ${secondary}: ${secondaryOk})`);
          providerStatusCache.set('last_exhaustion_log', Date.now());
        }
        return;
      }

      // Launch decisions are always filesystem-based (same as local-fs mode).
      // DB is used only for heartbeats and UI sync, not for concurrency control.
      // Track 1084 Phase 3: fetch which queued tracks this worker may claim
      // (assignee/pin gating) once per cycle — not per track — to avoid a
      // request storm on projects with many tracks. myWorkerId is null if
      // registration hasn't completed yet; null claimableSet means "no
      // restriction" so a not-yet-registered worker doesn't just idle forever.
      let claimableSet = null;
      if (myWorkerId) {
        try {
          const { claimable } = await get(url, token, `/api/projects/${proj.id}/claimable-tracks?worker_id=${myWorkerId}`);
          claimableSet = new Set(claimable);
        } catch (err) {
          console.warn(`[auto-launch] Failed to fetch claimable-tracks (proceeding unrestricted this cycle): ${err.message}`);
        }
      }

      await autoLaunchLocalFs(globalLimit, claimableSet);
    } catch (err) {
      console.error('[auto-launch error]:', err.message);
    }
  } finally {
    autoLaunchRunning = false;
    if (exitWhenDone) await maybeExitWhenScopedWorkDone();
  }
}, 5000);

// ── Shutdown ──────────────────────────────────────────────────────────────────

process.on('SIGTERM', async () => { await removeWorker(); process.exit(0); });
process.on('SIGINT', async () => { await removeWorker(); process.exit(0); });
process.on('uncaughtException', async (err) => {
  console.error('[fatal] Uncaught Exception:', err.message);
  await removeWorker(); process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  console.error('[fatal] Unhandled Rejection:', reason);
  await removeWorker(); process.exit(1);
});
