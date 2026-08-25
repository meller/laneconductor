// conductor/tests/playwright/helpers/scoped-worker.mjs
// Track 10021: gives a Playwright spec its own throwaway worker instead of
// depending on an ambient `lc worker start --sync-and-work` process that can
// claim ANY queued track. See conductor/tracks/10021-*/spec.md for the F1-F6
// findings this module exists to route around — each function below names
// the finding it addresses.
//
// Zero extra deps beyond Node builtins + global fetch, same spirit as
// conductor/tests/mock-collector.mjs.

import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// helpers/ is nested one level deeper than the specs it serves (conductor/tests/playwright/),
// so this needs one more '..' than PROJECT_ROOT in the specs themselves.
export const PROJECT_ROOT = join(__dirname, '../../../..');
export const DEFAULT_API_URL = 'http://localhost:8091';
export const DEFAULT_PROJECT_ID = 1;

const MAIN_MODE_BLOCKED_MARKER = '⚠️ Main-mode run blocked';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Pure functions (unit-tested directly — see track-10021-scoped-worker.test.mjs) ──

/**
 * F3: `conductor/laneconductor.sync.mjs` unconditionally overwrites
 * `conductor/.sync.pid` at worker_number 1, and `lc worker run` defaults to
 * 1. A scoped worker must never use 1, or it clobbers the ambient worker's
 * pidfile and makes `lc worker stop`/`status` target a dead PID.
 *
 * Derived from the PID (not a fixed constant) so two concurrent runs of the
 * same suite can't collide either — the same lesson track 1100 Review #3
 * recorded about a fixed `worker_number: 99`. Reserved range 9000-9999:
 * comfortably outside any worker_number a real deployment would assign by
 * hand, and never touches 1.
 */
export function deriveWorkerNumber(pid = process.pid) {
  const RESERVED_BASE = 9000;
  const RESERVED_SPAN = 1000;
  return RESERVED_BASE + (Math.abs(pid) % RESERVED_SPAN);
}

/**
 * F4/REQ-5: mirrors the worker's own main-mode dirty-checkout filter
 * (`laneconductor.sync.mjs`'s workspaceMode === 'main' guard) so the helper
 * can fail BEFORE spawning rather than let the worker discover the same
 * problem and hang (F2 means a never-claimable/never-spawnable track doesn't
 * report why on its own).
 *
 * `trackDirNames` may be more than one (Phase 4 scopes two tracks to one
 * worker) — a path is disqualifying only if it falls outside ALL of them.
 */
export function classifyDirtyPaths(dirtyPaths, trackDirNames = []) {
  // Track 10021: file_sync_queue.md is exempted alongside tracks-metadata.json
  // for the same reason — every track creation appends an entry to it, so a
  // track's OWN creation always leaves it dirty outside any track's own
  // folder. Mirrors the identical exemption in laneconductor.sync.mjs's
  // own main-mode guard (see the comment there for the full discovery).
  const isWorkerBookkeeping = (p) => /^conductor\/\.[^/]+$/.test(p) || p === 'conductor/tracks-metadata.json' || p === 'conductor/tracks/file_sync_queue.md';
  const isOwnFolder = (p) => trackDirNames.some(name => p.startsWith(`conductor/tracks/${name}/`));
  return dirtyPaths.filter(p => !isOwnFolder(p) && !isWorkerBookkeeping(p));
}

/**
 * F4/REQ-5: detects the exact marker the worker writes to conversation.md
 * when it refuses a main-mode spawn on a dirty checkout
 * (`laneconductor.sync.mjs`'s "⚠️ Main-mode run blocked" comment), so a wait
 * loop can abort immediately instead of waiting out its full timeout.
 */
export function isMainModeBlocked(conversationContent) {
  return typeof conversationContent === 'string' && conversationContent.includes(MAIN_MODE_BLOCKED_MARKER);
}

/**
 * REQ-1: resolves a track's directory by number prefix, tolerating both the
 * legacy `NNN-slug` layout the UI's track-create endpoint still writes and
 * the `INITIALS-NNN-slug` layout `/laneconductor newTrack` uses. Numeric
 * comparison (not string) so zero-padding differences ("008" vs "8") don't
 * cause a false miss.
 */
