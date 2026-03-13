#!/usr/bin/env node
// conductor/laneconductor.sync.mjs
// LaneConductor Heartbeat Worker — run via: make lc-start
// Worker has zero DB knowledge — all writes go through the Collector HTTP API.

import { watch } from 'chokidar';
import { readFileSync, existsSync, readdirSync, writeFileSync, openSync, mkdirSync, statSync, rmSync, copyFileSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { createHash } from 'crypto';
import os from 'os';

import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from './constants.mjs';

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
const getCollectors = () => config.collectors || [];
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
  ensureFile('workflow.md', 'conductor/default-workflow.md');
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

// Resolve auth token for a collector entry (machine_token takes priority over static token)
function resolveToken(collector, envKey) {
  return process.env[envKey] ?? collector.machine_token ?? collector.token ?? null;
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
function primaryCollector() {
  if (getIsLocalFs()) return { url: null, token: null };
  const c = getCollectors()[0];
  if (!c) return { url: null, token: null };
  const fallbackToken = process.env.COLLECTOR_0_TOKEN ?? c.token ?? null;
  return { url: c.url, token: c.machine_token || fallbackToken };
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
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    // Priority: COLLECTOR_N_TOKEN (env API key) > machine_token > getUserToken() > static token
    const envKey = `COLLECTOR_${i}_TOKEN`;
    const configuredApiKey = process.env[envKey];
    const token = configuredApiKey || c.machine_token || (isLocal ? null : getUserToken()) || c.token;

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
      const res = await post(url, token, '/worker/register', { hostname, pid, project_id, visibility, mode: workerMode });


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
    try {
      const token = c.machine_token || getUserToken() || c.token;
      const body = { hostname, pid, project_id: proj.id, mode: workerMode };
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
    try {
      const token = c.machine_token || getUserToken() || c.token;
      await del(c.url, token, '/worker', { hostname, pid });
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

if (!existsSync('conductor/logs')) mkdirSync('conductor/logs', { recursive: true });
writeFileSync('conductor/.sync.pid', String(process.pid));

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
  if (!tracksMetadata || !tracksMetadata.tracks) return null;
  return tracksMetadata.tracks[trackNumber] || null;
}

function updateTrackMetadata(trackNumber, updates) {
  if (!tracksMetadata) tracksMetadata = loadTracksMetadata();
  if (!tracksMetadata.tracks) tracksMetadata.tracks = {};
  if (!tracksMetadata.tracks[trackNumber]) {
    tracksMetadata.tracks[trackNumber] = {};
  }
  Object.assign(tracksMetadata.tracks[trackNumber], updates);
  saveTracksMetadata(tracksMetadata);
}

// ── Parsers ───────────────────────────────────────────────────────────────────

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

function parseProgress(content) {
  const markerMatch = content.match(/\*\*Progress\*\*:\s*(\d+)%/i);
  if (markerMatch) return parseInt(markerMatch[1]);

  const total = (content.match(/- \[[ x]\]/g) || []).length;
  if (total === 0) return 0;
  return Math.round(((content.match(/- \[x\]/gi) || []).length / total) * 100);
}

function parseCurrentPhase(content) {
  const markerMatch = content.match(/\*\*Phase\*\*:\s*([^\n]+)/i);
  if (markerMatch) return markerMatch[1].replace(/⏳|✅/g, '').trim();

  const match = content.match(/## Phase \d+: ([^\n⏳]+)⏳/);
  return match ? match[1].trim() : null;
}

function parseSummary(content) {
  const markerMatch = content.match(/\*\*Summary\*\*:\s*([^\n]+)/i);
  if (markerMatch) return markerMatch[1].trim().slice(0, 200);

  const match = content.match(/\*\*Problem\*\*:\s*([^\n]+)/);
  return match ? match[1].trim().slice(0, 200) : null;
}

function parseWaitingForReply(content) {
  const match = content.match(/\*\*Waiting for reply\*\*:\s*([^\n]+)/i);
  return match ? match[1].trim().toLowerCase() === 'yes' : false;
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
      console.error('[sync error] pullWorkflow fetch:', err.message);
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
    console.error('[sync error] pullWorkflow logic:', err.message);
  }
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
    console.error('[sync error] conductor files:', err.message);
  }
}

// ── Track sync ────────────────────────────────────────────────────────────────

async function syncTrack(filepath, laneActionStatus = undefined) {
  if (getIsLocalFs()) return;
  try {
    const trackNumber = extractTrackNumber(filepath);
    const title = extractTitle(filepath);
    const trackDir = dirname(filepath);
    const filename = basename(filepath);

    const trackMeta = getTrackMetadata(trackNumber);
    if (trackMeta && trackMeta.last_db_update) {
      const fileMtime = statSync(filepath).mtimeMs;
      const lastDbUpdateMs = new Date(trackMeta.last_db_update).getTime();
      if (fileMtime < lastDbUpdateMs) return;
    }

    const indexContent = readIfExists(join(trackDir, 'index.md'));
    const planContent = readIfExists(join(trackDir, 'plan.md'));
    const specContent = readIfExists(join(trackDir, 'spec.md'));
    const testContent = readIfExists(join(trackDir, 'test.md'));

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

    // Metadata/Info (Progress, Phase, Summary) can come from plan.md if available
    const primaryInfo = planContent || stateContent;
    const progress = parseProgress(primaryInfo);
    const currentPhase = parseCurrentPhase(primaryInfo);
    const summary = parseSummary(primaryInfo);
    const phaseStep = parsePhaseStep(primaryInfo, laneStatus);

    // Helper to update or append a header
    const updateHeader = (content, header, value) => {
      const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
      if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
      return content.trim() + `\n**${header}**: ${value}\n`;
    };

    const payload = {
      track_number: trackNumber, title, lane_status: laneStatus,
      progress_percent: progress, current_phase: currentPhase,
      content_summary: summary, phase_step: phaseStep,
      waiting_for_reply: waitingForReply,
      index_content: indexContent, plan_content: planContent, spec_content: specContent, test_content: testContent,
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

    await postToCollectors('/track', payload);

    updateTrackMetadata(trackNumber, {
      folder_path: trackDir,
      last_file_update: new Date().toISOString(),
      synced: true
    });

    notifyApi('track:updated', { trackNumber, laneStatus, progress, projectId: getProject()?.id });
    console.log(`[sync] ${trackNumber} → ${laneStatus} (source: ${filename})`);
  } catch (err) {
    console.error(`[sync error] ${filepath}:`, err.message);
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

    // Parse > **author** (optional-options): body blocks from new content
    const lines = newContent.split('\n');
    const comments = [];
    let current = null;
    for (const line of lines) {
      // Matches: > **human**: Hello
      // Matches: > **human** (no-wake): Hello
      const m = line.match(/^> \*\*(\w+)\*\*(?:\s*\(([^)]+)\))?: (.*)$/);
      if (m) {
        if (current) comments.push(current);
        const options = m[2] ? m[2].toLowerCase() : '';
        current = {
          author: m[1],
          body: m[3],
          no_wake: options.includes('no-wake') || options.includes('no-reply') || options.includes('note'),
          is_brainstorm: options.includes('brainstorm'),
          is_replan: options.includes('replan') || options.includes('plan'),
          is_bug: options.includes('bug')
        };
      } else if (current && line.startsWith('>') && !line.match(/^> \*\*/)) {
        current.body += '\n' + line.slice(2).trimStart();
      } else if (current && line.trim() !== '') {
        comments.push(current);
        current = null;
      }
    }
    if (current) comments.push(current);

    if (comments.length === 0) {
      writeFileSync(cursorPath, String(content.length), 'utf8');
      return;
    }

    const proj = getProject();
    for (const c of comments) {
      await postToCollectors(`/track/${trackNumber}/comment`, {
        author: c.author, body: c.body.trim(), no_wake: c.no_wake
      }).catch(err => console.warn(`[conv-sync] post comment failed: ${err.message}`));

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
          await postToCollectors(`/track/${trackNumber}/action`, updates, proj.id)
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
    if (isConvFile(f)) debounce(`conv-${f}`, () => syncConversation(f));
    else if (isTrackFile(f)) debounce(f, () => syncTrack(f));
  })
  .on('change', f => {
    if (isConvFile(f)) debounce(`conv-${f}`, () => syncConversation(f));
    else if (isTrackFile(f)) debounce(f, () => syncTrack(f));
  });

watch(['conductor/code_styleguides'], { ignoreInitial: false })
  .on('add', f => { if (f.endsWith('.md')) debounce('conductor', () => syncConductorFiles()); })
  .on('change', f => { if (f.endsWith('.md')) debounce('conductor', () => syncConductorFiles()); });

watch([
  'conductor/product.md', 'conductor/tech-stack.md',
  'conductor/product-guidelines.md', 'conductor/quality-gate.md',
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
      const trackDir = readdirSync(tracksDir).find(d => d.startsWith(row.track_number + '-'));
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

// ── Auto-implement + auto-review ──────────────────────────────────────────────

const runningPids = new Set();

async function checkFileSyncQueue() {
  if (getIsLocalFs()) return;

  const cls = getCollectors();
  const proj = getProject();
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    const url = c.url;
    const token = c.machine_token || getUserToken() || c.token;

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
          console.error(`[sync-queue] Failed task ${task.id} from ${url}:`, err.message);
          await patch(url, token, `/file-sync/${task.id}`, { status: 'error', error_message: err.message });
        }
      }
    } catch (err) {
      console.error(`[sync-queue error] ${url}:`, err.message);
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
  const existingDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
  if (existingDir) {
    console.log(`[file-queue] Track ${trackNumber} folder already exists (${existingDir}), skipping folder creation`);
    // Still sync to DB — the normal chokidar/syncTrack path handles this
    const indexPath = join(tracksDir, existingDir, 'index.md');
    if (existsSync(indexPath)) {
      await syncTrack(indexPath).catch(e =>
        console.warn(`[file-queue] Failed to syncTrack for existing ${trackNumber}: ${e.message}`)
      );
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
    } catch (err) {
      console.warn(`[file-queue] Failed to register track ${trackNumber} in DB: ${err.message}`);
      // Don't fail — folder was created, DB can sync later via normal heartbeat
    }
  }

  // Sync the new index.md to DB via normal syncTrack path
  await syncTrack(join(trackPath, 'index.md')).catch(e =>
    console.warn(`[file-queue] Failed to syncTrack for ${trackNumber}: ${e.message}`)
  );

  moveEntryToCompleted(queuePath, entry.heading, 'processed');
  console.log(`[file-queue] Processed track-create for track ${trackNumber}`);
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

  if ((geminiMatch && (hasHours || hasMins || hasSecs) || content.includes('exhausted your capacity') || content.includes('code: 429')) && (cli === 'gemini' || cli === 'npx')) {
    const hours = parseInt(geminiMatch?.[1] || 0);
    const mins = parseInt(geminiMatch?.[2] || 0);
    const secs = parseInt(geminiMatch?.[3] || 0);
    const resetMs = (hours * 3600 + mins * 60 + secs) * 1000;
    const resetAt = new Date(Date.now() + (resetMs > 0 ? resetMs : 60000));
    // Only POST if status changed in cache
    const cached = providerStatusCache.get('gemini');
    if (!cached || cached.status !== 'exhausted') {
      console.log(`[exhaustion] Gemini exhausted! Reset in ${hours}h ${mins}m ${secs}s -> ${resetAt.toISOString()}`);

      // Update in-memory cache
      providerStatusCache.set('gemini', {
        status: 'exhausted',
        reset_at: resetAt.toISOString(),
        last_error: 'Quota exhausted'
      });

      await post(url, token, '/provider-status', {
        provider: 'gemini', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Quota exhausted'
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
      const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
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

async function spawnCli(command, args, label, trackNumber, cli, model, tier, laneStatus, laneConfig = {}) {
  let lockFile = null;
  let worktreePath = null;

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
    const trackDirName = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
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

  // Inject context into the prompt (usually follows -p)
  if (contextPrompt) {
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
      const existing = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
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
        lane_action_status: 'failure', lane_action_result: 'timeout',
        auto_planning_launched: null, auto_implement_launched: null, auto_review_launched: null,
        last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    }
  }, timeoutMs);

  const tailInterval = setInterval(async () => {
    if (runningPids.has(proc.pid)) {
      await patch(url, token, `/track/${trackNumber}/action`, {
        last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    } else {
      clearInterval(tailInterval);
    }
  }, 5000);

  proc.unref();
  runningPids.add(proc.pid);
  runningLaneMap.set(proc.pid, laneStatus);
  runningTrackMap.set(proc.pid, trackNumber);
  proc.on('exit', async (code) => {
    console.log(`[${label}] EXIT EVENT TRIGGERED: PID ${proc.pid}, Code: ${code}`);
    clearTimeout(killer);
    clearInterval(tailInterval);
    runningPids.delete(proc.pid);
    runningLaneMap.delete(proc.pid);
    runningTrackMap.delete(proc.pid);
    updateWorkerHeartbeat('idle', null);

    const isSuccess = code === 0;

    // Detect provider quota exhaustion — re-queue without consuming a retry
    let isExhausted = false;
    if (!isSuccess && existsSync(logPath)) {
      const logContent = readFileSync(logPath, 'utf8');
      if ((cli === 'gemini' || cli === 'npx') &&
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
    }

    // 1. Check retry count using latest config (in case workflow.json reloaded)
    const currentLaneConfig = workflowConfig?.lanes?.[laneStatus] || laneConfig;
    let failCountBefore = 0;
    const maxRetries = currentLaneConfig.max_retries ?? workflowConfig?.defaults?.max_retries ?? 1;

    if (getIsLocalFs()) {
      const tracksDir = join(process.cwd(), 'conductor', 'tracks');
      const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
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
      lane_action_status: nextActionStatus,
      lane_action_result: isSuccess ? 'success' : (isExhausted ? 'provider_exhausted' : (isMaxRetries ? 'max_retries_reached' : `error (code ${code})`)),
      last_log_tail: tailLog(logPath), active_cli: cli,
    };

    // Phase 5: Update Lane Status in files and commit (always execute)
    try {
      const tracksDir = join(process.cwd(), 'conductor', 'tracks');
      const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
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
          if (targetLane && targetLane !== laneStatus) {
            patchData.lane_status = targetLane;
          }

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

    if (!getIsLocalFs()) await patch(url, token, `/track/${trackNumber}/action`, patchData).catch(() => { });

    // Cleanup git lock and worktree (API modes only — local-fs skips; LC_SKIP_GIT_LOCK skips in tests)
    if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK) {
      try {
        // ── Copy artifacts from worktree → main repo before cleanup ──────────
        if (worktreePath && existsSync(worktreePath)) {
          const mainTracksDir = join(process.cwd(), 'conductor', 'tracks');
          const wtTracksDir = join(worktreePath, 'conductor', 'tracks');
          const wtTrackDir = existsSync(wtTracksDir)
            ? readdirSync(wtTracksDir).find(d => d.startsWith(`${trackNumber}-`))
            : null;
          if (wtTrackDir) {
            mkdirSync(mainTracksDir, { recursive: true });
            // Use the worktree dir name (preserves the slug created by the agent)
            let mainTrackDir = existsSync(mainTracksDir)
              ? readdirSync(mainTracksDir).find(d => d.startsWith(`${trackNumber}-`))
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
        author: cli === 'npx' ? 'worker' : cli,
        body: commentBody,
      }).catch(() => { });
    }
    console.log(`[${label}] Process ${proc.pid} exited with code ${code}`);
  });

  console.log(`[${label}] Launched (PID: ${proc.pid}) — ${command} ${args.join(' ')}`);
  return proc.pid;
}

async function buildCliArgs(skill, command, trackNumber, customPrompt = null, laneConfig = {}) {
  // LC_MOCK_CLI overrides the CLI for testing (e.g. node conductor/tests/mock-cli.mjs)
  if (process.env.LC_MOCK_CLI) {
    const [cmd, ...rest] = process.env.LC_MOCK_CLI.split(' ');
    return [cmd, [...rest, command, trackNumber], 'mock', 'default', 'primary'];
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
  if (chosenCli === 'claude') {
    // Inject skill context even for Claude to ensure it uses the right skill definition
    const fullPrompt = customPrompt ? `${contextMsg}\n\n${prompt}` : prompt;
    const args = ['--dangerously-skip-permissions', '-p', fullPrompt];
    if (chosenModel) args.push('--model', chosenModel);
    return ['claude', args, chosenCli, chosenModel || 'default', chosenTier];
  }
  const args = ['-p', `${contextMsg}${prompt}`];
  if (chosenModel) args.push('--model', chosenModel);
  return [chosenCli, args, chosenCli, chosenModel || 'default', chosenTier];
}

setInterval(() => checkFileSyncQueue(), 5000);
setInterval(() => processFileSyncQueue().catch(e => console.error('[file-queue error]:', e.message)), 5000);

// ── Local-fs auto-launch (Mode 1: no API) ─────────────────────────────────────
// Scans conductor/tracks/*/index.md for queued tracks, respects workflow.json limits.
async function autoLaunchLocalFs(globalLimit) {
  const tracksDir = 'conductor/tracks';
  if (!existsSync(tracksDir)) return;

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

    // Normally only process 'queue' status
    // EXCEPTION: if we are answering a human, bypass 'queue' check
    if (lane_action_status !== 'queue' && !waitingForReply) continue;

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
      const [cmd, args, cli, model, tier] = cliArgs;
      
      // Update file to running status so UI/tests can see it
      const updateHeader = (content, header, value) => {
        const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
        if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
        return content.trim() + `\n**${header}**: ${value}\n`;
      };
      const runningContent = updateHeader(content, 'Lane Status', 'running');
      writeFileSync(indexPath, runningContent, 'utf8');

      const spawnedPid = await spawnCli(cmd, args, label, track_number, cli, model, tier, lane_status, laneConfig);
      lanesClaimedThisRound.set(lane_status, alreadyClaimed + 1);
      console.log(`[local-fs] Track ${track_number} → ${laneConfig.auto_action} (PID: ${spawnedPid})`);
    } catch (err) {
      console.error(`[local-fs] Failed to spawn track ${track_number}:`, err.message);
    }
  }
}

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
      await autoLaunchLocalFs(globalLimit);
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
