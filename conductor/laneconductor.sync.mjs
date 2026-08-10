#!/usr/bin/env node
// conductor/laneconductor.sync.mjs
// LaneConductor Heartbeat Worker — run via: make lc-start
// Worker has zero DB knowledge — all writes go through the Collector HTTP API.

import { watch } from 'chokidar';
import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync, openSync, mkdirSync, statSync, rmSync, copyFileSync, renameSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import os from 'os';

import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from './constants.mjs';
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
import { compareTimestamps, isConcurrentEdit } from './sync-timestamp-utils.mjs';
import { parseConversationComments } from './sync-conversation-utils.mjs';
import { isResumeFailure } from './session-resilience-utils.mjs';
import { buildClaudeArgs } from './claude-cli-args.mjs';
import { parseNewJsonlLines } from './stream-json-tail.mjs';

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

// Track 1084 Phase 0: stable worker identity. pid is ephemeral (a restart
// gets a new OS pid, which under the old (project_id, hostname, pid)
// uniqueness minted a brand-new DB row and orphaned anything FK'd to it) —
// worker_number is a stable, user-assigned identity that survives restarts.
// Defaults to 1, preserving today's single-worker-per-host behavior.
const workerNumberArgIdx = process.argv.indexOf('--worker-number');
const workerNumber = workerNumberArgIdx !== -1
  ? parseInt(process.argv[workerNumberArgIdx + 1], 10)
  : (parseInt(process.env.LC_WORKER_NUMBER, 10) || 1);

// Track 1084 Phase 3: this worker's own DB id, learned from the
// /worker/register response — needed to ask /claimable-tracks "which queued
// tracks may I claim" during auto-launch. Null until the first successful
// registration (e.g. local-fs mode, where there's no DB/registration at all).
let myWorkerId = null;

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

// Resolve worker mode: CLI flag overrides config, config defaults to 'sync+poll'
if (!workerMode) {
  const configMode = getWorkerModeConfig();
  workerMode = configMode === 'sync-only' ? 'sync-only' : 'sync+poll';
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

// Resolve auth token for a collector entry (handles GCP Secret Manager, env, and machine tokens)
function resolveToken(collector, envKey) {
  // 1. Try environment variable override
  if (process.env[envKey]) return process.env[envKey];

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

  // 3. Fallback to machine token or inline token (for local-api mode)
  return collector.machine_token ?? collector.token ?? null;
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

  // 4. machine_token (from registration)
  if (c.machine_token) return c.machine_token;

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

      const project_id = ensureRes.project_id || proj.id;
      if (project_id && proj.id !== project_id) {
        proj.id = project_id;
        writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
      }

      const visibility = proj.worker?.visibility || config.worker?.visibility || 'private';
      const res = await post(url, token, '/worker/register', { hostname, pid, project_id, visibility, mode: workerMode, worker_number: workerNumber });

      if (res.id) myWorkerId = res.id;

      // Store the returned machine token on disk for next beats
      if (res.machine_token && res.machine_token !== c.machine_token) {
        c.machine_token = res.machine_token;
        writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
      }

      console.log(`[LaneConductor] Worker registered to ${url}: ${hostname} (PID: ${pid}) [${workerMode}]`);
      if (proj.id) notifyApi('worker:updated', { projectId: proj.id });
    } catch (err) {
      console.error(`[worker error] registration failed for ${url}:`, err.message);
    }
  }
}

const TASK_UNCHANGED = Symbol('TASK_UNCHANGED');

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
      const body = { hostname, pid, project_id: proj.id, mode: workerMode, worker_number: workerNumber };
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