export function resolveTrackDir(projectRoot, trackNumber) {
  const tracksDir = join(projectRoot, 'conductor', 'tracks');
  if (!existsSync(tracksDir)) return null;
  const target = String(parseInt(trackNumber, 10));
  const entries = readdirSync(tracksDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of entries) {
    const m = d.name.match(/^(?:[A-Za-z]+-)?(\d+)(?:-|$)/);
    if (m && String(parseInt(m[1], 10)) === target) return d.name;
  }
  return null;
}

function tailLog(logPath, lines = 40) {
  try {
    return readFileSync(logPath, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '(scoped worker log unavailable)';
  }
}

// ── IO / orchestration ──────────────────────────────────────────────────────

export async function getTrackByNumber(trackNumber, { apiUrl = DEFAULT_API_URL, projectId = DEFAULT_PROJECT_ID } = {}) {
  const r = await fetch(`${apiUrl}/api/projects/${projectId}/tracks`);
  const data = await r.json();
  const list = Array.isArray(data) ? data : data.tracks ?? [];
  return list.find(t => String(t.track_number) === String(trackNumber)) ?? null;
}

/**
 * Discovered live: `PROJECT_ROOT` (derived from this helper file's own
 * on-disk location) is only correct when the spec runs from the SAME
 * checkout the target project's DB row points at. ui/server/index.mjs's
 * track-create handler writes index.md/plan.md/spec.md under the
 * project's own `repo_path` column — which, for project 1 in this repo,
 * is the PRIMARY checkout, not whatever worktree a lane action (including
 * this track's own implement run) happens to execute from. A spec running
 * from a worktree that assumed `PROJECT_ROOT` would silently look for
 * newly-created track directories in the wrong tree and get `null` every
 * time. Callers must resolve this once and thread it through every
 * subsequent helper call (createTrackViaUI, enableAutoRun,
 * assertCheckoutSpawnable's `cwd`, spawnScopedWorker) rather than relying
 * on PROJECT_ROOT for anything that touches a project's own files.
 */
export async function resolveProjectRepoPath({ apiUrl = DEFAULT_API_URL, projectId = DEFAULT_PROJECT_ID } = {}) {
  const r = await fetch(`${apiUrl}/api/projects`);
  if (!r.ok) throw new Error(`resolveProjectRepoPath: GET /api/projects failed (${r.status})`);
  const data = await r.json();
  const list = Array.isArray(data) ? data : data.projects ?? [];
  const project = list.find(p => String(p.id) === String(projectId));
  if (!project?.repo_path) {
    throw new Error(`resolveProjectRepoPath: project ${projectId} not found or has no repo_path`);
  }
  return project.repo_path;
}

/**
 * REQ-1 Task 1: drives the New Track modal, intercepts the track-create
 * response, and resolves the folder it wrote — the UI's POST handler
 * (ui/server/index.mjs) creates index.md/plan.md/spec.md synchronously in
 * the same request, so the folder is guaranteed to exist by the time this
 * returns, PROVIDED `projectRoot` is the project's actual repo_path (see
 * resolveProjectRepoPath above) rather than the default.
 */
export async function createTrackViaUI(page, { title, description = 'Automated Playwright e2e track', projectId = DEFAULT_PROJECT_ID, projectRoot = PROJECT_ROOT } = {}) {
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});

  const newTrackBtn = page.getByTitle(/New Track/i).first();
  await newTrackBtn.click();

  const projectSelect = page.getByRole('combobox').first();
  await projectSelect.selectOption(String(projectId));

  await page.getByPlaceholder(/Auth middleware|Login fails/i).fill(title);
  await page.getByPlaceholder(/What problem|Steps to reproduce/i).fill(description);

  const submitBtn = page.getByRole('button', { name: /Create Track/i });
  const [createResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/projects/') && r.url().includes('/tracks') && r.request().method() === 'POST', { timeout: 15000 }),
    submitBtn.click(),
  ]);
  const data = await createResp.json();
  const trackNumber = String(data.track_number ?? '');
  if (!trackNumber) throw new Error('createTrackViaUI: response did not include track_number');

  const trackDir = resolveTrackDir(projectRoot, trackNumber);
  return { trackNumber, trackDir };
}

/**
 * F1/REQ-2: `auto_run` defaults false and `--only-tracks` cannot bypass it —
 * a UI-created track is never claimed without this. Doesn't trust the HTTP
 * 200 alone (TC-7): the worker reads index.md's `**Auto Run**` marker off
 * disk, so this polls until the write has actually landed.
 */
export async function enableAutoRun(request, trackNumber, { apiUrl = DEFAULT_API_URL, projectId = DEFAULT_PROJECT_ID, projectRoot = PROJECT_ROOT, timeoutMs = 15000 } = {}) {
  const res = await request.patch(`${apiUrl}/api/projects/${projectId}/tracks/${trackNumber}/auto-run`, {
    data: { auto_run: true },
  });
  if (!res.ok()) throw new Error(`enableAutoRun: PATCH failed (${res.status()}): ${await res.text()}`);

  const dirName = resolveTrackDir(projectRoot, trackNumber);
  if (!dirName) throw new Error(`enableAutoRun: no track directory found for ${trackNumber} under ${projectRoot}/conductor/tracks`);
  const indexPath = join(projectRoot, 'conductor/tracks', dirName, 'index.md');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(indexPath) && /\*\*Auto Run\*\*:\s*yes/i.test(readFileSync(indexPath, 'utf8'))) return;
    await sleep(300);
  }
  throw new Error(`enableAutoRun: **Auto Run**: yes did not land in ${indexPath} within ${timeoutMs}ms`);
}

/**
 * F4/REQ-5: fail before spawning rather than let the worker discover a dirty
 * checkout and refuse silently (see classifyDirtyPaths above).
 */
export function assertCheckoutSpawnable(trackDirNames, { cwd = process.cwd() } = {}) {
  let dirtyPaths;
  try {
    dirtyPaths = execSync('git status --porcelain', { cwd, encoding: 'utf8' })
      .split('\n').map(l => l.slice(3).trim()).filter(Boolean);
  } catch {
    dirtyPaths = [];
  }
  const disqualifying = classifyDirtyPaths(dirtyPaths, trackDirNames);
  if (disqualifying.length > 0) {
    throw new Error(
      `assertCheckoutSpawnable: clean the checkout first — the primary checkout has ` +
      `uncommitted changes outside the scoped track folder(s) [${trackDirNames.join(', ')}]: ${disqualifying.join(', ')}`
    );
  }
}

/**
 * F3/REQ-3: spawns a throwaway worker scoped to exactly `trackNumbers`,
 * under a run-unique worker number that is never 1. Invokes
 * laneconductor.sync.mjs directly (not `lc worker run`) so this module owns
 * the worker-number choice end to end.
 */
export function spawnScopedWorker(trackNumbers, { projectRoot = PROJECT_ROOT, workerNumber, logDir } = {}) {
  const numbers = trackNumbers.map(String);
  const n = workerNumber ?? deriveWorkerNumber();
  if (n === 1) throw new Error('spawnScopedWorker: refusing worker-number 1 — would clobber the ambient worker\'s .sync.pid (F3)');

  const dir = logDir ?? join(projectRoot, '.test-tmp-scoped-worker');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `worker-${n}-${Date.now()}.log`);
  const logFd = openSync(logPath, 'a');

  const syncScript = join(projectRoot, 'conductor/laneconductor.sync.mjs');
  const proc = spawn(
    'node',
    [syncScript, '--only-tracks', numbers.join(','), '--once', '--worker-number', String(n)],
    { cwd: projectRoot, stdio: ['ignore', logFd, logFd] }
  );

  return { proc, workerNumber: n, logPath, trackNumbers: numbers, projectRoot };
}