function loadWorkflowConfig() {
  // 1. Try project-local workflow.json (canonical per-project source)
  if (existsSync('conductor/workflow.json')) {
    try { return JSON.parse(readFileSync('conductor/workflow.json', 'utf8')); }
    catch (err) { console.error('[config] Failed to parse conductor/workflow.json:', err.message); }
  }

  // 2. Try canonical global workflow.json from LaneConductor repo
  const installPath = getInstallPath();
  if (installPath) {
    const globalWf = join(installPath, 'conductor', 'workflow.json');
    if (existsSync(globalWf)) {
      try { return JSON.parse(readFileSync(globalWf, 'utf8')); }
      catch (err) { console.error('[config] Failed to parse global workflow.json:', err.message); }
    }
  }

  // 3. Fall back to embedded JSON block in workflow.md (legacy)
  const content = readIfExists('conductor/workflow.md');
  if (!content) return null;
  const match = content.match(/## Workflow Configuration\n```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
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
function resolveTrackFolder(tracksDir, trackNumber) {
  if (!existsSync(tracksDir)) return null;
  const matches = readdirSync(tracksDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith(`${trackNumber}-`))
    .map(d => d.name)
    .sort();

  if (matches.length <= 1) return matches[0] || null;

  const meta = getTrackMetadata(trackNumber);
  const registered = meta?.folder_path ? basename(meta.folder_path) : null;
  const canonical = (registered && matches.includes(registered)) ? registered : matches[0];

  console.warn(`[ambiguous-track] Track ${trackNumber} matched ${matches.length} folders (${matches.join(', ')}) — using "${canonical}", quarantining the rest.`);

  for (const dupName of matches) {
    if (dupName === canonical) continue;
    const from = join(tracksDir, dupName);
    const to = join(tracksDir, `_duplicate-${dupName}`);
    try {
      if (!existsSync(to)) {
        renameSync(from, to);
        console.warn(`[ambiguous-track] Quarantined duplicate folder: ${from} -> ${to}`);
      }
    } catch (err) {
      console.error(`[ambiguous-track] Failed to quarantine ${from}:`, err.message);
    }
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
  // 1. Try explicit **Status** marker (high confidence)
  const explicitStatus = content.match(/\*\*Status\*\*:\s*([a-z0-9-]+)/i);
  if (explicitStatus) {
    const s = explicitStatus[1].toLowerCase().trim();
    if (LaneAliases[s]) return LaneAliases[s];
    if (Object.values(Lanes).includes(s)) return s;
    return s;
  }

  // 2. Try explicit **Lane** marker (high confidence)
  const explicitLane = content.match(/\*\*Lane\*\*:\s*([a-z0-9-]+)/i);
  if (explicitLane) {
    const l = explicitLane[1].toLowerCase().trim();
    if (LaneAliases[l]) return LaneAliases[l];
    if (Object.values(Lanes).includes(l)) return l;
    return l;
  }

  // 3. Heuristic matching (only if high-confidence markers weren't found)
  // Use word boundaries to avoid matching "Implementation Plan" as "implement"
  const explicitMarkers = [
    { pattern: /\bquality-gate\b/i, status: Lanes.QUALITY_GATE },
    { pattern: /\bdone\b/i, status: Lanes.DONE },
    { pattern: /\bcompleted\b/i, status: Lanes.DONE },
    { pattern: /\bsuccess\b/i, status: Lanes.DONE },
    { pattern: /\bbacklog\b/i, status: Lanes.BACKLOG },
    { pattern: /\bimplement\b(?!ation)/i, status: Lanes.IMPLEMENT },
    { pattern: /\bplan(?:ning)?\b/i, status: Lanes.PLAN },
    { pattern: /\breview\b/i, status: Lanes.REVIEW },
  ];
  for (const m of explicitMarkers) {
    if (m.pattern.test(content)) return m.status;
  }
  const emojiMarkers = [
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*DONE/im, status: 'done' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*REVIEWED/im, status: createQualityGate ? 'quality-gate' : 'done' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⏳\s*IMPLEMENT/im, status: 'implement' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⏳\s*IN[ _]?PROGRESS/im, status: 'implement' },

    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*🔄\s*BLOCKED/im, status: 'review' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⚠️\s*PARTIAL/im, status: 'review' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*COMPLETE/im, status: 'review', checkTasks: true },
  ];
  let bestMatch = null, lastIndex = -1;
  for (const m of emojiMarkers) {
    const match = m.pattern.exec(content);
    if (match && match.index > lastIndex) {
      if (m.checkTasks && /- \[ \]/.test(content)) continue;
      lastIndex = match.index;
      bestMatch = m.status;
    }
  }
  return bestMatch;
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
  return value || null; // an empty marker isn't a real value — let the caller fall back
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

function parseTrackType(content) {
  const match = content.match(/\*\*Type\*\*:\s*([^\n]+)/i);
  if (!match) return 'dev';
  const val = match[1].trim().toLowerCase();
  return ['dev', 'marketing', 'sales', 'support', 'other'].includes(val) ? val : 'dev';
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
  return trackDir.match(/^(\d+)/)?.[1] ?? trackDir;
}

function extractTitle(filepath) {
  const parts = filepath.replace(/\\/g, '/').split('/');
  const trackDir = parts[parts.length - 2] ?? '';
  return trackDir.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
              ensureTrackFileExists(fullTrackFolder, 'test.md', '# Tests\n\n(Test cases to be added)\n');
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

    const indexContent = readIfExists(join(trackDir, 'index.md'));
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
      index_content: indexContent, plan_content: planContent, spec_content: specContent, test_content: testContent,
      log_content: logContent,
      // KPI fields
      track_type: trackType,
      kpi_target: parseKpiTarget(stateContent),
      kpi_actual: parseKpiActual(stateContent),
      kpi_snapshot: parseKpiSnapshot(stateContent),
      kpi_check_after: kpiCheckAfter && !isNaN(kpiCheckAfter) ? kpiCheckAfter.toISOString() : null,
      kpi_scheduled_at: kpiScheduledAt && !isNaN(kpiScheduledAt) ? kpiScheduledAt.toISOString() : null,
      ...kpiSpec,
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

async function syncConversation(filepath) {
  if (getIsLocalFs()) return;
  try {
    const trackNumber = extractTrackNumber(filepath);
    if (!trackNumber) return;
    const trackDir = dirname(filepath);
    const cursorPath = join(trackDir, '.conv-cursor');

    const content = readFileSync(filepath, 'utf8');
    const cursor = parseInt(readIfExists(cursorPath) || '0');
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

// Only process .md files inside numbered track directories (e.g. 1012-git-worktree/index.md)
// Filters out file_sync_queue.md, test-sync.md, and any non-numbered subdirs like tracks/
const isTrackFile = f => f.endsWith('.md') && /[/\\]\d+[^/\\]*[/\\][^/\\]+\.md$/.test(f);
const isConvFile = f => f.endsWith('conversation.md') && /[/\\]\d+[^/\\]*[/\\]conversation\.md$/.test(f);

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

await upsertWorker();
workflowConfig = loadWorkflowConfig();
tracksMetadata = loadTracksMetadata();
console.log(`[LaneConductor] Heartbeat worker started (PID: ${process.pid})`);
console.log(`[LaneConductor] Collector mode: ${getMode()}`);
console.log(`[LaneConductor] Worker mode: ${workerMode}`);
if (!getIsLocalFs()) console.log(`[LaneConductor] Collectors: ${getCollectors().map(c => c.url).join(', ')}`);
if (!getIsLocalFs()) console.log(`[LaneConductor] Dashboard: http://localhost:${getUi()?.port ?? 8090}`);

// Ensure providers are in DB so they show in UI (API modes only)
if (!getIsLocalFs()) (async () => {
  const { url, token } = primaryCollector();
  const proj = getProject();
  if (proj.primary?.cli) {
    post(url, token, '/provider-status', { provider: proj.primary.cli, status: 'available' }).catch(() => { });
  }
  if (proj.secondary?.cli) {
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
  for (const dir of readdirSync(tracksDir).filter(d => /^\d+/.test(d))) {
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

setInterval(() => updateWorkerHeartbeat(), 10000);

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
  const entryRegex = /^### (.+?)$([\s\S]*?)(?=^###|^##|\Z)/gm;
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

  if ((geminiMatch && (hasHours || hasMins || hasSecs) || content.includes('exhausted your capacity') || content.includes('code: 429')) && (cli === 'gemini' || cli === 'npx' || cli === 'antigravity' || cli === 'agy')) {
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
  if (cli === 'claude' && (content.includes('429') || content.includes('Overloaded') || content.includes('Rate limit') || content.includes('hit your limit') || content.includes('resets'))) {
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

// Path isolation validation — ensures worktree paths can't escape the project root
function validatePathIsolation(trackNumber, proposedPath) {
  // Check for path traversal in track number
  if (trackNumber.includes('..') || trackNumber.includes('/') || trackNumber.includes('\\')) {
    throw new Error(`[isolation] Invalid track number (path traversal attempt): ${trackNumber}`);
  }

  const projectRoot = process.cwd();
  const worktreeBase = resolve(projectRoot, '.worktrees');
  const resolvedPath = resolve(proposedPath);

  // Verify resolved path is within .worktrees and project root
  if (!resolvedPath.startsWith(worktreeBase)) {
    throw new Error(`[isolation] Proposed path is outside .worktrees: ${resolvedPath}`);
  }
  if (!resolvedPath.startsWith(projectRoot)) {
    throw new Error(`[isolation] Proposed path is outside project root: ${resolvedPath}`);
  }

  return resolvedPath;
}

async function createWorktree(trackNumber) {
  const worktreePath = join(process.cwd(), '.worktrees', `${trackNumber}`);
  const parentDir = join(process.cwd(), '.worktrees');
  const lifecycle = getWorktreeLifecycle();

  try {
    // Validate path isolation before proceeding
    validatePathIsolation(trackNumber, worktreePath);
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
    // If per-cycle and branch exists, we already returned above, so this always creates fresh
    const branchName = `track-${trackNumber}`;
    gitExec(`git worktree add -B "${branchName}" "${worktreePath}" HEAD`, process.cwd());

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
      const src = join(process.cwd(), cfg);
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
    const claudeSrc = join(process.cwd(), '.claude');
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

async function removeWorktree(trackNumber) {
  const worktreePath = join(process.cwd(), '.worktrees', `${trackNumber}`);

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

async function mergeAndRemoveWorktree(trackNumber) {
  const worktreePath = join(process.cwd(), '.worktrees', `${trackNumber}`);
  const branchName = `track-${trackNumber}`;
  const mainBranch = getMainBranch();

  try {
    // Verify worktree exists
    if (!existsSync(worktreePath)) {
      console.log(`[worktree] Worktree not found for track ${trackNumber}, skipping merge`);
      return;
    }

    // Ensure we're on the main branch before merging
    gitExec(`git checkout ${mainBranch}`, process.cwd());

    // Check if branch exists before attempting merge
    let branchExists = false;
    try {
      gitExec(`git rev-parse --verify ${branchName}`, process.cwd());
      branchExists = true;
    } catch (e) {
      console.warn(`[worktree] Branch ${branchName} not found, skipping merge`);
    }

    if (branchExists) {
      // Merge the feature branch with --no-ff to preserve history
      try {
        gitExec(`git merge --no-ff ${branchName} -m "Merge track ${trackNumber}"`, process.cwd());
        console.log(`[worktree] Merged branch ${branchName} to ${mainBranch}`);

        // Delete the feature branch after successful merge
        try {
          gitExec(`git branch -d ${branchName}`, process.cwd());
          console.log(`[worktree] Deleted branch ${branchName}`);
        } catch (err) {
          console.warn(`[worktree] Failed to delete branch ${branchName}: ${err.message}`);
          // Continue to remove worktree even if branch deletion fails
        }
      } catch (err) {
        console.error(`[worktree] Merge conflict for track ${trackNumber}: ${err.message}`);
        console.log(`[worktree] Leaving worktree in place for manual conflict resolution`);
        // Leave worktree in place for developer to resolve manually
        return;
      }
    }

    // Remove the worktree
    await removeWorktree(trackNumber);
    console.log(`[worktree] Completed merge and cleanup for track ${trackNumber}`);
  } catch (err) {
    console.error(`[worktree] Error during merge and cleanup: ${err.message}`);
  }
}

async function spawnCli(command, args, label, trackNumber, cli, model, tier, laneStatus, laneConfig = {}, projectId = null, session = null) {
  let lockFile = null;
  let worktreePath = null;

  // Fallback to getting projectId if not provided
  if (!projectId) {
    const proj = getProject();
    projectId = proj?.id;
  }

  if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
    try {
      lockFile = await checkAndClaimGitLock(trackNumber);
      worktreePath = await createWorktree(trackNumber);
    } catch (err) {
      console.error(`[${label}] Failed to setup lock/worktree for track ${trackNumber}: ${err.message}`);
      if (worktreePath) await removeWorktree(trackNumber).catch(() => { });
      if (lockFile) await releaseGitLock(trackNumber).catch(() => { });
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
      const content = readIfExists(path);
      if (content) contextPrompt += `\n<project_context file="${name}">\n${content}\n</project_context>\n`;
    }

    // Track context
    const tracksDir = join(process.cwd(), 'conductor', 'tracks');
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    if (trackDirName) {
      const trackPath = join(tracksDir, trackDirName);
      const trackDocs = {
        'index.md': join(trackPath, 'index.md'),
        'spec.md': join(trackPath, 'spec.md'),
        'plan.md': join(trackPath, 'plan.md'),
        'test.md': join(trackPath, 'test.md'),
        'conversation.md': join(trackPath, 'conversation.md')
      };
      for (const [name, path] of Object.entries(trackDocs)) {
        const content = readIfExists(path);
        if (content) contextPrompt += `\n<track_context file="${name}">\n${content}\n</track_context>\n`;
      }
      contextPrompt += `\nYour workspace is at: ${worktreePath || process.cwd()}\n`;
      contextPrompt += `The track you are working on is in: conductor/tracks/${trackDirName}/\n`;
    }
  } catch (ctxErr) {
    console.warn(`[context] Failed to gather rich context: ${ctxErr.message}`);
  }

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
  const killer = setTimeout(async () => {
    if (runningPids.has(proc.pid)) {
      console.log(`[timeout] killing PID ${proc.pid} after ${timeoutMs}ms`);
      process.kill(-proc.pid, 'SIGTERM');
      await patch(url, token, `/track/${trackNumber}/action`, {
        project_id: projectId,
        lane_action_status: 'failure', lane_action_result: 'timeout',
        auto_planning_launched: null, auto_implement_launched: null, auto_review_launched: null,
        last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    }
  }, timeoutMs);

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
    clearTimeout(killer);
    clearInterval(tailInterval);
    clearInterval(streamTailInterval);
    runningPids.delete(proc.pid);
    runningLaneMap.delete(proc.pid);
    runningTrackMap.delete(proc.pid);
    updateWorkerHeartbeat('idle', null);

    const isSuccess = code === 0;

    // Detect provider quota exhaustion — re-queue without consuming a retry
    let isExhausted = false;
    if (!isSuccess && existsSync(logPath)) {
      const logContent = readFileSync(logPath, 'utf8');
      if ((cli === 'gemini' || cli === 'npx' || cli === 'antigravity' || cli === 'agy') &&
        (logContent.includes('quota will reset after') || logContent.includes('exhausted your capacity') || logContent.includes('code: 429'))) {
        isExhausted = true;
      } else if (cli === 'claude' &&
        (logContent.includes('429') || logContent.includes('Overloaded') || logContent.includes('Rate limit'))) {
        isExhausted = true;
      }
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
    const isConversationRun = label === 'local-fs-answer';
    const transitionValue = isConversationRun
      ? null
      : (isSuccess
        ? (currentLaneConfig?.on_success || workflowConfig?.defaults?.on_success)
        : (isMaxRetries ? (currentLaneConfig?.on_failure || workflowConfig?.defaults?.on_failure) : null));

    const { lane: targetLane, status: nextActionStatus } = resolveTransition(transitionValue, laneStatus, isSuccess, isMaxRetries);

    console.log(`[${label}] Track ${trackNumber}: ${isSuccess ? 'PASS' : 'FAIL'} (exit: ${code}). Next Action Status: ${nextActionStatus}${targetLane !== laneStatus ? `, Moving to: ${targetLane}` : ''}`);

    const patchData = {
      project_id: projectId,
      lane_action_status: nextActionStatus,
      lane_action_result: isSuccess ? 'success' : (isExhausted ? 'provider_exhausted' : (isMaxRetries ? 'max_retries_reached' : `error (code ${code})`)),
      last_log_tail: tailLog(logPath), active_cli: cli,
    };

    // Phase 5: Update Lane Status in files and commit (always execute)
    try {
      const tracksDir = join(process.cwd(), 'conductor', 'tracks');
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

          // 3. Update Progress if success (skip for conversation runs — don't force 100%)

          // 3. Update Progress if success (skip for conversation runs — don't force 100%)
          if (isSuccess && !isConversationRun) {
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

          // 4. Write last run log to the track folder for worker context
          const lastRunLog = tailLog(logPath, 100);
          if (lastRunLog) {
            const lastRunLogPath = join(tracksDir, trackDir, 'last_run.log');
            writeFileSync(lastRunLogPath, lastRunLog, 'utf8');
            const relLogPath = join('conductor', 'tracks', trackDir, 'last_run.log');
            try { execSync(`git add "${relLogPath}"`, { cwd: workDir, stdio: 'pipe' }); } catch (e) { }
          }

          // 5. Write changes and commit to git
          if (updated) {
            const workDir = worktreePath || process.cwd();
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
          const entry = `\n> **system**: Session turn — ${label} (${sessionState} session): ${outcome} (exit ${code}).\n`;
          appendFileSync(convPath, entry, 'utf8');
        }
      } catch (err) {
        console.warn(`[${label}] Failed to append session-turn entry to conversation.md: ${err.message}`);
      }
    }

    if (!getIsLocalFs()) await patch(url, token, `/track/${trackNumber}/action`, patchData).catch(() => { });

    // Cleanup git lock and worktree (API modes only — local-fs skips; LC_SKIP_GIT_LOCK skips in tests)
    if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
      try {
        // ── Copy artifacts from worktree → main repo before cleanup ──────────
        if (worktreePath && existsSync(worktreePath)) {
          const mainTracksDir = join(process.cwd(), 'conductor', 'tracks');
          const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
          const wtTrackDir = existsSync(wtTracksDir)
            ? resolveTrackFolder(wtTracksDir, trackNumber)
            : null;
          if (wtTrackDir) {
            mkdirSync(mainTracksDir, { recursive: true });
            // Use the worktree dir name (preserves the slug created by the agent)
            let mainTrackDir = existsSync(mainTracksDir)
              ? resolveTrackFolder(mainTracksDir, trackNumber)
              : null;
            if (!mainTrackDir) {
              // Planning agent created the dir inside the worktree — copy whole dir to main
              mainTrackDir = wtTrackDir;
              mkdirSync(join(mainTracksDir, mainTrackDir), { recursive: true });
              console.log(`[worktree] Created track dir in main repo: ${mainTrackDir}`);
            }
            const destDir = join(mainTracksDir, mainTrackDir);
            // For index.md: merge status markers into existing file (not full replace)
            // For plan.md, spec.md, conversation.md, quality-gate.md: full replace is fine
            const mergeOnlyArtifacts = new Set(['index.md']);
            const artifacts = ['index.md', 'plan.md', 'spec.md', 'test.md', 'conversation.md', 'quality-gate.md'];
            const copied = [];
            for (const file of artifacts) {
              const src = join(wtTracksDir, wtTrackDir, file);
              const dest = join(destDir, file);
              if (!existsSync(src)) continue;
              if (mergeOnlyArtifacts.has(file) && existsSync(dest)) {
                // Extract status markers from worktree artifact and apply onto existing file
                const artifact = readFileSync(src, 'utf8');
                let existing = readFileSync(dest, 'utf8');
                const markerPatterns = [
                  // Lane and Lane Status are intentionally excluded — the exit handler
                  // always writes the correct values from workflow.json after this merge.
                  { re: /\*\*Progress\*\*:\s*[^\n]+/i, key: 'Progress' },
                  { re: /\*\*Phase\*\*:\s*[^\n]+/i, key: 'Phase' },
                  { re: /\*\*Summary\*\*:\s*[^\n]+/i, key: 'Summary' },
                ];
                for (const { re, key } of markerPatterns) {
                  const m = artifact.match(re);
                  if (!m) continue;
                  if (re.test(existing)) {
                    existing = existing.replace(re, m[0]);
                  }
                  // If marker not in existing file, don't inject it — preserve the file structure
                }
                // Safety guard: If worktree artifact is suspiciously small, don't overwrite.
                const artifactStats = statSync(src);
                const existingStats = statSync(dest);
                const artifactContent = readFileSync(src, 'utf8');
                const lineCount = artifactContent.split('\n').length;

                // Suspicious if < 10 lines OR < 50% of existing OR < 500 bytes for markdown files
                const isSuspicious = (lineCount < 10) || (artifactStats.size < existingStats.size * 0.5 && existingStats.size > 100);

                if (isSuspicious && !isSuccess) {
                  console.warn(`[worktree] Skipping index.md merge: worktree version is suspiciously small/short (${lineCount} lines, ${artifactStats.size}b) and action failed.`);
                } else {
                  writeFileSync(dest, existing, 'utf8');
                }
              } else {
                // Safety guard for full-replace artifacts too (plan.md, spec.md, etc.)
                const srcStats = statSync(src);
                const destStats = existsSync(dest) ? statSync(dest) : { size: 0 };
                const isSuspicious = srcStats.size < destStats.size * 0.5 && destStats.size > 200;

                if (isSuspicious && !isSuccess) {
                  console.warn(`[worktree] Skipping ${file} copy: worktree version is suspiciously small (${srcStats.size}b vs ${destStats.size}b) and action failed.`);
                } else {
                  copyFileSync(src, dest);
                }
              }
              copied.push(file);
            }
            if (copied.length) {
              console.log(`[worktree] Copied artifacts to main repo: ${copied.join(', ')}`);
              // Trigger sync via normal syncTrack path (which includes title)
              const indexPath = join(destDir, 'index.md');
              if (existsSync(indexPath)) {
                await syncTrack(indexPath).catch(e => console.warn(`[worktree] Failed to sync artifacts to DB: ${e.message}`));
              }
            }
          }
        }
        if (lockFile) await releaseGitLock(trackNumber);

        // Worktree lifecycle management
        if (worktreePath) {
          const lifecycle = getWorktreeLifecycle();
          if (lifecycle === 'per-cycle' && targetLane === 'done' && isSuccess) {
            // Per-cycle: Merge and remove worktree on done:success
            console.log(`[worktree] Per-cycle mode: Merging track ${trackNumber} and cleaning up`);
            await mergeAndRemoveWorktree(trackNumber);
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
    return [cmd, [...rest, command, trackNumber], 'mock', 'default', 'primary', session];
  }
  const proj = getProject();
  const primary = laneConfig.primary_cli ?? proj.primary?.cli ?? 'claude';
  const primaryModel = laneConfig.primary_model ?? proj.primary?.model;
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
    const args = ['@google/gemini-cli', '--approval-mode', 'yolo', '-p', `${contextMsg}${prompt}`];
    if (chosenModel) args.push('--model', chosenModel);
    return ['npx', args, chosenCli, chosenModel || 'default', chosenTier];
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

  const dirs = readdirSync(tracksDir)
    .filter(d => /^\d+/.test(d))
    .sort((a, b) => parseInt(a) - parseInt(b));  // process lowest track numbers first

  const currentlyRunningPerLane = {};
  for (const dir of dirs) {
    const indexPath = join(tracksDir, dir, 'index.md');
    if (!existsSync(indexPath)) continue;
    const content = readFileSync(indexPath, 'utf8');
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*running/i);
    if (statusMatch) {
      const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
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

    const trackNumMatch = dir.match(/^(\d+)/);
    if (!trackNumMatch) continue;
    const track_number = trackNumMatch[1];

    const waitingForReply = parseWaitingForReply(content);

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
    if (claimableSet && !waitingForReply && !claimableSet.has(track_number)) continue;

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
    if (alreadyRunning + alreadyClaimed >= laneLimit && !waitingForReply) {
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

      const spawnedPid = await spawnCli(cmd, args, label, track_number, cli, model, tier, lane_status, laneConfig, projectId, session);
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
    try {
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'claimed' });
    } catch (err) {
      console.warn(`[dispatch] Failed to claim dispatch ${entry.id}: ${err.message}`);
      continue;
    }

    if (entry.action === 'deploy') {
      const env = entry.payload?.environment || 'prod';
      console.log(`[dispatch] Running deploy to ${env} (dispatch ${entry.id})`);
      // Track 1087 Phase 6 Task 3: deploy never went through spawnCli, so
      // the worker never reported busy for it — WorkerActivityLatch had
      // nothing to detect. current_task format ("deploy <env> (dispatch
      // <id>)") is parsed by ui/src/lib/workerTaskInfo.js.
      updateWorkerHeartbeat('busy', `deploy ${env} (dispatch ${entry.id})`);
      const result = await runDeploy(process.cwd(), env);
      updateWorkerHeartbeat('idle', null);
      await patch(url, token, `/worker-dispatch/${entry.id}`, {
        status: result.ok ? 'done' : 'failed',
        result: result.ok ? null : (result.error || `exit ${result.exitCode} at step: ${result.failedStep}`),
      }).catch(err => console.warn(`[dispatch] Failed to report deploy result for ${entry.id}: ${err.message}`));
      continue;
    }

    // Lane action dispatch
    const trackNumber = entry.track_number;
    const tracksDir = 'conductor/tracks';
    const trackDirName = trackNumber ? resolveTrackFolder(tracksDir, trackNumber) : null;
    if (!trackDirName) {
      const reason = trackNumber ? 'track not found locally' : 'missing track_number';
      console.warn(`[dispatch] Dispatch ${entry.id}: ${reason}, skipping`);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: reason }).catch(() => { });
      continue;
    }

    const indexPath = join(tracksDir, trackDirName, 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    const laneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
    const lane_status = laneMatch?.[1]?.trim();
    const laneConfig = workflowConfig?.lanes?.[lane_status] ?? {};

    const cliArgs = await buildCliArgs('laneconductor', entry.action, trackNumber, null, laneConfig);
    if (!cliArgs) {
      console.warn(`[dispatch] Dispatch ${entry.id}: no available provider for track ${trackNumber}`);
      await patch(url, token, `/worker-dispatch/${entry.id}`, { status: 'failed', result: 'no provider available' }).catch(() => { });
      continue;
    }

    const [cmd, args, cli, model, tier, session] = cliArgs;
    const updateHeader = (c, h, v) => {
      const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
      return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
    };
    writeFileSync(indexPath, updateHeader(content, 'Lane Status', 'running'), 'utf8');

    const proj = getProject();
    const spawnedPid = await spawnCli(cmd, args, `dispatch-${entry.action}`, trackNumber, cli, model, tier, lane_status, laneConfig, proj?.id, session);
    console.log(`[dispatch] Track ${trackNumber} → ${entry.action} (PID: ${spawnedPid}, dispatch ${entry.id})`);
    activeDispatch.set(trackNumber, entry.id);
  }
}

// Poll in-flight lane-action dispatches for completion (see activeDispatch
// comment above for why this is poll-based rather than an exit callback).
async function reconcileActiveDispatch() {
  if (activeDispatch.size === 0) return;
  const { url, token } = primaryCollector();
  if (!url) return;
  const tracksDir = 'conductor/tracks';

  for (const [trackNumber, dispatchId] of activeDispatch) {
    const trackDirName = resolveTrackFolder(tracksDir, trackNumber);
    const indexPath = trackDirName ? join(tracksDir, trackDirName, 'index.md') : null;
    if (!indexPath || !existsSync(indexPath)) {
      activeDispatch.delete(trackNumber);
      continue;
    }

    const content = readFileSync(indexPath, 'utf8');
    const statusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
    const status = statusMatch?.[1]?.trim();
    if (status === 'running') continue; // still going

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

setInterval(() => {
  checkDispatchInbox().catch(err => console.error('[dispatch error]:', err.message));
}, 10000);
setInterval(() => {
  reconcileActiveDispatch().catch(err => console.error('[dispatch-reconcile error]:', err.message));
}, 5000);

// ── Auto-launch: concurrent guard ────────────────────────────────────────────
let autoLaunchRunning = false;

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