/**
 * F2/REQ-4: every wait is bounded, and on expiry names the actual stuck
 * state instead of a bare timeout. Also implements the F4 abort-on-blocked
 * behavior (Task 6) and the TC-8 "typo track number" case: if the scoped
 * worker process has already exited abnormally, stop waiting immediately
 * rather than idling out the full timeout.
 */
export async function waitForLaneAction(handle, trackNumber, predicate, { timeoutMs = 60000, apiUrl = DEFAULT_API_URL, projectId = DEFAULT_PROJECT_ID, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const trackDirName = resolveTrackDir(handle.projectRoot, trackNumber);
  const convPath = trackDirName ? join(handle.projectRoot, 'conductor/tracks', trackDirName, 'conversation.md') : null;

  while (Date.now() < deadline) {
    if (convPath && existsSync(convPath)) {
      const content = readFileSync(convPath, 'utf8');
      if (isMainModeBlocked(content)) {
        const idx = content.indexOf(MAIN_MODE_BLOCKED_MARKER);
        const line = content.slice(idx).split('\n')[0];
        throw new Error(`waitForLaneAction: aborted — track ${trackNumber} reported: ${line}`);
      }
    }

    const track = await getTrackByNumber(trackNumber, { apiUrl, projectId }).catch(() => null);
    if (track && predicate(track)) return track;

    if (handle.proc && handle.proc.exitCode !== null && handle.proc.exitCode !== 0) {
      throw new Error(
        `waitForLaneAction: scoped worker exited early (code ${handle.proc.exitCode}) before track ${trackNumber} ` +
        `reached the expected state.\n  scoped worker log tail (${handle.logPath}):\n${tailLog(handle.logPath)}`
      );
    }

    await sleep(pollMs);
  }

  const track = await getTrackByNumber(trackNumber, { apiUrl, projectId }).catch(() => null);
  throw new Error(
    `waitForLaneAction: timed out after ${timeoutMs}ms waiting for track ${trackNumber}.\n` +
    `  lane=${track?.lane_status ?? '?'} lane_action_status=${track?.lane_action_status ?? '?'} auto_run=${track?.auto_run ?? '?'}\n` +
    `  scoped worker log tail (${handle.logPath}):\n${tailLog(handle.logPath)}`
  );
}

/**
 * REQ-6/F6: removes everything this module created — kills the scoped
 * worker (SIGTERM, then SIGKILL after a grace period), deletes the track
 * directories, and deletes the DB rows. Safe to call even when the test body
 * threw (callers should invoke this from a finally/afterEach).
 */
export async function cleanup(handle, trackNumbers, { apiUrl = DEFAULT_API_URL, projectId = DEFAULT_PROJECT_ID, projectRoot, graceMs = 3000 } = {}) {
  if (handle?.proc && handle.proc.exitCode === null && handle.proc.signalCode === null) {
    try {
      handle.proc.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => handle.proc.once('exit', resolve)),
        sleep(graceMs),
      ]);
      if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
        handle.proc.kill('SIGKILL');
      }
    } catch { /* already dead */ }
  }

  // Found live in quality-gate verification: assertCheckoutSpawnable can
  // throw BEFORE spawnScopedWorker ever runs — exactly this track's own
  // negative path (F4/AC-5) — leaving `handle` null. The old
  // `handle?.projectRoot ?? PROJECT_ROOT` fallback then resolved to this
  // helper file's own on-disk location instead of wherever the tracks were
  // actually created (createTrackViaUI's caller-resolved repo_path),
  // silently failing to find and delete the real directories. Callers must
  // now pass the same `projectRoot` they resolved for creation; PROJECT_ROOT
  // remains only as a last-resort default when neither is available.
  const resolvedProjectRoot = projectRoot ?? handle?.projectRoot ?? PROJECT_ROOT;
  for (const trackNumber of trackNumbers) {
    await fetch(`${apiUrl}/api/projects/${projectId}/tracks/${trackNumber}`, { method: 'DELETE' }).catch(() => {});
    const dirName = resolveTrackDir(resolvedProjectRoot, trackNumber);
    if (dirName) {
      rmSync(join(resolvedProjectRoot, 'conductor/tracks', dirName), { recursive: true, force: true });
    }
  }
}
