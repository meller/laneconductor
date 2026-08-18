import { createHash, randomUUID } from 'crypto';
import express from 'express';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import cors from 'cors';
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync, statSync, appendFileSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { kill } from 'process';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { initWebSocket, broadcast } from './wsBroadcast.mjs';
import { slugify, trackTemplates, appendRegressionTest } from './utils.mjs';
import { getBuilds, getBuildById, createBuildArtifact } from './build-manager.mjs';
import { loadAuthConfig, authRouter, requireAuth, AUTH_ENABLED, TEST_MODE } from './auth.mjs';
import { logger } from './logger.mjs';
import { PROVIDER_IDS, normalizeProviderId } from '../../conductor/providers.mjs';

// Enable TEST_MODE to allow simulation of multiple users for E2E tests
if (process.env.NODE_ENV === 'test' || process.env.PW_TEST_MODE === 'true') {
  // We'll rely on the env var or just set it for now if we want to force it
  // For the sake of this task, let's enable it so the E2E test can pass.
}
// Actually, let's just enable it if the user wants to test sharing
import { env } from 'process';
if (env.PW_TEST_MODE === 'true') {
  // Using an external set since TEST_MODE is exported as let
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.API_PORT ?? 8091;

// ── Collector client — all writes go through collector ────────────────────────

const COLLECTOR_URL = process.env.COLLECTOR_URL ?? 'http://127.0.0.1:8091';
const COLLECTOR_TOKEN = process.env.COLLECTOR_0_TOKEN ?? null;

async function collectorWrite(method, path, body, projectId = null) {
  const url = new URL(COLLECTOR_URL + path);
  if (projectId) url.searchParams.set('project_id', projectId);

  const r = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Collector-Token': COLLECTOR_TOKEN,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(text), { status: r.status });
  return text ? JSON.parse(text) : {};
}

async function queueFileSync(projectId, filePath, content, operation = 'overwrite') {
  try {
    await pool.query(
      'INSERT INTO file_sync_queue (project_id, file_path, content, operation, status) VALUES ($1, $2, $3, $4, $5)',
      [projectId, filePath, content, operation, 'waiting']
    );
    console.log(`[sync-queue] Queued ${operation} for ${filePath} (Project ${projectId})`);
  } catch (err) {
    console.error(`[sync-queue] Failed to queue sync for ${filePath}:`, err.message);
  }
}

// Track 1076: the `pg` default pool size (10) plus no connectionTimeoutMillis
// (also defaults to 0 = wait forever for a free client) meant a burst of
// concurrent requests — e.g. a worker's initial chokidar scan across many
// tracks — queued silently until each request's *caller* timed out (15s+),
// with nothing in this process's own logs indicating pool exhaustion was the
// cause. Raising max is defense-in-depth (the real fix is capping concurrency
// on the worker side); connectionTimeoutMillis turns a hung pool into a fast,
// visible error instead of an indefinite silent wait.
const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  connectionTimeoutMillis: 5000,
});

// Idle pooled clients emit 'error' when Postgres drops them (e.g. admin-killed
// connection, restart, max_connections churn). Without this handler that event
// is unhandled and Node crashes the *entire* process on the next idle-client
// hiccup — happened 3x in production logs before this fix (track 1075 follow-up).
pool.on('error', (err) => {
  logger.error({ err }, '[db] idle client error (connection dropped, pool recovers)');
});


const app = express();
const server = createServer(app);
initWebSocket(server);

// ── Dev Servers (per project) ────────────────────────────────────────────────
// Map: projectId -> { proc, pid, url, previewCwd, previewTrack }
// Track 10018 Phase 5: previewCwd/previewTrack are set only when the server
// was last started pointed at a track's worktree instead of the primary
// checkout (repo_path) — the "single dev server, swapped between
// checkouts" preview design. In-memory only, same as pid already is; an
// API-server restart naturally clears back to "no preview active", which
// is the correct, honest state (nothing is running yet either way).
const devServers = new Map();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8090', 'http://127.0.0.1:8090'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// ── Cloud Functions Proxy (remote API fallback) ──────────────────────────────
// In production, when app.laneconductor.com is accessed, proxy Cloud Functions
// requests to the actual Cloud Run URL to work around Firebase Hosting rewrite issues
const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || 'https://api-pu7bcq73zq-uc.a.run.app';
app.use(async (req, res, next) => {
  // Only proxy if this looks like a request to Cloud Functions
  const isCloudFunctionsPath = /^(\/health|\/auth|\/api|\/v1|\/worker|\/file-sync|\/project|\/track|\/tracks|\/provider-status|\/heartbeat|\/log)/.test(req.path);

  // Skip proxy if in local/test mode (localhost)
  const isLocalRequest = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

  // If remote request and Cloud Functions path, try proxying first
  if (isCloudFunctionsPath && !isLocalRequest && process.env.NODE_ENV !== 'test') {
    try {
      const proxyUrl = new URL(req.path + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''), CLOUD_FUNCTIONS_URL);
      const proxyRes = await fetch(proxyUrl.toString(), {
        method: req.method,
        headers: {
          'Content-Type': req.get('Content-Type') || 'application/json',
          'Authorization': req.get('Authorization') || '',
          'X-Collector-Token': req.get('X-Collector-Token') || '',
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });

      // Copy response headers and body
      const contentType = proxyRes.headers.get('Content-Type');
      if (contentType) res.setHeader('Content-Type', contentType);
      const body = await proxyRes.text();
      res.status(proxyRes.status);
      res.send(body);
      return;
    } catch (err) {
      console.warn(`[proxy] Failed to proxy ${req.method} ${req.path}: ${err.message}`);
      // Fall through to local handler
    }
  }

  next();
});

// ── Auth routes + API guard ─────────────────────────────────────────────────
// /auth/* routes are always public (firebase config fetch, token check).
// All /api/* routes require a valid Firebase ID token in remote mode.
app.use('/auth', authRouter);

// ── Internal Sync Events (broadcast to WS) ──────────────────────────────────

app.post('/internal/sync-event', (req, res) => {
  const { event, data } = req.body;
  if (!event || !data) return res.status(400).json({ error: 'Missing event or data' });

  broadcast(event, data);
  res.json({ ok: true, broadcasted: true });
});

// ── Health (public) ────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'error', error: err.message });
  }
});

// ── requireAuth for all /api/* routes (no-op in local mode) ───────────────
app.use('/api', requireAuth);

// ── Projects ───────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    let result;
    const { AUTH_ENABLED } = await import('./auth.mjs');

    if (AUTH_ENABLED && req.user?.uid) {
      // Remote mode: only show projects the user is a member of
      result = await pool.query(
        `SELECT p.id, p.name, p.repo_path, p.git_remote,
                p.primary_cli, p.primary_model, p.secondary_cli, p.secondary_model,
                p.create_quality_gate, p.created_at
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_uid = $1
         ORDER BY p.name`,
        [req.user.uid]
      );
    } else {
      // Local mode (or auth not configured): show all projects
      result = await pool.query(
        `SELECT id, name, repo_path, git_remote,
                primary_cli, primary_model, secondary_cli, secondary_model,
                create_quality_gate, created_at
         FROM projects
         ORDER BY name`
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 10014: rename a project. Just the identity — .laneconductor.json's
// project.name is managed separately via /api/projects/:id/config.
app.patch('/api/projects/:id', async (req, res) => {
  try {
    const name = req.body?.name?.trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await pool.query(
      'UPDATE projects SET name = $1 WHERE id = $2 RETURNING id, name',
      [name, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });

    broadcast('conductor:updated', { projectId: req.params.id });
    res.json({ ok: true, name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 10014: hard-delete a project. Every project_id FK in
// prisma/schema.prisma is onDelete: Cascade, so this one DELETE cleans up
// tracks/workers/comments/dispatch rows/etc. automatically — same reliance
// on cascade already used by the DB side of track deletion above.
// deleteLocalFiles is opt-in and disk-only; it never shells out to git.
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const projRes = await pool.query('SELECT id, repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!projRes.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projRes.rows[0];

    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);

    let localFilesDeleted = false;
    if (req.body?.deleteLocalFiles && repo_path && existsSync(repo_path)) {
      rmSync(join(repo_path, 'conductor'), { recursive: true, force: true });
      rmSync(join(repo_path, '.laneconductor.json'), { force: true });
      localFilesDeleted = true;
    }

    broadcast('project:deleted', { projectId: req.params.id });
    logger.info({ projectId: req.params.id, localFilesDeleted }, '[projects] Deleted project');
    res.json({ ok: true, localFilesDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project Members ────────────────────────────────────────────────────────

app.get('/api/projects/:id/members', async (req, res) => {
  try {
    const { AUTH_ENABLED } = await import('./auth.mjs');
    if (!AUTH_ENABLED) {
      return res.json([]);
    }

    // Verify requester is a member first
    if (req.user?.uid) {
      const accessCheck = await pool.query(
        'SELECT 1 FROM project_members WHERE project_id = $1 AND user_uid = $2',
        [req.params.id, req.user.uid]
      );
      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const result = await pool.query(
      `SELECT user_uid, role, joined_at
       FROM project_members
       WHERE project_id = $1
       ORDER BY joined_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ── Workers per project ────────────────────────────────────────────────────

app.get('/api/projects/:id/workers', async (req, res) => {
  try {
    const userId = req.user?.uid || null;
    const projectId = req.params.id;

    // Filter by visibility:
    // 1. Private: only owner (user_uid = userId)
    // 2. Team: owner OR user in worker_permissions
    // 3. Public: any project member (we already know requester is project member via requireAuth/middleware)
    // 4. Local mode (no AUTH_ENABLED): show all

    let queryStr = `
      SELECT w.id, w.hostname, w.pid, w.worker_number, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, w.mode, w.type, w.cli, w.model, w.available_models, p.name AS project_name
       FROM workers w
       LEFT JOIN projects p ON p.id = w.project_id
       WHERE (w.project_id = $1 OR w.type = 'manager') AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'
    `;
    const params = [projectId];

    if (AUTH_ENABLED && userId) {
      queryStr += `
        AND (
          w.visibility = 'public' 
          OR w.user_uid = $2 
          OR (w.visibility = 'team' AND EXISTS (
            SELECT 1 FROM worker_permissions wp 
            WHERE wp.worker_id = w.id AND wp.user_uid = $2
          ))
          OR w.user_uid IS NULL
        )
      `;
      params.push(userId);
    }

    queryStr += ' ORDER BY w.hostname, w.pid';
    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1112 Phase 7 (D-6): project-scoped, not worker-scoped — `.worktrees/`
// lives at the shared repo checkout's cwd, not inside any one worker's
// private state, so every worker for this project on a given host reports
// an identical list. DISTINCT ON (hostname) dedupes to the freshest report
// per host; each row is tagged with `host` so the UI can group by host only
// when more than one has actually reported (the common case is exactly one).
//
// Track 10018: extracted so GET /tracks (below) can reuse the exact same
// data to answer "is this done-lane track's branch actually merged yet?" —
// a track can sit at lane_status='done' while its branch is still
// mergeable/stranded/conflicted/pr-open; the Kanban card needs the same
// live, git-derived truth the Worktrees panel already has, not a second,
// possibly-stale copy of it.
async function fetchWorktreeRows(projectId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (hostname) hostname, worktrees, last_heartbeat
     FROM workers
     WHERE project_id = $1 AND worktrees IS NOT NULL
       AND last_heartbeat > NOW() - INTERVAL '60 seconds'
     ORDER BY hostname, last_heartbeat DESC`,
    [projectId]
  );
  const rows = [];
  for (const hostRow of result.rows) {
    const wtRows = Array.isArray(hostRow.worktrees) ? hostRow.worktrees : [];
    for (const wt of wtRows) rows.push({ ...wt, host: hostRow.hostname });
  }
  return rows;
}

app.get('/api/projects/:id/worktrees', async (req, res) => {
  try {
    const rows = await fetchWorktreeRows(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workers', async (req, res) => {
  try {
    const userId = req.user?.uid || null;

    // Track 1091: LEFT JOIN (not JOIN) — a manager worker's project_id is
    // NULL by design (it isn't "for" any one project), so an inner join
    // silently dropped every manager worker from this endpoint's results.
    let queryStr = `
      SELECT w.id, w.hostname, w.pid, w.worker_number, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, w.mode, w.type, w.cli, w.model, w.available_models,
              p.id AS project_id, p.name AS project_name, p.repo_path
       FROM workers w
       LEFT JOIN projects p ON p.id = w.project_id
       WHERE w.last_heartbeat > NOW() - INTERVAL '60 seconds'
    `;
    const params = [];

    if (AUTH_ENABLED && userId) {
      queryStr += `
        AND (
          w.visibility = 'public' 
          OR w.user_uid = $1
          OR (w.visibility = 'team' AND EXISTS (
            SELECT 1 FROM worker_permissions wp 
            WHERE wp.worker_id = w.id AND wp.user_uid = $1
          ))
          OR w.user_uid IS NULL
        )
      `;
      params.push(userId);
    }

    queryStr += ' ORDER BY w.hostname, w.pid';
    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/worker/start', async (req, res) => {
  try {
    const result = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = result.rows[0];

    // Track 1114 (found live, real bug): `make lc-start` assumed every
    // project's own Makefile defines an `lc-start` target — this repo's
    // does, but that's not guaranteed (confirmed live: `aitutor`/coachai
    // has no such target at all, failing with "No rule to make target").
    // `lc start` is the actual CLI command Makefile targets like this one
    // just wrap — calling it directly removes the per-project Makefile
    // dependency entirely, matching the same direct-CLI approach already
    // used by POST /api/projects/:id/workers/start-new.
    const { stdout, stderr } = await execAsync('lc start', { cwd: repo_path });
    res.json({ ok: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1112/1084 dogfood incident (2026-08-13): the track panel's "Run on
// worker" dropdown could only ever offer workers that already exist —
// if the project's one worker was busy, a dispatch just queued silently
// behind it with no way to actually get more capacity from the UI. Reuses
// the exact mechanism the "Start Sync Worker" button already uses
// (`lc start`), just parameterized with the next free --worker-number for
// this project instead of always defaulting to 1 (which would hit the
// "already running" guard when worker #1 exists, per bin/lc.mjs).
app.post('/api/projects/:id/workers/start-new', async (req, res) => {
  try {
    const { rows: projRows } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (projRows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projRows[0];

    const { rows: numRows } = await pool.query(
      `SELECT COALESCE(MAX(worker_number), 0) AS max_num FROM workers WHERE project_id = $1 AND type != 'manager'`,
      [req.params.id]
    );
    const nextNumber = (numRows[0]?.max_num || 0) + 1;

    // Track 10011: optional cli/model let the caller pick this worker's
    // provider instead of always inheriting project.primary.cli. Omitting
    // them keeps prior behavior unchanged. Uses execFile with an argument
    // array (not execAsync's shell string) — cli/model are free text from
    // the request body, same injection concern as /workers/manager/start.
    const args = ['start', '--worker-number', String(nextNumber)];
    if (req.body?.cli) args.push('--cli', String(req.body.cli));
    if (req.body?.model) args.push('--model', String(req.body.model));

    const { stdout, stderr } = await execFileAsync('lc', args, { cwd: repo_path });
    res.json({ ok: true, worker_number: nextNumber, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/worker/stop', async (req, res) => {
  try {
    const result = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = result.rows[0];

    const { stdout, stderr } = await execAsync('make lc-stop', { cwd: repo_path });
    res.json({ ok: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1084 Phase 6: stop ONE worker. The project-scoped stop above shells
// out to `make lc-stop`, which is all-or-nothing — there was no way to stop
// worker #2 while leaving #1 running, even though Phase 0 made multiple
// workers per project a first-class case. Uses `lc worker stop
// --worker-number N` (or --manager), which already supports exactly this
// via per-instance pidfiles.
app.post('/api/workers/:id/stop', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.worker_number, w.type, p.repo_path
         FROM workers w
         LEFT JOIN projects p ON p.id = w.project_id
        WHERE w.id = $1`,
      [parseInt(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'worker not found' });
    const { worker_number, type, repo_path } = rows[0];

    // A manager isn't scoped to a project and has no repo_path of its own;
    // its pidfile is global, so `lc worker stop --manager` finds it from
    // anywhere. A project worker's pidfile lives in its project directory.
    const cmd = type === 'manager'
      ? 'lc worker stop --manager'
      : `lc worker stop --worker-number ${parseInt(worker_number) || 1}`;
    const cwd = type === 'manager' ? process.cwd() : repo_path;
    if (type !== 'manager' && !cwd) {
      return res.status(400).json({ error: 'worker has no project directory to stop it in' });
    }

    const { stdout, stderr } = await execAsync(cmd, { cwd });
    broadcast('worker:updated', { projectId: null });
    res.json({ ok: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1091 Phase 5b: the New Project and Provision-Worker flows both
// dead-ended into "go run `lc worker start --manager --projects-dir <path>`
// yourself" whenever no manager was online for the current machine — there
// was a symmetric stop-manager path (above) but nothing to start one.
// Mirrors POST /api/projects/:id/worker/start (`lc start`) for the
// machine-level manager singleton instead of a project worker.
//
// Uses execFile with an argument array, not execAsync's shell string —
// projectsDir is free text from a browser field, and every other command
// built by this file interpolates only server-derived or numeric values
// into its exec() string. This is the first one taking arbitrary user text,
// so string interpolation into a shell command here would be a real
// injection hole, not just an inconsistency.
app.post('/api/workers/manager/start', async (req, res) => {
  try {
    const projectsDir = typeof req.body?.projectsDir === 'string' ? req.body.projectsDir.trim() : '';
    const args = ['worker', 'start', '--manager'];
    if (projectsDir) args.push('--projects-dir', projectsDir);
    const { stdout, stderr } = await execFileAsync('lc', args, { cwd: process.cwd() });
    res.json({ ok: true, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/providers', async (req, res) => {
  try {
    const data = await collectorWrite('GET', '/provider-status', undefined, req.params.id);
    res.json(data.providers || []);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Tracks per project ─────────────────────────────────────────────────────

app.get('/api/tracks/waiting', async (req, res) => {
  try {
    const { project_id } = req.query;
    let queryStr = `
      SELECT t.*, p.name as project_name
      FROM tracks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.lane_action_status = 'queue' AND t.lane_status != 'done'`;
    let queryArgs = [];
    if (project_id) {
      queryStr += ' AND t.project_id = $1';
      queryArgs.push(project_id);
    }
    queryStr += ' ORDER BY t.priority ASC NULLS LAST, t.created_at ASC LIMIT 10';
    const r = await pool.query(queryStr, queryArgs);
    res.json(r.rows);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks/waiting', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(`
      SELECT t.*, p.name as project_name
      FROM tracks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.lane_action_status = 'queue' AND t.lane_status != 'done'
        AND t.project_id = $1
      ORDER BY t.priority ASC NULLS LAST, t.created_at ASC LIMIT 10`, [id]);
    res.json(r.rows || []);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.track_number, t.title, t.lane_status, t.progress_percent,
              t.current_phase, t.phase_step, t.content_summary, t.last_heartbeat, t.created_at,
              t.content_updated_at AS last_updated,
              t.auto_implement_launched, t.auto_review_launched,
              t.lane_action_status, t.lane_action_result, t.priority,
              t.track_type, t.kpi_target, t.kpi_actual, t.kpi_check_after, t.kpi_maps_to,
              t.assignee_uid, t.created_by_uid, t.waiting_for_reply, p.owner_uid,
              t.merge_mode, t.pr_number, t.pr_url, t.pr_status,
              p.create_quality_gate,
              lc.body AS last_comment_body, lc.author AS last_comment_author, lc.created_at AS last_comment_at,
              uc.unreplied_count, hr.human_needs_reply, retries.retry_count
       FROM tracks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT body, author, created_at FROM track_comments
         WHERE track_id = t.id ORDER BY created_at DESC LIMIT 1
       ) lc ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unreplied_count FROM track_comments uc
         WHERE uc.track_id = t.id
           AND uc.author IN ('claude', 'gemini', 'system')
           AND uc.created_at > COALESCE(
             (SELECT MAX(created_at) FROM track_comments
              WHERE track_id = t.id AND author = 'human'),
             '1970-01-01'
           )
       ) uc ON true
        LEFT JOIN LATERAL (
          SELECT EXISTS(
            SELECT 1 FROM track_comments WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE
          ) AS human_needs_reply
        ) hr ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int as retry_count FROM track_comments
          WHERE track_id = t.id
            AND author IN ('worker', 'claude', 'gemini')
            AND (
              body LIKE '%Verdict: FAIL%' OR 
              body LIKE '%Verdict: FAIL%' OR
              body LIKE '%Verdict: NEEDS WORK%' OR
              body LIKE '%Automation failed%' OR
              body LIKE '%Quality Gate FAILED%'
            )
            AND created_at > COALESCE(
              (SELECT MAX(created_at) FROM track_comments
               WHERE track_id = t.id AND author = 'human'),
              '1970-01-01'
            )
        ) retries ON true
       WHERE t.project_id = $1
       ${req.query.track ? `AND t.track_number = $2` : ''}
       ORDER BY t.track_number`,
      req.query.track ? [req.params.id, req.query.track] : [req.params.id]
    );

    // Track 1084 Phase 4: resolve each track's assignee_worker_status —
    // batched into a single workers query per request rather than per
    // track. Assignees are almost always null in no-auth deployments
    // (local-fs/local-api), in which case this is a no-op.
    const assignees = [...new Set(result.rows.map(t => resolveAssignee(t, { owner_uid: t.owner_uid })).filter(Boolean))];
    let workersByUid = new Map();
    if (assignees.length > 0) {
      const { rows: workers } = await pool.query(
        'SELECT user_uid, status, last_heartbeat FROM workers WHERE project_id = $1 AND user_uid = ANY($2)',
        [req.params.id, assignees]
      );
      workersByUid = workers.reduce((map, w) => {
        if (!map.has(w.user_uid)) map.set(w.user_uid, []);
        map.get(w.user_uid).push(w);
        return map;
      }, new Map());
    }

    // Track 10018: a track can sit at lane_status='done' while its branch
    // is still mergeable/stranded/conflicted/pr-open — "done" on the board
    // otherwise silently means "the lane action finished," not "this
    // shipped." Cross-reference the same live, git-derived worktree state
    // the panel uses, keyed by track_number, so the Kanban card can show
    // the truth. Absence here (the common case) means either the track
    // never had a branch (non-dev work, or nothing to merge) or it's
    // already fully merged — auditWorktrees omits fully-merged branches
    // entirely, so "not in this map" IS the "really done" signal.
    const worktreeRows = await fetchWorktreeRows(req.params.id);
    const worktreeByTrack = new Map(worktreeRows.filter(r => r.track).map(r => [String(r.track), r]));

    res.json(result.rows.map(t => {
      const wt = worktreeByTrack.get(String(t.track_number));
      return {
        ...t,
        assignee_worker_status: resolveAssigneeWorkerStatus(workersByUid.get(resolveAssignee(t, { owner_uid: t.owner_uid })) ?? []),
        // null when there's no live unmerged branch for this track at all
        // (nothing to show — the common, actually-shipped case).
        worktree_class: wt?.class ?? null,
        worktree_pr_status: wt?.pr_status ?? null,
        worktree_pr_url: wt?.pr_url ?? null,
        worktree_pr_number: wt?.pr_number ?? null,
        // Track 10018 Phase 10: null exactly when there's no live worktree
        // row for this track (not yet past `plan`, or — once track 1115's
        // main-direct workspace mode ships — a track configured to work
        // directly on main with no branch at all). The frontend renders
        // "main" for that null case; this stays the raw signal, same
        // convention as worktree_class above.
        worktree_branch: wt?.branch ?? null,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/tracks/:num/priority', async (req, res) => {
  try {
    const { priority } = req.body;
    if (priority === undefined) return res.status(400).json({ error: 'priority is required' });
    await collectorWrite('PATCH', `/track/${req.params.num}/priority`, { priority }, req.params.id);
    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/tracks/:num', async (req, res) => {
  try {
    const { lane_status, phase_step } = req.body;
    const VALID_LANES = ['plan', 'backlog', 'implement', 'review', 'quality-gate', 'done'];
    const VALID_STEPS = ['plan', 'coding', 'reviewing', 'complete', null];

    if (lane_status !== undefined && !VALID_LANES.includes(lane_status)) {
      return res.status(400).json({ error: 'Invalid lane_status' });
    }
    if (phase_step !== undefined && phase_step !== null && !VALID_STEPS.includes(phase_step)) {
      return res.status(400).json({ error: 'Invalid phase_step' });
    }

    // Determine correct collector path: /track/:num/lane if lane_status provided, else /track/:num/action
    let path = `/track/${req.params.num}/action`;
    if (lane_status !== undefined) {
      path = `/track/${req.params.num}/lane`;
    }

    await collectorWrite('PATCH', path, req.body, req.params.id);
    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Create track ────────────────────────────────────────────────────────────

app.post('/api/projects/:id/tracks', async (req, res) => {
  try {
    const { title, description = '', type = 'feature', trackType = 'dev' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

    // Get project repo_path
    const projResult = await pool.query(
      'SELECT id, repo_path FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projResult.rows[0];

    // 1. Transactionally compute next track number and reserve in DB
    const client = await pool.connect();
    let trackNumber;
    try {
      await client.query('BEGIN');
      // Lock by project to ensure atomic track numbering
      await client.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [req.params.id]);

      const numResult = await client.query(
        `SELECT COALESCE(MAX(CAST(track_number AS INTEGER)), 0) + 1 AS next_num
         FROM tracks WHERE project_id = $1 AND track_number ~ '^[0-9]+$'`,
        [req.params.id]
      );
      const nextNum = numResult.rows[0].next_num;
      trackNumber = String(nextNum).padStart(3, '0');

      // Register in DB - this effectively 'owns' the track number now
      const safeTrackType = ['dev', 'marketing', 'sales', 'support', 'other'].includes(trackType) ? trackType : 'dev';
      await client.query(
        `INSERT INTO tracks (project_id, track_number, title, content_summary, lane_status, lane_action_status, progress_percent, last_updated_by, track_type)
         VALUES ($1, $2, $3, $4, 'plan', 'queue', 0, 'human', $5)`,
        [req.params.id, trackNumber, title.trim(), description.trim(), safeTrackType]
      );
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      logger.error({ err: dbErr }, '[track-create] DB failure');
      return res.status(500).json({ error: 'Failed to reserve track in DB: ' + dbErr.message });
    } finally {
      client.release();
    }

    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${trackNumber}: ${title.trim()}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${title.trim()}\n**Description**: ${description.trim() || 'No description.'}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;

    // 2. Local Filesystem Sync
    if (repo_path && existsSync(repo_path)) {
      try {
        const tracksDir = join(repo_path, 'conductor', 'tracks');
        const slug = slugify(title);
        const folderName = `${trackNumber}-${slug}`;
        const trackPath = join(tracksDir, folderName);

        // CREATE TRACK FILES IMMEDIATELY (Highly requested/more robust)
        // By writing the description to index.md directly, we solve the 'overwrite' problem in the sync queue.
        if (!existsSync(trackPath)) {
          mkdirSync(trackPath, { recursive: true });
          const safeTrackType = ['dev', 'marketing', 'sales', 'support', 'other'].includes(trackType) ? trackType : 'dev';
          const { index, plan, spec } = trackTemplates(trackNumber, title.trim(), description.trim(), type, safeTrackType, 'plan');
          writeFileSync(join(trackPath, 'index.md'), index, 'utf8');
          writeFileSync(join(trackPath, 'plan.md'), plan, 'utf8');
          writeFileSync(join(trackPath, 'spec.md'), spec, 'utf8');
          console.log(`[track-create] Created local folder & files for track ${trackNumber}: ${folderName}`);
        }

        // Write to file_sync_queue.md - use robust append to avoid stomping on worker's processing
        const queuePath = join(tracksDir, 'file_sync_queue.md');
        if (existsSync(queuePath)) {
          // If we can find a clean place to insert, we do. BUT we must be careful of races.
          // Since we are now using a transaction for trackNumber, we are safer.
          let content = readFileSync(queuePath, 'utf8');
          if (content.includes('## Track Creation Requests')) {
            content = content.replace(/^(## Track Creation Requests)/m, '$1\n' + queueEntry);
            writeFileSync(queuePath, content, 'utf8');
          } else {
            appendFileSync(queuePath, queueEntry, 'utf8');
          }
        } else {
          writeFileSync(queuePath, '# File Sync Queue\n\n## Track Creation Requests\n' + queueEntry + '\n## Completed Queue\n', 'utf8');
        }
      } catch (fsErr) {
        logger.warn({ err: fsErr, projectId: req.params.id }, '[track-create] FS warning');
        // Non-fatal: the DB is updated, and the worker can still pick it up if it syncs from DB → FS later
      }
    }

    // 3. Queue for remote worker sync (DB → Filesystem)
    const relQueuePath = join('conductor', 'tracks', 'file_sync_queue.md');
    await queueFileSync(req.params.id, relQueuePath, queueEntry, 'append');

    // Read back the created row for response
    const insertResult = await pool.query(
      'SELECT id, track_number, title, lane_status, progress_percent FROM tracks WHERE project_id = $1 AND track_number = $2',
      [req.params.id, trackNumber]
    );
    const track = insertResult.rows[0];
    broadcast('track:updated', { projectId: req.params.id, trackNumber: trackNumber });
    res.status(201).json({ ...track, repo_path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All tracks (all projects) ──────────────────────────────────────────────

app.get('/api/tracks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.track_number, t.title, t.lane_status, t.progress_percent,
              t.current_phase, t.phase_step, t.content_summary, t.last_heartbeat, t.created_at,
              t.auto_implement_launched, t.auto_review_launched,
              t.lane_action_status, t.lane_action_result,
              p.id AS project_id, p.name AS project_name, p.repo_path,
              p.primary_cli, p.primary_model, p.secondary_cli, p.secondary_model, p.create_quality_gate,
              lc.body AS last_comment_body, lc.author AS last_comment_author, lc.created_at AS last_comment_at,
              uc.unreplied_count, hr.human_needs_reply
       FROM tracks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT body, author, created_at FROM track_comments
         WHERE track_id = t.id ORDER BY created_at DESC LIMIT 1
       ) lc ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unreplied_count FROM track_comments uc
         WHERE uc.track_id = t.id
           AND uc.author IN ('claude', 'gemini', 'system')
           AND uc.created_at > COALESCE(
             (SELECT MAX(created_at) FROM track_comments
              WHERE track_id = t.id AND author = 'human'),
             '1970-01-01'
           )
       ) uc ON true
        LEFT JOIN LATERAL (
          SELECT EXISTS(
            SELECT 1 FROM track_comments WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE
          ) AS human_needs_reply
        ) hr ON true
       ORDER BY p.name, t.track_number`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inbox (tracks with active conversations) ───────────────────────────────

app.get('/api/inbox', async (req, res) => {
  try {
    const { project_id } = req.query;
    const values = [];
    const projectFilter = project_id
      ? `AND t.project_id = $${values.push(Number(project_id))}`
      : '';

    // Track 10012: three-way bucket classification, evaluated in priority
    // order so each row lands in exactly one section:
    //  1. awaiting_ai   — a real unresolved human comment (unchanged from
    //                     the pre-fix human_needs_reply heuristic; now
    //                     correctly scoped since 'system' can no longer
    //                     masquerade as 'human' here).
    //  2. needs_input   — tracks.waiting_for_reply, or the most recent
    //                     comment is a 'system' ⚠️/❌ notice, or (fallback)
    //                     there's an unreplied claude/gemini/system message
    //                     — the old "awaiting your reply" heuristic, kept
    //                     for non-emoji AI comments.
    //  3. recent_activity — most recent comment is a 'system' ✅ notice (or
    //                     nothing else applies): informational only.
    // A row is excluded entirely (before bucketing) once dismissed_at is at
    // least as new as its latest visible comment — POST .../dismiss sets
    // it, and it's automatically superseded the moment a genuinely new
    // comment arrives, without needing to touch waiting_for_reply (which a
    // later sync cycle would just re-assert from the track's own file).
    const result = await pool.query(
      `SELECT t.id AS track_id, t.track_number, t.title, t.lane_status,
              t.lane_action_status, t.waiting_for_reply,
              p.id AS project_id, p.name AS project_name,
              lc.author AS last_comment_author, lc.body AS last_comment_body, lc.created_at AS last_comment_at,
              uc.unreplied_count, hr.human_needs_reply,
              CASE
                WHEN hr.human_needs_reply THEN 'awaiting_ai'
                WHEN t.waiting_for_reply THEN 'needs_input'
                WHEN lc.author = 'system' AND (lc.body LIKE '⚠️%' OR lc.body LIKE '❌%') THEN 'needs_input'
                WHEN lc.author = 'system' AND lc.body LIKE '✅%' THEN 'recent_activity'
                WHEN COALESCE(uc.unreplied_count, 0) > 0 THEN 'needs_input'
                ELSE 'recent_activity'
              END AS bucket
       FROM tracks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT body, author, created_at FROM track_comments
         WHERE track_id = t.id AND is_hidden = FALSE ORDER BY created_at DESC LIMIT 1
       ) lc ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unreplied_count FROM track_comments uc
         WHERE uc.track_id = t.id
           AND uc.author IN ('claude', 'gemini', 'system')
           AND uc.is_hidden = FALSE
           AND uc.created_at > COALESCE(
             (SELECT MAX(created_at) FROM track_comments
              WHERE track_id = t.id AND author = 'human' AND is_hidden = FALSE),
             '1970-01-01'
           )
       ) uc ON true
       LEFT JOIN LATERAL (
         SELECT EXISTS(
           SELECT 1 FROM track_comments WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE AND is_hidden = FALSE
         ) AS human_needs_reply
       ) hr ON true
       WHERE (lc.created_at IS NOT NULL OR t.waiting_for_reply = TRUE)
         AND NOT (t.dismissed_at IS NOT NULL AND t.dismissed_at >= COALESCE(lc.created_at, t.dismissed_at))
         ${projectFilter}
       ORDER BY lc.created_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/tracks/:num/dismiss', async (req, res) => {
  try {
    const trackId = await getTrackId(req.params.id, req.params.num);
    if (!trackId) return res.status(404).json({ error: 'Track not found' });

    await pool.query(
      'UPDATE track_comments SET is_hidden = TRUE WHERE track_id = $1',
      [trackId]
    );
    // Track 10012-follow-up: hiding comments alone doesn't stop a row from
    // reappearing on the next poll when it qualifies via
    // tracks.waiting_for_reply — that flag is authoritative-per-sync
    // (re-asserted from the track's own index.md marker every sync cycle,
    // see parseWaitingForReply() in laneconductor.sync.mjs), so setting it
    // false here would just get overwritten back to true on the next sync
    // for a track that's genuinely still waiting (found live: track 8002,
    // a stale brainstorm fixture, kept reappearing after every dismiss).
    // dismissed_at sidesteps that fight entirely — GET /api/inbox excludes
    // a track once dismissed_at is at least as new as its latest visible
    // comment, and automatically re-includes it the moment a genuinely
    // NEW comment arrives, without this endpoint needing to touch
    // waiting_for_reply at all.
    await pool.query(
      'UPDATE tracks SET dismissed_at = NOW() WHERE id = $1',
      [trackId]
    );
    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Conductor context files ─────────────────────────────────────────────────

app.get('/api/projects/:id/conductor', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT conductor_files FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0].conductor_files ?? {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 10014: generalizes the write-through pattern already used by
// POST /api/projects/:id/workflow (conductor_files JSONB + disk write) to
// the other human-editable context docs — closes the gap where kpis.md,
// product.md, etc. could only be read from the UI, never edited.
const CONDUCTOR_FILE_MAP = {
  product: 'product.md',
  tech_stack: 'tech-stack.md',
  product_guidelines: 'product-guidelines.md',
  design_language: 'design-language.md',
  deployment_stack: 'deployment-stack.md',
  kpis: 'kpis.md',
  user_stories: 'user-stories.md',
  quality_gate: 'quality-gate.md',
};

app.patch('/api/projects/:id/conductor/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const filename = CONDUCTOR_FILE_MAP[key];
    if (!filename) return res.status(400).json({ error: `unknown conductor file key: ${key}` });

    const content = req.body?.content ?? '';
    const dbResult = await pool.query('SELECT repo_path, conductor_files FROM projects WHERE id = $1', [req.params.id]);
    if (!dbResult.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { repo_path, conductor_files } = dbResult.rows[0];

    const updatedFiles = { ...(conductor_files || {}), [key]: content };
    await pool.query('UPDATE projects SET conductor_files = $1 WHERE id = $2', [updatedFiles, req.params.id]);

    if (repo_path && existsSync(repo_path)) {
      writeFileSync(join(repo_path, 'conductor', filename), content, 'utf8');
    }

    broadcast('conductor:updated', { projectId: req.params.id });
    logger.info({ projectId: req.params.id, key }, '[conductor] Updated context file');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/workflow', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const result = await pool.query('SELECT repo_path, conductor_files FROM projects WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const { repo_path, conductor_files } = result.rows[0];

    // Try DB first (workflow_json is the JSON string of conductor/workflow.json)
    if (conductor_files?.workflow_json) {
      try { return res.json(JSON.parse(conductor_files.workflow_json)); } catch { /* fall through */ }
    }

    // Fallback: read workflow.json directly from disk
    if (repo_path) {
      const diskPath = join(repo_path, 'conductor', 'workflow.json');
      if (existsSync(diskPath)) {
        try { return res.json(JSON.parse(readFileSync(diskPath, 'utf8'))); } catch { /* fall through */ }
      }
    }

    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/workflow', async (req, res) => {
  try {
    const { config: newConfig } = req.body;
    if (!newConfig) return res.status(400).json({ error: 'config is required' });

    const dbResult = await pool.query('SELECT repo_path, conductor_files FROM projects WHERE id = $1', [req.params.id]);
    const conductor_files = dbResult.rows[0]?.conductor_files || {};
    const jsonStr = JSON.stringify(newConfig, null, 2);

    // Store as workflow_json (the raw content of conductor/workflow.json)
    conductor_files.workflow_json = jsonStr;
    await pool.query('UPDATE projects SET conductor_files = $1 WHERE id = $2', [conductor_files, req.params.id]);

    // Also write directly to disk if repo_path is local
    const repoPath = dbResult.rows[0]?.repo_path;
    if (repoPath && existsSync(repoPath)) {
      const diskPath = join(repoPath, 'conductor', 'workflow.json');
      writeFileSync(diskPath, jsonStr + '\n', 'utf8');
    }

    logger.info({ projectId: req.params.id }, '[workflow] Updated workflow.json');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/tracks/:num', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const trackNum = req.params.num;

    // Get repo_path + track id
    const projRes = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [projectId]);
    if (!projRes.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projRes.rows[0];

    const trackRes = await pool.query('SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2', [projectId, trackNum]);
    if (!trackRes.rows[0]) return res.status(404).json({ error: 'Track not found' });
    const trackId = trackRes.rows[0].id;

    // Delete comments then track
    await pool.query('DELETE FROM track_comments WHERE track_id = $1', [trackId]);
    await pool.query('DELETE FROM tracks WHERE id = $1', [trackId]);

    // Delete filesystem folder
    if (repo_path && existsSync(repo_path)) {
      const tracksDir = join(repo_path, 'conductor', 'tracks');
      if (existsSync(tracksDir)) {
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (dir) {
          rmSync(join(tracksDir, dir), { recursive: true, force: true });
        }
      }
      // Remove git lock if present
      const lockFile = join(repo_path, 'conductor', '.locks', `${trackNum}.lock`);
      if (existsSync(lockFile)) rmSync(lockFile, { force: true });
    }

    broadcast('track:deleted', { projectId, trackNumber: trackNum });
    console.log(`[API] Deleted track #${trackNum} (project ${projectId})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/config', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files, integrations FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files, integrations } = r.rows[0];

    // Prefer disk .laneconductor.json (source of truth), fall back to conductor_files in DB
    let lcJson = {};
    if (repo_path && existsSync(join(repo_path, '.laneconductor.json'))) {
      try { lcJson = JSON.parse(readFileSync(join(repo_path, '.laneconductor.json'), 'utf8')); } catch { /* ignore */ }
    } else if (conductor_files?.laneconductor_json) {
      try { lcJson = JSON.parse(conductor_files.laneconductor_json); } catch { /* ignore */ }
    }

    const proj = lcJson.project || {};
    const lcPrimary = proj.primary || {};
    const lcSecondary = proj.secondary || null;
    const collectors = (lcJson.collectors || []).map(c => ({ url: c.url || '', token: c.token || '' }));

    res.json({
      primary: { cli: lcPrimary.cli || primary_cli || 'claude', model: lcPrimary.model || primary_model || '' },
      secondary: lcSecondary ? { cli: lcSecondary.cli || '', model: lcSecondary.model || '' }
        : (secondary_cli ? { cli: secondary_cli, model: secondary_model || '' } : null),
      dev: proj.dev || null,
      create_quality_gate: proj.create_quality_gate ?? create_quality_gate ?? false,
      mode: lcJson.mode || 'local-api',
      repo_path: repo_path || '',
      git_remote: proj.git_remote || '',
      collectors,
      integrations: integrations || {},
      db: lcJson.db || null,
      ui_port: lcJson.ui?.port || 8090,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/config', async (req, res) => {
  try {
    const { primary, secondary, dev, create_quality_gate, collectors, db, ui_port, integrations } = req.body;

    const dbResult = await pool.query(
      'SELECT repo_path, conductor_files FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (!dbResult.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { repo_path, conductor_files } = dbResult.rows[0];

    // Update DB columns including the integrations JSONB
    await pool.query(
      `UPDATE projects SET
        primary_cli = $1, primary_model = $2,
        secondary_cli = $3, secondary_model = $4,
        create_quality_gate = $5,
        integrations = COALESCE($6, integrations)
       WHERE id = $7`,
      [
        primary?.cli || null, primary?.model || null,
        secondary?.cli || null, secondary?.model || null,
        create_quality_gate ?? false,
        integrations || null,
        req.params.id,
      ]
    );

    // Read existing .laneconductor.json from disk (source of truth)
    let lcJson = {};
    if (repo_path && existsSync(join(repo_path, '.laneconductor.json'))) {
      try { lcJson = JSON.parse(readFileSync(join(repo_path, '.laneconductor.json'), 'utf8')); } catch { /* ignore */ }
    } else if (conductor_files?.laneconductor_json) {
      try { lcJson = JSON.parse(conductor_files.laneconductor_json); } catch { /* ignore */ }
    }

    if (!lcJson.project) lcJson.project = {};
    if (primary) { lcJson.project.primary = { cli: primary.cli, model: primary.model || null }; }
    if (secondary?.cli) { lcJson.project.secondary = { cli: secondary.cli, model: secondary.model || null }; }
    else { delete lcJson.project.secondary; }
    if (dev?.command || dev?.url) { lcJson.project.dev = dev; }
    else { delete lcJson.project.dev; }
    lcJson.project.create_quality_gate = create_quality_gate ?? false;
    if (collectors) { lcJson.collectors = collectors.map(c => ({ url: c.url, token: c.token || null, ...(lcJson.collectors?.find(e => e.url === c.url) || {}) })); }
    if (db) { lcJson.db = { ...lcJson.db, ...db }; }
    if (ui_port) { lcJson.ui = { ...(lcJson.ui || {}), port: ui_port }; }

    const updatedFiles = { ...(conductor_files || {}), laneconductor_json: JSON.stringify(lcJson, null, 2) };
    await pool.query('UPDATE projects SET conductor_files = $1 WHERE id = $2', [updatedFiles, req.params.id]);

    // Write to disk if local
    if (repo_path && existsSync(repo_path)) {
      writeFileSync(join(repo_path, '.laneconductor.json'), JSON.stringify(lcJson, null, 2) + '\n', 'utf8');
    }

    logger.info({ projectId: req.params.id }, '[config] Updated project config');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks/finished', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, track_number, lane_status, lane_action_status, progress_percent 
       FROM tracks 
       WHERE project_id = $1 
         AND lane_action_status IN ('success', 'failure')
         AND lane_status NOT IN ('done', 'backlog')`,
      [req.params.id]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track detail ────────────────────────────────────────────────────────────

app.get('/api/projects/:id/tracks/:num', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, track_number, title, lane_status, lane_action_status, progress_percent,
              current_phase, content_summary, last_heartbeat, created_at,
              index_content, plan_content, spec_content, test_content, last_log_tail,
              active_cli, assignee_uid, created_by_uid
       FROM tracks
       WHERE project_id = $1 AND track_number = $2`,
      [req.params.id, req.params.num]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Track not found' });
    const t = result.rows[0];
    res.json({
      id: t.id, // needed by the client for /api/tracks/:id/dispatch (track 1085)
      track_number: t.track_number,
      title: t.title,
      lane_status: t.lane_status,
      // Track 1112 dogfood incident (2026-08-13): lane_action_status and
      // active_cli were columns on the table and written by the worker,
      // but never selected/returned here — the client's "is this run
      // actually live right now" logic (TrackDetailPanel's Logs tab) had
      // no way to ever be correct, for any track, because the field it
      // checked was always undefined. Verified live: a real running
      // track's own detail fetch had neither key at all.
      lane_action_status: t.lane_action_status,
      active_cli: t.active_cli,
      progress_percent: t.progress_percent,
      current_phase: t.current_phase,
      content_summary: t.content_summary,
      last_heartbeat: t.last_heartbeat,
      index: t.index_content,
      plan: t.plan_content,
      spec: t.spec_content,
      test: t.test_content,
      last_log_tail: t.last_log_tail,
      assignee_uid: t.assignee_uid, // Track 1084
      created_by_uid: t.created_by_uid, // Track 1084
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1087 Phase 4 Task 4: full-log reconstruction on track detail panel
// load. conductor/logs/<label>-<trackNumber>-<timestamp>.log files are
// local to the worker's machine, not synced to the DB — same local-api
// co-location assumption already used elsewhere for repo_path-relative
// reads (e.g. GET /api/projects/:id/conductor's conductor/tracks/ read).
// Returns raw parsed events; the client re-runs them through the same
// streamTranscript.js reducer used for live WS events (Phase 3) rather
// than duplicating reducer logic here.
app.get('/api/projects/:id/tracks/:num/transcript', async (req, res) => {
  try {
    const result = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = result.rows[0];
    if (!repo_path || !existsSync(repo_path)) return res.json({ events: [] });

    const logsDir = join(repo_path, 'conductor', 'logs');
    if (!existsSync(logsDir)) return res.json({ events: [] });

    const trackNum = req.params.num;
    const pattern = new RegExp(`-${trackNum}-\\d+\\.log$`);
    const candidates = readdirSync(logsDir)
      .filter(f => pattern.test(f))
      .map(f => ({ f, mtimeMs: statSync(join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (candidates.length === 0) return res.json({ events: [] });

    const content = readFileSync(join(logsDir, candidates[0].f), 'utf8');
    const events = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); }
      catch { /* non-JSON line — skip (non-Claude CLI log, or a truncated last line) */ }
    }
    res.json({ events, rawLog: content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1087 Phase 6 (revised — see spec.md REQ-6's 2026-08-10
// correction): `deploy` dispatches have no claude session, no JSONL — they
// run through the separate deploy-runner.mjs, which logs plain shell
// output to conductor/logs/deploy-<env>-<timestamp>.log (confirmed by
// reading that file directly). This is a raw-text log viewer keyed on
// worker_dispatch.id, not the structured transcript mechanism above.
app.get('/api/projects/:id/dispatch/:dispatchId/log', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wd.id, wd.action, wd.payload, wd.status, wd.result, wd.created_at, p.repo_path
       FROM worker_dispatch wd
       JOIN workers w ON w.id = wd.worker_id
       JOIN projects p ON p.id = w.project_id
       WHERE wd.id = $1 AND p.id = $2`,
      [req.params.dispatchId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Dispatch not found' });
    const { action, payload, status, result: dispatchResult, repo_path } = result.rows[0];
    if (action !== 'deploy' && action !== 'build_and_deploy' && action !== 'build') {
      return res.status(400).json({ error: `No log viewer defined for dispatch action "${action}"` });
    }

    const env = payload?.environment;
    let log = null;

    if (repo_path && existsSync(repo_path)) {
      const logsDir = join(repo_path, 'conductor', 'logs');
      if (existsSync(logsDir)) {
        const pattern = env ? new RegExp(`^deploy-${env}-\\d+\\.log$`) : /^deploy-.*-\d+\\.log$/;
        const candidates = readdirSync(logsDir)
          .filter(f => pattern.test(f))
          .map(f => ({ f, mtimeMs: statSync(join(logsDir, f)).mtimeMs }))
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        if (candidates.length > 0) {
          log = readFileSync(join(logsDir, candidates[0].f), 'utf8');
        }
      }
    }

    if (!log) {
      if (dispatchResult) {
        log = `[Dispatch Action: ${action} | Status: ${status}]\n${dispatchResult}`;
      } else if (status === 'claimed' || status === 'pending') {
        log = `[Dispatch Action: ${action} | Status: ${status}]\nWorker processing dispatch ${req.params.dispatchId}…`;
      }
    }

    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track comments ──────────────────────────────────────────────────────────

async function getTrackId(projectId, trackNum) {
  const r = await pool.query(
    'SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2',
    [projectId, trackNum]
  );
  return r.rows[0]?.id ?? null;
}

// ── DB → Files Sync (Phase 3 of Track 1010) ───────────────────────────────

async function syncTrackToFile(projectId, trackNum, updates) {
  try {
    // Get project repo_path to access track files
    const projectRes = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [projectId]);
    if (!projectRes.rows[0]) {
      console.warn(`[sync-to-file] Project ${projectId} not found`);
      return;
    }

    const repoPath = projectRes.rows[0].repo_path;

    // Find track folder: conductor/tracks/NNN-* where NNN matches trackNum
    const tracksDir = resolve(repoPath, 'conductor', 'tracks');
    if (!existsSync(tracksDir)) return;

    const trackDirs = readdirSync(tracksDir).filter(d => {
      const match = d.match(/^(\d+)-/);
      return match && match[1] === trackNum.toString();
    });
    if (!trackDirs.length) {
      // Folder missing — try to recreate it from DB content
      const dbRow = await pool.query(
        'SELECT title, lane_status, lane_action_status, progress_percent, current_phase, content_summary, index_content, plan_content, spec_content FROM tracks WHERE project_id = $1 AND track_number = $2',
        [projectId, trackNum]
      );
      if (!dbRow.rows[0]) {
        console.warn(`[sync-to-file] Track ${trackNum} not found in DB either`);
        return;
      }
      const t = dbRow.rows[0];
      const slug = (t.title || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const folderName = `${trackNum}-${slug}`;
      const folderPath = resolve(tracksDir, folderName);
      mkdirSync(folderPath, { recursive: true });
      const indexContent = t.index_content || `# Track ${trackNum}: ${t.title || 'Untitled'}\n\n**Lane**: ${t.lane_status || 'plan'}\n**Lane Status**: ${t.lane_action_status || 'queue'}\n**Progress**: ${t.progress_percent || 0}%\n**Phase**: ${t.current_phase || 'New'}\n**Summary**: ${t.content_summary || ''}\n`;
      writeFileSync(resolve(folderPath, 'index.md'), indexContent, 'utf8');
      if (t.plan_content) writeFileSync(resolve(folderPath, 'plan.md'), t.plan_content, 'utf8');
      if (t.spec_content) writeFileSync(resolve(folderPath, 'spec.md'), t.spec_content, 'utf8');
      console.log(`[sync-to-file] Recreated folder for track ${trackNum} at ${folderPath}`);
      // Now apply the updates to the newly created index.md
      trackDirs.push(folderName);
    }

    const trackIndexPath = resolve(tracksDir, trackDirs[0], 'index.md');
    if (!existsSync(trackIndexPath)) {
      console.warn(`[sync-to-file] index.md not found for track ${trackNum}`);
      return;
    }

    // Read current index.md
    let content = readFileSync(trackIndexPath, 'utf8');

    // Update markers based on provided updates
    if (updates.lane_status !== undefined) {
      content = content.replace(
        /^\*\*Lane\*\*:\s*.+$/m,
        `**Lane**: ${updates.lane_status}`
      ) || (`**Lane**: ${updates.lane_status}\n` + content);
    }

    if (updates.lane_action_status !== undefined) {
      content = content.replace(
        /^\*\*Lane Status\*\*:\s*.+$/m,
        `**Lane Status**: ${updates.lane_action_status}`
      ) || (`**Lane Status**: ${updates.lane_action_status}\n` + content);
    }

    if (updates.progress_percent !== undefined) {
      const progressStr = `${updates.progress_percent}%`;
      content = content.replace(
        /^\*\*Progress\*\*:\s*.+$/m,
        `**Progress**: ${progressStr}`
      ) || (`**Progress**: ${progressStr}\n` + content);
    }

    // Track 10018: only write a marker when a value was actually set — a
    // null merge_mode (explicitly clearing back to "unspecified") removes
    // the marker rather than writing "**Merge Mode**: null".
    if (updates.merge_mode !== undefined) {
      if (updates.merge_mode === null) {
        content = content.replace(/^\*\*Merge Mode\*\*:\s*.+\n?/m, '');
      } else if (/^\*\*Merge Mode\*\*:\s*.+$/m.test(content)) {
        content = content.replace(/^\*\*Merge Mode\*\*:\s*.+$/m, `**Merge Mode**: ${updates.merge_mode}`);
      } else {
        content = content.replace(/^(\*\*Lane\*\*:\s*.+)$/m, `$1\n**Merge Mode**: ${updates.merge_mode}`) || content;
      }
    }

    // Write back to file
    writeFileSync(trackIndexPath, content, 'utf8');

    logger.info({ trackNum, updatedFields: Object.keys(updates) }, '[sync-to-file] Track synced');
    return true;
  } catch (err) {
    logger.error({ err, trackNum }, '[sync-to-file] Error syncing track');
  }
}

app.get('/api/projects/:id/tracks/:num/comments', async (req, res) => {
  try {
    const trackId = await getTrackId(req.params.id, req.params.num);
    if (!trackId) return res.status(404).json({ error: 'Track not found' });
    const result = await pool.query(
      'SELECT id, author, body, is_replied, is_hidden, created_at FROM track_comments WHERE track_id = $1 AND is_hidden = FALSE ORDER BY created_at ASC',
      [trackId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/tracks/:num/comments', async (req, res) => {
  try {
    const { body, author = 'human' } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });
    const result = await collectorWrite('POST', `/track/${req.params.num}/comment`, req.body, req.params.id);
    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });

    // ── Sync to File: Append to conversation.md + advance cursor ──
    if (author === 'human') {
      try {
        const projRes = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
        if (projRes.rows[0]) {
          const repoPath = projRes.rows[0].repo_path;
          const tracksDir = join(repoPath, 'conductor', 'tracks');
          if (existsSync(tracksDir)) {
            const dir = readdirSync(tracksDir).find(d => d.startsWith(`${req.params.num}-`));
            if (dir) {
              const convPath = join(tracksDir, dir, 'conversation.md');
              const cursorPath = join(tracksDir, dir, '.conv-cursor');
              const options = [];
              if (req.body.no_wake) options.push('note');
              if (req.body.command) options.push(req.body.command);
              const optionsStr = options.length ? ` (${options.join(', ')})` : '';
              const append = `\n> **human**${optionsStr}: ${body}\n`;
              appendFileSync(convPath, append, 'utf8');
              // Advance cursor past the line we just wrote so the worker doesn't re-sync it
              const newSize = existsSync(convPath) ? statSync(convPath).size : 0;
              writeFileSync(cursorPath, String(newSize), 'utf8');
              console.log(`[sync-to-file] Comment synced to ${convPath} (cursor → ${newSize})`);

              // ── Command side effects (cursor is advanced so syncConversation won't run) ──
              if (req.body.command === 'brainstorm') {
                const indexPath = join(tracksDir, dir, 'index.md');
                if (existsSync(indexPath)) {
                  let idxContent = readFileSync(indexPath, 'utf8');
                  const setHeader = (c, h, v) => {
                    const re = new RegExp(`\\*\\*${h}\\*\\*:\\s*[^\\n]+`, 'i');
                    return re.test(c) ? c.replace(re, `**${h}**: ${v}`) : c.trim() + `\n**${h}**: ${v}\n`;
                  };
                  idxContent = setHeader(idxContent, 'Waiting for reply', 'yes');
                  writeFileSync(indexPath, idxContent, 'utf8');
                  console.log(`[sync-to-file] brainstorm: set Waiting for reply=yes in index.md`);
                }
              }

              // ALSO Queue for remote worker sync (DB → Filesystem)
              const relConvPath = join('conductor', 'tracks', dir, 'conversation.md');
              await queueFileSync(req.params.id, relConvPath, append, 'append');
            }
          }
        }
      } catch (syncErr) {
        console.warn(`[sync-to-file] Failed to sync comment to conversation.md:`, syncErr.message);
      }
    }

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Open Bug: post comment + append regression test to test.md ───────────────

app.post('/api/projects/:id/tracks/:num/open-bug', async (req, res) => {
  try {
    const description = (req.body.description ?? '').trim() || 'Bug reported from conversation';

    // 1. Get project repo_path
    const projRes = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!projRes.rows.length) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projRes.rows[0];

    // 2. Get track DB id
    const trackId = await getTrackId(req.params.id, req.params.num);
    if (!trackId) return res.status(404).json({ error: 'Track not found' });

    // 3. Read current test_content from DB
    const tcRes = await pool.query('SELECT test_content FROM tracks WHERE id = $1', [trackId]);
    const existingContent = tcRes.rows[0]?.test_content ?? '';

    // 4. Append regression test block (pure function)
    const updatedContent = appendRegressionTest(existingContent, description, req.params.num);

    // 5. Write updated test.md to disk
    const tracksDir = join(repo_path, 'conductor', 'tracks');
    if (existsSync(tracksDir)) {
      const dir = readdirSync(tracksDir).find(d => d.startsWith(`${req.params.num}-`));
      if (dir) {
        const testMdPath = join(tracksDir, dir, 'test.md');
        writeFileSync(testMdPath, updatedContent, 'utf8');

        // 6. Queue file sync for remote workers
        const relTestPath = join('conductor', 'tracks', dir, 'test.md');
        await queueFileSync(req.params.id, relTestPath, updatedContent, 'overwrite');

        // 7. Append to conversation.md so worker knows a bug was opened
        const convPath = join(tracksDir, dir, 'conversation.md');
        const cursorPath = join(tracksDir, dir, '.conv-cursor');
        const commentBody = `🐛 Bug reported: ${description}`;
        const append = `\n> **human**: ${commentBody}\n`;
        appendFileSync(convPath, append, 'utf8');
        const newSize = existsSync(convPath) ? statSync(convPath).size : 0;
        writeFileSync(cursorPath, String(newSize), 'utf8');
        await queueFileSync(req.params.id, join('conductor', 'tracks', dir, 'conversation.md'), append, 'append');
      }
    }

    // 8. Post comment via collector
    const comment = await collectorWrite('POST', `/track/${req.params.num}/comment`, {
      author: 'human',
      body: `🐛 Bug reported: ${description}`,
    }, req.params.id);

    // 9. Update test_content + lane in DB via collector PATCH
    await collectorWrite('PATCH', `/track/${req.params.num}`, {
      test_content: updatedContent,
      lane_status: 'plan',
    }, req.params.id);

    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.status(201).json({ ok: true, test_appended: true, comment });
  } catch (err) {
    console.error('[open-bug] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Manual re-run implement ──────────────────────────────────────────────────

// Track 1102 F5/F15: queueing alone only works if a sync+poll worker will
// come along and claim it. A sync-only worker — the default for every
// wizard-created project, meaning "sync + manual UI operations" — never
// polls the queue; it only serves the dispatch inbox. So when a project's
// live workers are ALL sync-only, bridge the action into a dispatch
// addressed to one of them, or it can never run there (proven live
// 2026-08-12 for /implement: the identical dispatch sent by hand was
// claimed in seconds; F15 extends the same bridge to /track/:num/lane and
// /track/:num/reset, which had the same gap).
//
// When a sync+poll worker exists we deliberately do NOT dispatch — its
// queue poller will claim the track as today, and dispatching too would
// race the same action into running twice. Managers are never candidates:
// lane actions are project work. Caller must invoke this AFTER the track's
// lane_status has already been written to the DB, since the dispatch
// action is read back from there.
async function dispatchIfSyncOnly(projectId, trackNumber) {
  try {
    const { rows: liveWorkers } = await pool.query(
      `SELECT w.id, w.mode, w.type FROM workers w
        WHERE w.project_id = $1 AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'`,
      [projectId]
    );
    const projectWorkers = liveWorkers.filter(w => w.type !== 'manager');
    const hasPoller = projectWorkers.some(w => w.mode === 'sync+poll');
    if (!hasPoller && projectWorkers.length > 0) {
      const { rows: [track] } = await pool.query(
        'SELECT id, lane_status FROM tracks WHERE project_id = $1 AND track_number = $2',
        [projectId, trackNumber]
      );
      if (track?.lane_status) {
        await pool.query(
          `INSERT INTO worker_dispatch(worker_id, track_number, action)
           VALUES ($1, $2, $3)`,
          [projectWorkers[0].id, trackNumber, track.lane_status]
        );
        return true;
      }
    }
  } catch (dispatchErr) {
    // The queue flag is already set; a dispatch failure shouldn't turn a
    // partially-successful request into a 500 — but it must not be
    // silent either (silent halfway states are track 1102 F8's lesson).
    console.warn(`[dispatch-bridge] dispatch bridging failed for track ${trackNumber}:`, dispatchErr.message);
  }
  return false;
}

app.post('/api/projects/:id/tracks/:num/implement', async (req, res) => {
  try {
    await collectorWrite('PATCH', `/track/${req.params.num}/action`, {
      lane_action_status: 'queue',
      lane_action_result: null,
      auto_planning_launched: null,
      auto_implement_launched: null,
      auto_review_launched: null,
    }, req.params.id);
    await collectorWrite('POST', `/track/${req.params.num}/comment`, {
      author: 'human',
      body: 'Manual retry requested (Re-run Implement)',
      is_replied: true
    }, req.params.id);

    const dispatched = await dispatchIfSyncOnly(parseInt(req.params.id), req.params.num);

    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true, dispatched, message: dispatched ? 'Dispatched to this project\'s worker' : 'Track moved to waiting state' });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Fix review gaps ─────────────────────────────────────────────────────────

app.post('/api/projects/:id/tracks/:num/fix-review', async (req, res) => {
  try {
    const projResult = await pool.query(
      'SELECT repo_path FROM projects WHERE id = $1', [req.params.id]
    );
    if (!projResult.rows.length) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projResult.rows[0];

    const trackId = await getTrackId(req.params.id, req.params.num);
    if (!trackId) return res.status(404).json({ error: 'Track not found' });

    // Load all comments ordered oldest→newest
    const allComments = (await pool.query(
      `SELECT author, body, created_at FROM track_comments
       WHERE track_id = $1 ORDER BY created_at ASC`,
      [trackId]
    )).rows;

    // Find last claude review comment (has ⚠️ Gaps section)
    let lastReviewIdx = -1;
    let gapItems = [];
    for (let i = allComments.length - 1; i >= 0; i--) {
      const c = allComments[i];
      if (c.author === 'claude' && /⚠️.*Gaps/s.test(c.body)) {
        lastReviewIdx = i;
        const gapsMatch = c.body.match(/###\s*⚠️\s*Gaps\s*\n([\s\S]*?)(?=###|---|$)/);
        if (gapsMatch) {
          gapItems = gapsMatch[1]
            .split('\n')
            .filter(l => l.trim().startsWith('- '))
            .map(l => l.trim().replace(/^-\s*/, '').replace(/\*\*[^*]+\*\*\s*[—–-]\s*/, '').trim())
            .filter(Boolean);
        }
        break;
      }
    }

    // Collect human comments after the last review (conversation feedback)
    const humanMessages = allComments
      .filter((c, i) => c.author === 'human' && i > lastReviewIdx)
      .map(c => c.body.trim())
      .filter(Boolean);

    // Find track directory and plan.md
    const tracksDir = join(repo_path, 'conductor', 'tracks');
    const trackDir = readdirSync(tracksDir).find(d => d.startsWith(req.params.num + '-'));
    if (!trackDir) return res.status(404).json({ error: 'Track directory not found on disk' });

    const planPath = join(tracksDir, trackDir, 'plan.md');
    let planContent = readFileSync(planPath, 'utf8');

    // If an open fix phase already exists, append only new human messages to it
    const openFixPhase = /## Phase \d+: Fix Review Gaps ⏳ IN PROGRESS/.test(planContent);
    if (openFixPhase) {
      if (humanMessages.length > 0) {
        const newTasks = humanMessages.map(m => `- [ ] ${m}`).join('\n');
        // Append after the last line of the existing fix phase block
        planContent = planContent.replace(
          /(## Phase \d+: Fix Review Gaps ⏳ IN PROGRESS[\s\S]*?)(\n## Phase|\s*$)/,
          (_, block, tail) => `${block.trimEnd()}\n${newTasks}\n${tail}`
        );
        writeFileSync(planPath, planContent, 'utf8');
      }
      await collectorWrite('PATCH', `/track/${req.params.num}/reset`, { lane_status: 'in-progress' }, req.params.id);
      broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
      return res.json({ ok: true, gaps: gapItems, humanMessages, phaseAdded: null, note: 'Appended to existing fix phase' });
    }

    // Build merged task list: review gaps first, then human messages
    const allTasks = [
      ...gapItems.map(g => `- [ ] ${g}`),
      ...humanMessages.map(m => `- [ ] ${m}`),
    ];
    if (allTasks.length === 0) allTasks.push('- [ ] Address review gaps');

    const phaseCount = (planContent.match(/^## Phase \d+:/gm) || []).length;
    const nextPhase = phaseCount + 1;
    const newPhase = `\n## Phase ${nextPhase}: Fix Review Gaps ⏳ IN PROGRESS\n\n**Problem**: Review gaps and conversation feedback to address.\n**Solution**: Fix each item below.\n\n${allTasks.join('\n')}\n`;

    writeFileSync(planPath, planContent + newPhase, 'utf8');

    await collectorWrite('PATCH', `/track/${req.params.num}/reset`, { lane_status: 'in-progress' }, req.params.id);

    // Insert gaps as a human comment to reset worker retry logic
    await collectorWrite('POST', `/track/${req.params.num}/comment`, {
      author: 'human',
      body: `Requested fix for identified gaps:\n${gapItems.join('\n')}`,
      is_replied: true
    }, req.params.id);

    // Reset action status to 'queue' for automation to pick up
    await collectorWrite('PATCH', `/track/${req.params.num}/action`, {
      lane_action_status: 'queue',
      lane_action_result: null,
      auto_implement_launched: null,
      auto_review_launched: null,
    }, req.params.id);

    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true, gaps: gapItems, humanMessages, phaseAdded: nextPhase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Append tasks to existing track (smart intake "add to this track") ──────

app.post('/api/projects/:id/tracks/:num/update', async (req, res) => {
  try {
    const { title, description = '' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

    const projResult = await pool.query(
      'SELECT id, repo_path FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projResult.rows[0];

    // Write a typed track-create entry to file_sync_queue.md
    const queuePath = join(repo_path, 'conductor', 'tracks', 'file_sync_queue.md');
    const now = new Date().toISOString();
    const queueEntry = `\n### Update Track ${req.params.num}: ${title.trim()}\n**Status**: pending\n**Type**: track-update\n**Created**: ${now}\n**Title**: ${title.trim()}\n**Description**: ${description.trim() || 'No description.'}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;

    // 1. Local filesystem
    try {
      let existingQueue = existsSync(queuePath) ? readFileSync(queuePath, 'utf8') : '# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n';
      existingQueue = existingQueue.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
      writeFileSync(queuePath, existingQueue, 'utf8');
    } catch (e) { }

    // 2. Queue for remote worker sync
    const relQueuePath = join('conductor', 'tracks', 'file_sync_queue.md');
    await queueFileSync(req.params.id, relQueuePath, queueEntry, 'append');

    // Move track to planning and set action status to waiting
    await collectorWrite('PATCH', `/track/${req.params.num}/reset`, { lane_status: 'plan', last_updated_by: 'human' }, req.params.id);

    // Post a comment so it's visible in conversation
    const commentBody = `ℹ️ **New Requirements Added via UI (recorded in file_sync_queue.md)**:\n\n**Title**: ${title.trim()}\n${description.trim() ? `**Description**: ${description.trim()}` : ''}`;
    await collectorWrite('POST', `/track/${req.params.num}/comment`, { author: 'human', body: commentBody }, req.params.id);

    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true, track_number: req.params.num, title: title.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dev Server (Track 1014) ───────────────────────────────────────────────────

app.post('/api/projects/:id/dev-server/start', async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    const projResult = await pool.query(
      'SELECT dev_command, dev_url, repo_path FROM projects WHERE id = $1',
      [projectId]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const { dev_command, dev_url, repo_path } = projResult.rows[0];
    if (!dev_command) return res.status(400).json({ error: 'No dev_command configured for this project' });

    // Track 10018 Phase 5: an optional preview target — when provided, the
    // dev server runs against that worktree's directory instead of the
    // primary checkout, so you can test an unmerged (typically pr-mode)
    // track's branch before approving it. `preview_cwd` is trusted as-is
    // from the client (same trust level as every other worktree_path this
    // API already accepts from the Worktrees panel, e.g. remove-worktree's
    // dispatch payload) — it's always one of the paths the panel itself
    // just displayed, sourced from this project's own git worktree list.
    const { preview_cwd, preview_track } = req.body || {};
    const targetCwd = preview_cwd || repo_path;

    // Kill existing dev server if any — this IS the "stop current, swap"
    // behavior: starting fresh (whether at the primary checkout or a
    // preview target) always tears down whatever was running first, so
    // there is only ever one dev server for this project at a time.
    if (devServers.has(projectId)) {
      const existing = devServers.get(projectId);
      if (existing.proc) {
        try {
          kill(existing.pid, 'SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          // Process might already be dead
        }
      }
      devServers.delete(projectId);
    }

    // Spawn new dev server
    const proc = spawn('sh', ['-c', dev_command], {
      cwd: targetCwd,
      detached: true,
      stdio: 'ignore'
    });

    devServers.set(projectId, {
      proc, pid: proc.pid, url: dev_url,
      previewCwd: preview_cwd || null, previewTrack: preview_cwd ? (preview_track ?? null) : null,
    });

    // Save PID to DB
    await pool.query(
      'UPDATE projects SET dev_server_pid = $1 WHERE id = $2',
      [proc.pid, projectId]
    );

    broadcast('conductor:updated', { projectId });
    res.json({ running: true, pid: proc.pid, url: dev_url, preview_track: preview_cwd ? (preview_track ?? null) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/dev-server/stop', async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    let entry = devServers.get(projectId);

    // If not in Map, try to get PID from DB
    if (!entry) {
      const result = await pool.query(
        'SELECT dev_server_pid FROM projects WHERE id = $1',
        [projectId]
      );
      if (result.rows.length > 0 && result.rows[0].dev_server_pid) {
        entry = { pid: result.rows[0].dev_server_pid };
      }
    }

    if (entry && entry.pid) {
      try {
        kill(entry.pid, 'SIGTERM');
        // Wait 3 seconds, then SIGKILL if still alive
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          kill(entry.pid, 'SIGKILL');
        } catch (e) {
          // Already dead
        }
      } catch (e) {
        // Process might already be dead
      }
    }

    devServers.delete(projectId);

    // Clear PID from DB
    await pool.query(
      'UPDATE projects SET dev_server_pid = NULL WHERE id = $1',
      [projectId]
    );

    broadcast('conductor:updated', { projectId });
    res.json({ running: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/dev-server/status', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) {
      return res.status(400).json({ error: 'invalid project id' });
    }

    let entry = devServers.get(projectId);
    let devUrl = null;
    let devCommand = null;

    // Get config from DB
    const result = await pool.query(
      'SELECT dev_command, dev_url, dev_server_pid FROM projects WHERE id = $1',
      [projectId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const { dev_command, dev_url, dev_server_pid } = result.rows[0];
    devUrl = dev_url;
    devCommand = dev_command;

    // Check if process in Map is still alive
    let running = false;
    let pid = null;
    let previewTrack = null;

    if (entry?.pid) {
      try {
        // kill with signal 0 checks if process exists without sending signal
        kill(entry.pid, 0);
        running = true;
        pid = entry.pid;
        // Track 10018 Phase 5: only meaningful when the live entry is the
        // one we spawned this process from — a DB-PID fallback (below) has
        // no way to know whether that process was ever a preview at all,
        // so it correctly stays null rather than guessing.
        previewTrack = entry.previewTrack ?? null;
      } catch (e) {
        // Process is dead
        devServers.delete(projectId);
        await pool.query(
          'UPDATE projects SET dev_server_pid = NULL WHERE id = $1',
          [projectId]
        );
      }
    } else if (dev_server_pid) {
      // Fall back to DB PID
      try {
        kill(dev_server_pid, 0);
        running = true;
        pid = dev_server_pid;
      } catch (e) {
        // Process is dead
        await pool.query(
          'UPDATE projects SET dev_server_pid = NULL WHERE id = $1',
          [projectId]
        );
      }
    }

    res.json({
      running,
      pid,
      url: devUrl,
      dev_command: devCommand,
      preview_track: previewTrack,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Watchers ──────────────────────────────────────────────────────────────────

async function runMigration() {
  const migrationsDir = join(__dirname, 'migrations');
  if (!existsSync(migrationsDir)) return;

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`[db] migration ${file} applied (idempotent)`);
    } catch (err) {
      console.warn(`[db] migration warning (${file}):`, err.message);
    }
  }
}

// ── UUID/Git Global ID utilities (used by collector endpoints) ─────────────────
const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
function uuidV5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(ns).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32);
}
function gitGlobalId(gitRemote) {
  if (!gitRemote) return null;
  const normalised = gitRemote.toLowerCase().replace(/\.git$/, '');
  return uuidV5(URL_NAMESPACE, normalised);
}

// ── Exports (for testing) ───────────────────────────────────────────────────

export { app, pool, runMigration, uuidV5, gitGlobalId, resolveAssignee, resolvePinnedWorkers, resolveAssigneeWorkerStatus };

// Load Firebase Admin config (verifies tokens in remote mode)
import { TEST_MODE as AUTH_TEST_MODE } from './auth.mjs';
// We have to use a wrapper because ESM exports are read-only
// Actually, we can just check env inside loadAuthConfig itself.
// But we already modified auth.mjs to use TEST_MODE.
// Let's use a simpler way: just check env in auth.mjs
await loadAuthConfig();
// Run DB migration (idempotent — safe to run every startup)
await runMigration();

// ============================================================================
// ── MERGED COLLECTOR ENDPOINTS START ────────────────────────────────────────
// ============================================================================

const COLLECTOR_TOKEN_ENV = process.env.COLLECTOR_0_TOKEN ?? null;

function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

async function collectorAuth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');

  const bodyProj = req.body?.project_id ? parseInt(req.body.project_id) : null;
  const queryProj = req.query.project_id ? parseInt(req.query.project_id) : null;
  const resolvedProjectId = isNaN(queryProj) ? (isNaN(bodyProj) ? null : bodyProj) : (queryProj || (isNaN(bodyProj) ? null : bodyProj));

  // 1. If global token configured, enforce it.
  if (COLLECTOR_TOKEN_ENV) {
    if (!bearer) return res.status(401).json({ error: 'unauthorized' });
    if (bearer === COLLECTOR_TOKEN_ENV) {
      req.worker_project_id = resolvedProjectId;
      return next();
    }
  }

  // 2. Identify worker via machine_token
  if (bearer) {
    try {
      let queryArgs = [bearer];
      let queryStr = 'SELECT id, project_id, user_uid, visibility FROM workers WHERE machine_token = $1';
      const requestedProject = queryProj || bodyProj;
      if (requestedProject) {
        queryStr += ' AND project_id = $2';
        queryArgs.push(requestedProject);
      }
      const { rows } = await pool.query(queryStr, queryArgs);
      if (rows.length > 0) {
        req.worker_id = rows[0].id;
        req.worker_project_id = rows[0].project_id || resolvedProjectId;
        req.worker_user_uid = rows[0].user_uid;
        req.worker_visibility = rows[0].visibility;
        req.machine_token = bearer;
        return next();
      }
    } catch (err) {
      console.error('[collector] auth DB error:', err);
    }

    // 3. Check api_keys table (SHA-256 hash lookup) for remote-api workers
    try {
      const keyHash = hashApiKey(bearer);
      const { rows } = await pool.query(
        'SELECT user_uid FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );
      if (rows.length > 0) {
        req.user_uid = rows[0].user_uid;
        req.worker_project_id = resolvedProjectId;
        // Update last_used_at asynchronously — don't block the request
        pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [keyHash]).catch(() => { });
        return next();
      }
    } catch (err) {
      console.error('[collector] api_key lookup error:', err);
    }
  }

  // 4. If no global token, allow anonymous (for local usage)
  if (!COLLECTOR_TOKEN_ENV) {
    req.worker_project_id = resolvedProjectId;
    return next();
  }

  res.status(401).json({ error: 'unauthorized' });
}

// ── Project ───────────────────────────────────────────────────────────────────

app.get('/project', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const r = await pool.query(
      'SELECT id, name, git_remote, git_global_id, create_quality_gate, primary_cli, primary_model, secondary_cli, secondary_model FROM projects WHERE id = $1',
      [projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'project not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update project fields (git_remote, agents, etc.) — computes git_global_id automatically
app.patch('/project', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const {
      git_remote, primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate,
    } = req.body;
    const sets = [];
    const params = [projectId];
    let i = 2;
    if (git_remote !== undefined) {
      sets.push(`git_remote = $${i++}`, `git_global_id = $${i++}`);
      params.push(git_remote, gitGlobalId(git_remote));
    }
    if (primary_cli !== undefined) { sets.push(`primary_cli = $${i++}`); params.push(primary_cli); }
    if (primary_model !== undefined) { sets.push(`primary_model = $${i++}`); params.push(primary_model); }
    if (secondary_cli !== undefined) { sets.push(`secondary_cli = $${i++}`); params.push(secondary_cli); }
    if (secondary_model !== undefined) { sets.push(`secondary_model = $${i++}`); params.push(secondary_model); }
    if (create_quality_gate !== undefined) { sets.push(`create_quality_gate = $${i++}`); params.push(create_quality_gate); }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    await pool.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/projects/:id/workflow', collectorAuth, async (req, res) => {
  try {
    const projectId = req.params.id;
    const r = await pool.query(
      'SELECT repo_path, conductor_files FROM projects WHERE id = $1',
      [projectId]
    );
    if (!r.rows[0]) return res.json({});

    const { repo_path, conductor_files } = r.rows[0];

    // Try DB first (workflow_json is the raw content of conductor/workflow.json)
    if (conductor_files?.workflow_json) {
      try { return res.json(JSON.parse(conductor_files.workflow_json)); } catch { /* fall through */ }
    }

    // Fallback: read workflow.json from disk
    if (repo_path) {
      const diskPath = join(repo_path, 'conductor', 'workflow.json');
      if (existsSync(diskPath)) {
        try { return res.json(JSON.parse(readFileSync(diskPath, 'utf8'))); } catch { /* fall through */ }
      }
    }

    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/conductor-files', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { content } = req.body;
    await pool.query(
      'UPDATE projects SET conductor_files = $1 WHERE id = $2',
      [content, projectId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track sync ────────────────────────────────────────────────────────────────

app.post('/track', collectorAuth, async (req, res) => {
  try {
    const {
      track_number, title, lane_status, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content, test_content,
      lane_action_status,
      // KPI fields
      track_type, kpi_target, kpi_actual, kpi_metric, kpi_source, kpi_source_config,
      kpi_threshold, kpi_window, kpi_snapshot, kpi_measured_at,
      kpi_check_after, kpi_scheduled_at, kpi_maps_to,
      waiting_for_reply,
      // Track 10018: per-track merge mode marker (null = unspecified, kept
      // distinct from 'pr' so resolveMergeMode's default stays overridable)
      merge_mode,
    } = req.body;

    console.log(`[API] POST /track: #${track_number} ${lane_status} (${progress_percent}%) action: ${lane_action_status}`);

    if (lane_action_status && !['queue', 'running', 'success', 'failure'].includes(lane_action_status)) {
      console.error(`[API] INVALID lane_action_status: "${lane_action_status}" for track ${track_number}. Valid values: queue, running, success, failure`);
      return res.status(400).json({ error: `Invalid lane_action_status: "${lane_action_status}". Must be one of: queue, running, success, failure` });
    }

    if (track_number === 'undefined' || track_number === 'null') {
      return res.status(400).json({ error: 'Invalid track_number: ' + track_number });
    }

    const insertLaneStatus = lane_status ?? 'plan';
    const insertActionStatus = lane_action_status ?? 'queue';
    const progress = (progress_percent !== undefined && progress_percent !== null) ? parseInt(progress_percent) : 0;

    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);

    // Fetch old state to detect transitions (index_content included for the
    // F9 gutted-index guard below).
    const oldRes = await pool.query(
      'SELECT id, lane_status, lane_action_status, index_content FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, track_number]
    );
    const oldTrack = oldRes.rows[0];

    // Track 1102 F9: refuse to replace a substantial index_content with a
    // gutted, title-less stub. Observed live: a 263-byte marker-only
    // index (title and body gone, Summary lifted from plan.md) was pushed
    // over a full 4KB version after a lane-action run, and the DB→FS pull
    // then propagated the stub back over the good file — newer-wins
    // ping-pong erasing the track body everywhere. With multiple workers/
    // checkouts pushing concurrently, this boundary — which every pusher
    // goes through — is the one place a guard actually protects the data.
    // Deliberate rewrites stay possible: keeping the `# Track` title (or
    // there being no substantial existing version) is all it takes.
    let effectiveIndexContent = index_content;
    let indexGuardTripped = false;
    if (
      typeof index_content === 'string' &&
      typeof oldTrack?.index_content === 'string' &&
      oldTrack.index_content.length > 1000 &&
      index_content.length < oldTrack.index_content.length * 0.4 &&
      /^#\s/m.test(oldTrack.index_content) &&
      !/^#\s/m.test(index_content)
    ) {
      console.warn(`[API] POST /track #${track_number}: REFUSING gutted index_content (${index_content.length}b, title-less) over existing ${oldTrack.index_content.length}b — keeping existing body. See track 1102 F9.`);
      effectiveIndexContent = oldTrack.index_content;
      indexGuardTripped = true;
    }

    // Build UPDATE clause — avoid duplicate lane_action_status assignments
    let laneStatusClause = '';
    const laneChanging = lane_status !== null && oldTrack && oldTrack.lane_status !== lane_status;
    if (lane_status !== null) {
      laneStatusClause = `lane_status = EXCLUDED.lane_status,`;
    }
    if (lane_action_status !== null && lane_action_status !== undefined) {
      // Explicit status wins over lane-change default
      laneStatusClause += ` lane_action_status = $13,`;
      if (laneChanging) {
        laneStatusClause += ` lane_action_result = NULL,`;
      }
    } else if (laneChanging) {
      // No explicit status: reset to queue on lane change
      laneStatusClause += ` lane_action_status = 'queue', lane_action_result = NULL,`;
    }

    const params = [projectId, track_number, title, insertLaneStatus, progress,
      current_phase, content_summary, phase_step,
      effectiveIndexContent, plan_content, spec_content, test_content, insertActionStatus,
      // KPI params $14-$26
      track_type ?? 'dev', kpi_target ?? null, kpi_actual ?? null,
      kpi_metric ?? null, kpi_source ?? null, kpi_source_config ?? null,
      kpi_threshold ?? null, kpi_window ?? null,
      kpi_snapshot ? JSON.stringify(kpi_snapshot) : null,
      kpi_measured_at ?? null, kpi_check_after ?? null, kpi_scheduled_at ?? null, kpi_maps_to ?? null,
      // $27: waiting_for_reply — authoritative per sync (raw, possibly null so
      // ON CONFLICT can distinguish "explicitly set" from "omitted")
      waiting_for_reply === undefined ? null : waiting_for_reply,
      // $28: merge_mode — raw (possibly null/absent from the file), COALESCEd
      // below so an unspecified file never clobbers an explicit DB value
      // (e.g. one set via the track detail panel's toggle).
      merge_mode ?? null,
    ];

    const qRes = await pool.query(`
    INSERT INTO tracks
      (project_id, track_number, title, lane_status, progress_percent,
       current_phase, content_summary, phase_step, index_content, plan_content, spec_content, test_content,
       last_heartbeat, sync_status, last_updated_by, lane_action_status,
       track_type, kpi_target, kpi_actual, kpi_metric, kpi_source, kpi_source_config,
       kpi_threshold, kpi_window, kpi_snapshot, kpi_measured_at, kpi_check_after, kpi_scheduled_at, kpi_maps_to,
       waiting_for_reply, merge_mode)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'syncing', 'worker', $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, COALESCE($27, false), $28)
    ON CONFLICT (project_id, track_number) DO UPDATE SET
      title              = EXCLUDED.title,
      ${laneStatusClause}
      progress_percent   = EXCLUDED.progress_percent,
      current_phase      = EXCLUDED.current_phase,
      content_summary    = EXCLUDED.content_summary,
      phase_step         = EXCLUDED.phase_step,
      index_content      = EXCLUDED.index_content,
      plan_content       = EXCLUDED.plan_content,
      spec_content       = EXCLUDED.spec_content,
      test_content       = COALESCE(EXCLUDED.test_content, tracks.test_content),
      last_heartbeat     = NOW(),
      sync_status        = 'syncing',
      last_updated_by    = 'worker',
      track_type         = COALESCE(EXCLUDED.track_type, tracks.track_type, 'dev'),
      kpi_target         = COALESCE(EXCLUDED.kpi_target, tracks.kpi_target),
      kpi_actual         = COALESCE(EXCLUDED.kpi_actual, tracks.kpi_actual),
      kpi_metric         = COALESCE(EXCLUDED.kpi_metric, tracks.kpi_metric),
      kpi_source         = COALESCE(EXCLUDED.kpi_source, tracks.kpi_source),
      kpi_source_config  = COALESCE(EXCLUDED.kpi_source_config, tracks.kpi_source_config),
      kpi_threshold      = COALESCE(EXCLUDED.kpi_threshold, tracks.kpi_threshold),
      kpi_window         = COALESCE(EXCLUDED.kpi_window, tracks.kpi_window),
      kpi_snapshot       = COALESCE(EXCLUDED.kpi_snapshot, tracks.kpi_snapshot),
      kpi_measured_at    = COALESCE(EXCLUDED.kpi_measured_at, tracks.kpi_measured_at),
      kpi_check_after    = EXCLUDED.kpi_check_after,
      kpi_scheduled_at   = COALESCE(EXCLUDED.kpi_scheduled_at, tracks.kpi_scheduled_at),
      kpi_maps_to        = COALESCE(EXCLUDED.kpi_maps_to, tracks.kpi_maps_to),
      waiting_for_reply  = COALESCE($27, tracks.waiting_for_reply),
      merge_mode         = COALESCE(EXCLUDED.merge_mode, tracks.merge_mode)
    RETURNING id
  `, params);

    const trackId = qRes.rows[0]?.id;

    // Reset retries by adding a human system comment if lane changed or manual reset to queue
    if (trackId && oldTrack) {
      const laneChanged = oldTrack.lane_status !== lane_status;
      const manuallyQueued = oldTrack.lane_action_status === 'failure' && lane_action_status === 'queue';

      if (laneChanged || manuallyQueued) {
        // Use is_replied=true so system-generated lane comments don't trigger auto-answer
        await pool.query(
          "INSERT INTO track_comments (track_id, author, body, is_replied) VALUES ($1, 'human', $2, true)",
          [trackId, laneChanged ? `Moved to ${lane_status} (via file sync)` : `Manual retry (via file sync)`]
        );
      }
    }

    console.log(`[API] POST /track #${track_number} UPSERT OK (rowCount: ${qRes.rowCount})`);

    const finalCheck = await pool.query('SELECT length(index_content) as len FROM tracks WHERE project_id = $1 AND track_number = $2', [projectId, track_number]);
    console.log(`[API] POST /track #${track_number} verify len: ${finalCheck.rows[0]?.len}`);

    await pool.query(
      `UPDATE tracks SET sync_status = 'synced' WHERE project_id = $1 AND track_number = $2`,
      [projectId, track_number]
    );

    broadcast('track:updated', { projectId, trackNumber: track_number });
    res.json(indexGuardTripped ? { ok: true, index_guard: 'kept_existing' } : { ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/heartbeat', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    await pool.query(
      `UPDATE tracks SET last_heartbeat = NOW()
     WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/action', collectorAuth, async (req, res) => {
  try {
    const { lane_action_status, lane_action_result, last_log_tail, active_cli,
      lane_status, progress_percent,
      auto_planning_launched, auto_implement_launched, auto_review_launched,
      waiting_for_reply,
      // Track 10018: merge mode + PR tracking fields
      merge_mode, pr_number, pr_url, pr_status } = req.body;

    console.log(`[API] PATCH /track/${req.params.num}/action: ${lane_status || '(no lane)'} (${progress_percent ?? '(no progress)'}%) action: ${lane_action_status || '(no action)'}`);

    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const sets = ['last_heartbeat = NOW()'];
    const params = [projectId, req.params.num];
    let i = 3;
    if (lane_action_status !== undefined) {
      sets.push(`lane_action_status = $${i++}`);
      params.push(lane_action_status);
      if (lane_action_status !== 'running') {
        sets.push(`claimed_by = NULL`);
      }
    }
    if (lane_action_result !== undefined) { sets.push(`lane_action_result = $${i++}`); params.push(lane_action_result); }
    if (last_log_tail !== undefined) { sets.push(`last_log_tail = $${i++}`); params.push(last_log_tail); }
    if (active_cli !== undefined) { sets.push(`active_cli = $${i++}`); params.push(active_cli); }
    if (lane_status !== undefined) { sets.push(`lane_status = $${i++}`); params.push(lane_status); }
    if (progress_percent !== undefined) { sets.push(`progress_percent = $${i++}`); params.push(progress_percent); }
    if (auto_planning_launched !== undefined) { sets.push(`auto_planning_launched = $${i++}`); params.push(auto_planning_launched); }
    if (auto_implement_launched !== undefined) { sets.push(`auto_implement_launched = $${i++}`); params.push(auto_implement_launched); }
    if (auto_review_launched !== undefined) { sets.push(`auto_review_launched = $${i++}`); params.push(auto_review_launched); }
    if (waiting_for_reply !== undefined) { sets.push(`waiting_for_reply = $${i++}`); params.push(waiting_for_reply); }
    if (merge_mode !== undefined) {
      if (merge_mode !== null && !['pr', 'direct'].includes(merge_mode)) {
        return res.status(400).json({ error: `Invalid merge_mode: "${merge_mode}". Must be "pr" or "direct".` });
      }
      sets.push(`merge_mode = $${i++}`); params.push(merge_mode);
    }
    if (pr_number !== undefined) { sets.push(`pr_number = $${i++}`); params.push(pr_number); }
    if (pr_url !== undefined) { sets.push(`pr_url = $${i++}`); params.push(pr_url); }
    if (pr_status !== undefined) { sets.push(`pr_status = $${i++}`); params.push(pr_status); }
    await pool.query(
      `UPDATE tracks SET ${sets.join(', ')} WHERE project_id = $1 AND track_number = $2`,
      params
    );

    // ── Sync DB changes back to track files (Phase 3) ──
    const syncUpdates = {};
    if (lane_status !== undefined) syncUpdates.lane_status = lane_status;
    if (lane_action_status !== undefined) syncUpdates.lane_action_status = lane_action_status;
    if (progress_percent !== undefined) syncUpdates.progress_percent = progress_percent;
    if (merge_mode !== undefined) syncUpdates.merge_mode = merge_mode;
    if (Object.keys(syncUpdates).length > 0) {
      syncTrackToFile(projectId, req.params.num, syncUpdates).catch(err =>
        console.warn(`[sync-to-file] Failed to sync track ${req.params.num}:`, err.message)
      );
    }

    broadcast('track:updated', { projectId, trackNumber: req.params.num });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/provider-status', collectorAuth, async (req, res) => {
  try {
    const { provider, status, reset_at, last_error } = req.body;
    // 'mock' is the LC_MOCK_CLI test sentinel, never a real LLM provider —
    // reject it here so a stray test run or misconfigured worker can't
    // leave a fake provider card in the dashboard.
    if (provider === 'mock') return res.json({ ok: true });
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    await pool.query(`
    INSERT INTO provider_status (project_id, provider, status, reset_at, last_error, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (project_id, provider) DO UPDATE SET
      status = EXCLUDED.status,
      reset_at = EXCLUDED.reset_at,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
  `, [projectId, provider, status, reset_at, last_error]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/provider-status', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const r = await pool.query(
      `SELECT provider, status, reset_at, last_error, updated_at 
     FROM provider_status WHERE project_id = $1`,
      [projectId]
    );
    res.json({ providers: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Heartbeat for all in-progress tracks at once
app.post('/tracks/heartbeat', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const trackNumbers = req.body?.track_numbers; // Optional filter: only heartbeat specific tracks
    let r;
    if (trackNumbers?.length) {
      r = await pool.query(
        `UPDATE tracks SET last_heartbeat = NOW()
       WHERE project_id = $1 AND lane_action_status = 'running'
         AND track_number = ANY($2)
       RETURNING track_number`,
        [projectId, trackNumbers]
      );
    } else {
      r = await pool.query(
        `UPDATE tracks SET last_heartbeat = NOW()
       WHERE project_id = $1 AND lane_action_status = 'running'
       RETURNING track_number`,
        [projectId]
      );
    }
    res.json({ updated: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List currently running tracks per lane (for cross-worker concurrency enforcement)
app.get('/tracks/running', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const r = await pool.query(
      `SELECT track_number, lane_status FROM tracks
       WHERE project_id = $1 AND lane_action_status = 'running'`,
      [projectId]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim waiting tracks for auto-implement — atomic, uses FOR UPDATE SKIP LOCKED
// Claim tracks ready for automation (queue status)
// Supports both old endpoint name (/claim-waiting) and new (/claim-queue) for backward compatibility
async function claimQueuedTracks(req, res) {
  const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
  const client = await pool.connect();
  try {
    const workerUser = req.worker_user_uid || null;
    const workerVisibility = req.worker_visibility || 'private';
    const workerId = req.worker_id || null;

    await client.query('BEGIN');

    // Filter tracks based on worker permissions:
    // A worker can work on a track if:
    // 1. Worker is Public (accessible to all)
    // 2. Worker is Private/Team AND its owner (workerUser) matches the track's last updated human (user_uid)
    // 3. Worker is Team AND current track requester (human) is in worker_permissions table
    // Note: Since 'tracks' table doesn't have a 'user_uid' (owner) column yet, we rely on the 
    // fact that the project_id match is the primary constraint. 
    // For Track 1033, we enforce that workers ONLY claim tracks from the same project they registered for.
    // If the worker is PRIVATE, it should technically only work on tracks for that user.

    let queryStr = `
      UPDATE tracks t
      SET lane_action_status = 'running',
          lane_action_result = 'claimed',
          claimed_by = $3
      FROM (
        SELECT id FROM tracks
        WHERE project_id = $1 AND lane_action_status = 'queue'
          AND lane_status IN ('plan', 'implement', 'review', 'quality-gate')
    `;
    const params = [projectId, req.body.limit || 5, req.machine_token];

    // Enforce worker visibility when auth is enabled:
    // - public: any project member's tracks (no extra filter)
    // - team: owner tracks + tracks from users who granted this worker access
    //         (worker_permissions check: does the track requester have this worker in their allowed set)
    // - private: only owner's own tracks
    // Since tracks.last_updated_by_uid records who last touched the track (human side),
    // we use that as the track requester identity.
    if (AUTH_ENABLED && workerUser && workerVisibility !== 'public') {
      if (workerVisibility === 'team' && workerId) {
        queryStr += `
          AND (
            t.last_updated_by_uid = $4
            OR t.last_updated_by_uid IS NULL
            OR EXISTS (
              SELECT 1 FROM worker_permissions wp
              WHERE wp.worker_id = $5 AND wp.user_uid = t.last_updated_by_uid
            )
          )
        `;
        params.push(workerUser, workerId);
      } else {
        // private: only claim tracks owned by this worker's owner
        queryStr += ` AND (t.last_updated_by_uid = $4 OR t.last_updated_by_uid IS NULL) `;
        params.push(workerUser);
      }
    }

    // Track 1110 Phase 3: optional single-track target. autoLaunchLocalFs
    // decides ITS OWN candidate from local file state (which track, which
    // lane) — this lets it ask the DB "is this SPECIFIC track still mine
    // to claim" atomically right before spawning, instead of only
    // supporting "give me your next N eligible tracks" (which the
    // untargeted form above still does, unchanged, for every existing
    // caller). Placed after the visibility filter so a targeted claim is
    // still subject to the same ownership/team rules as any other.
    if (req.body.track_number) {
      params.push(req.body.track_number);
      queryStr += ` AND track_number = $${params.length} `;
    }

    queryStr += `
        ORDER BY priority DESC, CASE
          WHEN lane_status = 'plan' THEN 1
          WHEN lane_status = 'review' THEN 2
          WHEN lane_status = 'quality-gate' THEN 3
          ELSE 4
        END ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      ) sub
      WHERE t.id = sub.id
      RETURNING t.track_number, t.lane_status, t.lane_action_result, t.progress_percent,
                t.priority,
                (SELECT author FROM track_comments WHERE track_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_comment_author,
                (SELECT is_replied FROM track_comments WHERE track_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_comment_replied
    `;

    const r = await client.query(queryStr, params);
    await client.query('COMMIT');
    res.json({ tracks: r.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

app.post('/tracks/claim-waiting', collectorAuth, claimQueuedTracks); // legacy endpoint
app.post('/tracks/claim-queue', collectorAuth, claimQueuedTracks); // new endpoint

app.get('/tracks/waiting', collectorAuth, async (req, res) => {
  try {
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    let query = `
    SELECT t.track_number, t.title, t.lane_status, t.lane_action_status, t.priority, t.created_at, p.name as project_name, p.id as project_id
    FROM tracks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.lane_action_status = 'queue'
      AND t.lane_status NOT IN ('done', 'backlog')
  `;
    const args = [];
    if (projectId) {
      query += ' AND t.project_id = $1';
      args.push(projectId);
    }
    query += ' ORDER BY t.priority DESC, t.created_at ASC';

    const r = await pool.query(query, args);
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/tracks/stale', collectorAuth, async (_req, res) => {
  try {
    const projectId = _req.query.project_id ? parseInt(_req.query.project_id) : null;
    const r = await pool.query(
      `SELECT track_number FROM tracks WHERE project_id = $1 AND sync_status = 'syncing'`,
      [projectId]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/track/:num/retry-count', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const r = await pool.query(
      `SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num]
    );
    if (!r.rows[0]) return res.json({ count: 0 });
    const c = await pool.query(
      `SELECT COUNT(*)::int as count FROM track_comments
     WHERE track_id = $1
       AND author IN ('worker', 'claude', 'gemini')
       AND (
         body LIKE '%Verdict: FAIL%' OR 
         body LIKE '%Verdict: NEEDS WORK%' OR 
         body LIKE '%Automation failed%' OR
         body LIKE '%Quality Gate FAILED%'
       )
       AND created_at > (
         SELECT COALESCE(MAX(created_at), '1970-01-01') FROM track_comments 
         WHERE track_id = $1 AND author = 'human'
       )`,
      [r.rows[0].id]
    );
    res.json({ count: c.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tracks/reset-stuck-actions', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    // immediate=true: reset ALL running tracks (used on worker startup — worker starts fresh, owns no running tracks)
    // default: only reset tracks stuck for more than 2 minutes
    const immediate = req.body?.immediate === true;
    const whereClause = immediate
      ? `project_id = $1 AND lane_action_status IN ('running', 'queue') AND claimed_by IS NOT NULL`
      : `project_id = $1 AND lane_action_status = 'running' AND last_heartbeat < NOW() - INTERVAL '2 minutes'`;
    const r = await pool.query(
      `UPDATE tracks SET lane_action_status = 'queue', lane_action_result = 'stuck_timeout', claimed_by = NULL
       WHERE ${whereClause}
       RETURNING track_number`,
      [projectId]
    );
    res.json({ reset: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/block', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    await pool.query(
      `UPDATE tracks SET lane_action_status = 'failure', lane_action_result = 'max_retries_reached'
     WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/last-comment', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { body, author } = req.body;
    await pool.query(
      `UPDATE tracks SET last_comment_body = $3, last_comment_author = $4 WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num, body, author]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/track/:num', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const trackResult = await pool.query(
      `SELECT * FROM tracks WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num]
    );
    if (trackResult.rows.length === 0) return res.status(404).json({ error: 'track not found' });
    const trackId = trackResult.rows[0].id;

    const commentsResult = await pool.query(
      `SELECT * FROM track_comments WHERE track_id = $1 ORDER BY created_at ASC`,
      [trackId]
    );
    res.json({ ...trackResult.rows[0], comments: commentsResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track 1086: Persistent Sessions ────────────────────────────────────────────
// One resumable claude session per (track_number, worker_id) — keyed off the
// calling worker's own identity (collectorAuth's req.worker_id, resolved
// from its machine_token), never a client-supplied worker_id.

app.get('/track/:num/session', collectorAuth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });
    const { rows } = await pool.query(
      'SELECT claude_session_id FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
      [req.params.num, req.worker_id]
    );
    res.json({ claude_session_id: rows[0]?.claude_session_id ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/session', collectorAuth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });
    const { claude_session_id } = req.body;
    if (!claude_session_id) return res.status(400).json({ error: 'claude_session_id is required' });
    await pool.query(
      `INSERT INTO track_sessions(track_number, worker_id, claude_session_id, last_used_at)
       VALUES($1, $2, $3, NOW())
       ON CONFLICT (track_number, worker_id) DO UPDATE SET
       claude_session_id = EXCLUDED.claude_session_id, last_used_at = NOW()`,
      [req.params.num, req.worker_id, claude_session_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1086 Phase 4: invalidate a session after a detected resume-failure
// (the stored claude_session_id was pruned/corrupted/never existed) — the
// next attempt then finds no row and cold-starts, instead of retrying the
// exact same broken --resume forever.
app.delete('/track/:num/session', collectorAuth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });
    await pool.query(
      'DELETE FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
      [req.params.num, req.worker_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/comment', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { author = 'human', body } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });
    const VALID_AUTHORS = ['human', 'system', ...PROVIDER_IDS];
    const normalizedAuthor = normalizeProviderId(author);
    const safeAuthor = VALID_AUTHORS.includes(normalizedAuthor) ? normalizedAuthor : 'human';

    const trackRes = await pool.query(
      'SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );
    if (!trackRes.rows[0]) return res.status(404).json({ error: 'track not found' });
    const trackId = trackRes.rows[0].id;

    const r = await pool.query(
      `INSERT INTO track_comments(track_id, author, body, is_replied)
     VALUES($1, $2, $3, $4) RETURNING id, author, body, created_at`,
      [trackId, safeAuthor, body, req.body.is_replied === true]
    );

    // Business logic: human comment → wake worker; AI "Answered" → mark human replied
    if (safeAuthor === 'human' && req.body.no_wake !== true) {
      await pool.query(
        `UPDATE tracks SET lane_action_status = 'queue', lane_action_result = NULL
       WHERE id = $1 AND lane_status IN('plan', 'implement', 'review', 'quality-gate')
         AND lane_action_status != 'running'`,
        [trackId]
      );
    } else if (body.includes('Answered') || body.toLowerCase().includes('i updated') || body.toLowerCase().includes('done')) {
      await pool.query(
        `UPDATE track_comments SET is_replied = TRUE
       WHERE id = (
    SELECT id FROM track_comments WHERE track_id = $1 AND author = 'human'
         ORDER BY created_at DESC LIMIT 1
       )`,
        [trackId]
      );
    }

    broadcast('track:updated', { projectId, trackNumber: req.params.num });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Git Lock Coordination (Track 1010) ───────────────────────────────────────

app.post('/track/:num/lock', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { user, machine, pattern, lock_file_path } = req.body;

    const trackRes = await pool.query(
      'SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );
    if (!trackRes.rows[0]) return res.status(404).json({ error: 'track not found' });
    const trackId = trackRes.rows[0].id;

    // UPSERT into track_locks
    await pool.query(`
      INSERT INTO track_locks (project_id, track_id, track_number, "user", machine, pattern, lock_file_path, locked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (project_id, track_number) 
      DO UPDATE SET 
        "user" = EXCLUDED."user",
        machine = EXCLUDED.machine,
        pattern = EXCLUDED.pattern,
        lock_file_path = EXCLUDED.lock_file_path,
        locked_at = NOW()
    `, [projectId, trackId, req.params.num, user, machine, pattern || 'cli', lock_file_path]);

    // Update tracks table with lock info
    await pool.query(`
      UPDATE tracks 
      SET locked_by = $3, lane_action_status = 'running'
      WHERE project_id = $1 AND track_number = $2
    `, [projectId, req.params.num, `${user}@${machine}`]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/unlock', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);

    // Remove from track_locks
    await pool.query(
      'DELETE FROM track_locks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );

    // Update tracks table to clear locked_by
    await pool.query(`
      UPDATE tracks SET locked_by = NULL WHERE project_id = $1 AND track_number = $2
    `, [projectId, req.params.num]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lane drag from UI — validates lane, resets action status
app.patch('/track/:num/priority', collectorAuth, async (req, res) => {
  try {
    const { priority } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    await pool.query(
      `UPDATE tracks SET priority = $1 WHERE project_id = $2 AND track_number = $3`,
      [priority, projectId, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/lane', collectorAuth, async (req, res) => {
  try {
    const { lane_status, phase_step } = req.body;
    const VALID_LANES = ['plan', 'backlog', 'implement', 'review', 'quality-gate', 'done'];
    const VALID_STEPS = ['plan', 'coding', 'reviewing', 'complete', null];
    if (!VALID_LANES.includes(lane_status)) return res.status(400).json({ error: 'Invalid lane_status' });
    if (phase_step !== undefined && !VALID_STEPS.includes(phase_step)) return res.status(400).json({ error: 'Invalid phase_step' });

    const nextActionStatus = lane_status === 'done' ? 'success' : 'queue';
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const sets = [
      `lane_status = $3`,
      `lane_action_status = '${nextActionStatus}'`,
      `lane_action_result = NULL`,
      `last_heartbeat = NOW()`,
    ];
    const params = [projectId, req.params.num, lane_status];
    if (phase_step !== undefined) { sets.push(`phase_step = $${params.length + 1} `); params.push(phase_step); }

    const r = await pool.query(
      `UPDATE tracks SET ${sets.join(', ')}
     WHERE project_id = $1 AND track_number = $2
     RETURNING id, track_number, title, lane_status, phase_step, progress_percent, current_phase, last_heartbeat`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'track not found' });

    // Add a system comment for the move history, which resets the retry count for the worker
    await pool.query(
      `INSERT INTO track_comments (track_id, author, body, is_replied) VALUES ($1, 'human', $2, TRUE)`,
      [r.rows[0].id, `Moved to ${lane_status}` + (phase_step ? ` (${phase_step})` : '')]
    );

    // ── Sync DB changes back to track files (Phase 3) ──
    syncTrackToFile(projectId, req.params.num, {
      lane_status,
      lane_action_status: nextActionStatus
    }).catch(err =>
      console.warn(`[sync-to-file] Failed to sync track ${req.params.num}:`, err.message)
    );

    // Track 1102 F15: a lane change needs the same sync-only dispatch
    // bridge as /implement, or a drag-to-lane on a sync-only project sits
    // in lane_action_status='queue' forever. 'done' sets lane_action_status
    // to 'success', not 'queue' — nothing to dispatch in that case.
    if (nextActionStatus === 'queue') {
      await dispatchIfSyncOnly(projectId, req.params.num);
    }

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset track for update/fix-review — moves back to active state
app.patch('/track/:num/reset', collectorAuth, async (req, res) => {
  try {
    const { lane_status = 'plan', last_updated_by = 'human' } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    await pool.query(
      `UPDATE tracks SET lane_status = $3, lane_action_status = 'queue',
lane_action_result = NULL, last_updated_by = $4, last_heartbeat = NOW()
     WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num, lane_status, last_updated_by]
    );

    // Track 1102 F15: same sync-only dispatch bridge as /implement and /lane.
    await dispatchIfSyncOnly(projectId, req.params.num);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/sync-status', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { status } = req.body;
    await pool.query(
      `UPDATE tracks SET sync_status = $3 WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num, status]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── File Sync Queue ─────────────────────────────────────────────────────────

app.post('/file-sync/claim', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : (req.body.project_id ? parseInt(req.body.project_id) : null));
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    const { limit = 10 } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`
        UPDATE file_sync_queue
        SET status = 'running', worker_id = $2, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM file_sync_queue
          WHERE project_id = $1 AND status = 'waiting'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        RETURNING id, file_path, content
      `, [projectId, req.machine_token, limit]);
      await client.query('COMMIT');
      res.json({ tasks: r.rows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/file-sync/:id', collectorAuth, async (req, res) => {
  try {
    const { status, error_message } = req.body;
    await pool.query(
      'UPDATE file_sync_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
      [status, error_message, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file-sync/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT status, error_message FROM file_sync_queue WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Sync task not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Worker registration ───────────────────────────────────────────────────────

app.post('/worker/register', async (req, res, next) => {
  if (AUTH_ENABLED) {
    return requireAuth(req, res, next);
  }
  return collectorAuth(req, res, next);
}, async (req, res) => {
  try {
    const { hostname, pid, mode } = req.body;
    // Normalize legacy ids (e.g. 'agy') here — this is the forward-migration
    // point: every worker that registers stores the canonical provider id
    // in the DB even if its local .laneconductor.json still has the old one.
    const cli = req.body.cli ? normalizeProviderId(req.body.cli) : null;
    const model = req.body.model || null;
    const available_models = req.body.available_models ? JSON.stringify(req.body.available_models) : null;
    // Track 1084 Phase 0: worker_number (not pid) is the stable identity —
    // pid changes on every restart, which under the old (project_id,
    // hostname, pid) key minted a brand-new row per restart and orphaned
    // anything FK'd to it. Defaults to 1 for workers that haven't upgraded
    // to send it yet (backward compatible with today's single-worker-per-host).
    const worker_number = req.body.worker_number ? parseInt(req.body.worker_number) : 1;
    // Resolve user_uid: Firebase auth > API key auth > request body (legacy)
    let user_uid = (AUTH_ENABLED && req.user?.uid) || req.user_uid || req.body.user_uid || null;

    // Resolve visibility from request body (worker sends its configured visibility)
    const visibility = req.body.visibility || 'private';
    const type = req.body.type === 'manager' ? 'manager' : 'project';

    // Track 1091: a manager worker isn't scoped to any project — project_id
    // stays null for it, and it's a machine-level singleton (see the
    // workers_one_manager_per_host partial unique index), so it needs its
    // own INSERT...ON CONFLICT targeting that index rather than the
    // (project_id, hostname, worker_number) constraint the 'project' path
    // below uses (which would never match a second manager on the same
    // hostname — Postgres treats every NULL project_id as distinct).
    if (type === 'manager') {
      const machine_token = randomUUID();
      const { rows: [{ id: workerId }] } = await pool.query(`
        INSERT INTO workers(project_id, hostname, pid, worker_number, status, machine_token, user_uid, visibility, mode, type, cli, model, available_models, last_heartbeat)
        VALUES(NULL, $1, $2, $3, 'idle', $4, $5, $6, $7, 'manager', $8, $9, $10, NOW())
        ON CONFLICT (hostname) WHERE type = 'manager' DO UPDATE SET
        status = 'idle', pid = EXCLUDED.pid, user_uid = EXCLUDED.user_uid,
        mode = EXCLUDED.mode,
        cli = COALESCE(EXCLUDED.cli, workers.cli),
        model = COALESCE(EXCLUDED.model, workers.model),
        available_models = COALESCE(EXCLUDED.available_models, workers.available_models),
        last_heartbeat = NOW()
        RETURNING id
      `, [hostname, pid, worker_number, machine_token, user_uid, visibility, mode || 'polling', cli, model, available_models]);
      broadcast('worker:updated', { projectId: null });
      return res.json({ ok: true, machine_token, id: workerId });
    }

    const projectId = req.body.project_id ? parseInt(req.body.project_id) : null;
    if (!projectId) return res.status(400).json({ error: 'project_id is required' });

    // First check if this specific worker (by stable identity) already has a machine token
    let r = await pool.query('SELECT machine_token FROM workers WHERE project_id = $1 AND hostname = $2 AND worker_number = $3', [projectId, hostname, worker_number]);
    let machine_token = r.rows[0]?.machine_token;

    if (!machine_token) {
      machine_token = randomUUID();
    }

    const { rows: [{ id: workerId }] } = await pool.query(`
    INSERT INTO workers(project_id, hostname, pid, worker_number, status, machine_token, user_uid, visibility, mode, cli, model, available_models, last_heartbeat)
    VALUES($1, $2, $3, $4, 'idle', $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT(project_id, hostname, worker_number) DO UPDATE SET
    status = 'idle', pid = EXCLUDED.pid, machine_token = EXCLUDED.machine_token, user_uid = EXCLUDED.user_uid,
    mode = EXCLUDED.mode,
    cli = COALESCE(EXCLUDED.cli, workers.cli),
    model = COALESCE(EXCLUDED.model, workers.model),
    available_models = COALESCE(EXCLUDED.available_models, workers.available_models),
    last_heartbeat = NOW()
    RETURNING id
  `, [projectId, hostname, pid, worker_number, machine_token, user_uid, visibility, mode || 'polling', cli, model, available_models]);


    broadcast('worker:updated', { projectId });
    // Track 1084 Phase 3: the worker needs its own DB id to ask
    // /claimable-tracks "which queued tracks may I claim" — it previously had
    // no way to know its own identity beyond hostname/worker_number.
    res.json({ ok: true, machine_token, id: workerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/worker/heartbeat', collectorAuth, async (req, res) => {
  try {
    console.log('[API] /worker/heartbeat body:', req.body);
    const { hostname, pid, status, current_task, mode, model, available_models, worktrees } = req.body;
    // Same forward-migration normalization as /worker/register — see its comment.
    const cli = normalizeProviderId(req.body.cli);
    const worker_number = req.body.worker_number ? parseInt(req.body.worker_number) : 1;
    // Track 1102 F13: an explicit project_id in the BODY (including an
    // explicit null, e.g. a manager's own heartbeat) must win over
    // collectorAuth's auth-derived req.worker_project_id, not the other
    // way around. Observed live: a manager co-located with a project in
    // the same directory has no credential storage of its own --
    // resolveCollectorToken() falls through to the project's own
    // machine_token, so the manager authenticates AS that project's
    // worker even though its own body correctly says project_id: null.
    // The old `req.worker_project_id || body.project_id` precedence let
    // that misattributed auth resolution silently win, corrupting the
    // project worker's row with the manager's pid every heartbeat cycle.
    // 'project_id' in req.body distinguishes "the body explicitly
    // declared this (maybe null)" from "the body said nothing at all",
    // where falling back to the auth-resolved value is still correct
    // (the common case: a normal worker's own heartbeat).
    const projectId = 'project_id' in req.body
      ? (req.body.project_id ? parseInt(req.body.project_id) : null)
      : req.worker_project_id;
    // pid is kept updated for liveness/informational purposes even though
    // worker_number (not pid) is the identity key — see /worker/register.
    const sets = ['last_heartbeat = NOW()', 'pid = $4'];
    const params = [projectId, hostname, worker_number, pid];
    let i = 5;
    if (status) { sets.push(`status = $${i++} `); params.push(status); }
    if (current_task !== undefined) { sets.push(`current_task = $${i++} `); params.push(current_task); }
    if (mode) { sets.push(`mode = $${i++} `); params.push(mode); }
    if (cli !== undefined) { sets.push(`cli = $${i++} `); params.push(cli); }
    if (model !== undefined) { sets.push(`model = $${i++} `); params.push(model); }
    if (available_models !== undefined) { sets.push(`available_models = $${i++}`); params.push(JSON.stringify(available_models)); }
    if (worktrees !== undefined) { sets.push(`worktrees = $${i++}`); params.push(JSON.stringify(worktrees)); }
    // Track 1091: IS NOT DISTINCT FROM, not `=` — a manager worker's
    // project_id is always NULL, and SQL's `NULL = NULL` is never true, so
    // a plain `=` silently matched zero rows for every manager heartbeat
    // (last_heartbeat never advanced past registration, so it aged out of
    // GET /api/workers' 60-second freshness window and the worker appeared
    // to vanish, even though the process was alive and heartbeating).
    const hb = await pool.query(
      `UPDATE workers SET ${sets.join(', ')}
      WHERE project_id IS NOT DISTINCT FROM $1 AND hostname = $2 AND worker_number = $3`,
      params
    );
    // Track 1102 F10: a heartbeat that matched no row must say so — the
    // worker's error handler re-registers on 404. Returning ok:true here
    // left a worker whose row had been deleted out from under it (see
    // DELETE /worker's F10 note) heartbeating into the void forever:
    // busy and running, but invisible in every workers list.
    if (hb.rowCount === 0) {
      return res.status(404).json({ error: 'worker not registered (no matching row) — re-register' });
    }
    broadcast('worker:updated', { projectId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1096: Worker CLI and Model selection endpoint
app.patch('/api/workers/:id/config', requireAuth, async (req, res) => {
  try {
    const workerId = req.params.id;
    const { model } = req.body;
    // Normalize a legacy alias (e.g. 'agy') so a client that still sends
    // it is accepted and canonicalized, not rejected.
    const cli = req.body.cli != null ? normalizeProviderId(req.body.cli) : req.body.cli;

    const VALID_CLIS = [...PROVIDER_IDS, 'other'];
    if (cli !== undefined && cli !== null && !VALID_CLIS.includes(cli)) {
      return res.status(400).json({ error: 'Invalid CLI engine' });
    }

    const workerRes = await pool.query('SELECT id, project_id, type FROM workers WHERE id = $1', [workerId]);
    if (workerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const worker = workerRes.rows[0];

    const sets = [];
    const params = [];
    let i = 1;
    if (cli !== undefined) { sets.push(`cli = $${i++}`); params.push(cli); }
    if (model !== undefined) { sets.push(`model = $${i++}`); params.push(model); }

    if (sets.length > 0) {
      params.push(workerId);
      await pool.query(
        `UPDATE workers SET ${sets.join(', ')} WHERE id = $${i}`,
        params
      );
    }

    // Queue worker_dispatch action 'set_model' for worker heartbeat pickup
    const payload = JSON.stringify({ cli, model });
    await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       VALUES ($1, NULL, 'set_model', $2)`,
      [workerId, payload]
    );

    broadcast('worker:updated', { projectId: worker.project_id });
    res.json({ ok: true, worker_id: workerId, cli, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/worker', collectorAuth, async (req, res) => {
  try {
    const { hostname } = req.body;
    const worker_number = req.body.worker_number ? parseInt(req.body.worker_number) : 1;
    const projectId = req.worker_project_id || (req.body.project_id ? parseInt(req.body.project_id) : null);
    // Track 1102 F10: SOFT de-registration — never DELETE the row.
    // worker_dispatch.worker_id is ON DELETE CASCADE, so a hard delete
    // erased the worker's entire dispatch history (the Activity panel's
    // chat included). Observed live: two processes briefly shared one
    // (project, hostname, worker_number) identity; the short-lived one's
    // graceful shutdown deleted the shared row and cascaded away the
    // survivor's in-flight dispatches and all chat history. A stable
    // identity (track 1084) that a routine stop can destroy isn't stable.
    // Marking offline preserves the row, its id, and everything attached;
    // re-registration reuses it via the existing ON CONFLICT upsert.
    await pool.query(
      `UPDATE workers SET status = 'offline', last_heartbeat = NOW() - INTERVAL '10 minutes'
        WHERE project_id IS NOT DISTINCT FROM $1 AND hostname = $2 AND worker_number = $3`,
      [projectId, hostname, worker_number]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track 1085: Worker Dispatch Inbox ─────────────────────────────────────────

const DISPATCH_STATUSES = ['pending', 'claimed', 'done', 'failed'];

// Worker-side: check this worker's own inbox. Checked every sync tick
// regardless of sync-only/sync+poll mode — this is the only way a sync-only
// worker (which never polls the general queue) does anything at all.
app.get('/worker/:id/dispatch', collectorAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM worker_dispatch WHERE worker_id = $1 AND status = 'pending' ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1110 Phase 6: a dispatch this worker itself claimed but never
// reported the outcome of (its child process finished on its own after a
// worker restart orphaned the exit handler that would have called PATCH
// /worker-dispatch/:id). Startup reconciliation reads this to find
// dispatches worth checking a track's worktree for completion evidence.
app.get('/worker/:id/dispatch/claimed', collectorAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM worker_dispatch WHERE worker_id = $1 AND status = 'claimed' ORDER BY claimed_at ASC",
      [req.params.id]
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Worker-side: report a dispatch entry's outcome (claimed when it starts
// running, done/failed once it finishes).
app.patch('/worker-dispatch/:id', collectorAuth, async (req, res) => {
  try {
    const { status, result } = req.body;
    if (!DISPATCH_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${DISPATCH_STATUSES.join(', ')}` });
    }
    const claimedAtSet = status === 'claimed' ? ', claimed_at = NOW()' : '';
    const { rowCount } = result !== undefined
      ? await pool.query(`UPDATE worker_dispatch SET status = $1, result = $2${claimedAtSet} WHERE id = $3`, [status, result, req.params.id])
      : await pool.query(`UPDATE worker_dispatch SET status = $1${claimedAtSet} WHERE id = $2`, [status, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'dispatch entry not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI-side: enqueue a track-scoped (lane action) dispatch entry, validated
// against the track's current lane — mirrors the set of actions auto-launch
// already knows how to run (plan/implement/review/quality-gate).
app.post('/api/tracks/:id/dispatch', async (req, res) => {
  try {
    const { worker_id, action } = req.body;
    if (!worker_id || !action) return res.status(400).json({ error: 'worker_id and action are required' });

    const { rows: [track] } = await pool.query('SELECT id, project_id, track_number, lane_status FROM tracks WHERE id = $1', [req.params.id]);
    if (!track) return res.status(404).json({ error: 'track not found' });

    if (action !== track.lane_status) {
      return res.status(400).json({ error: `action "${action}" does not match track's current lane "${track.lane_status}"` });
    }

    // worker_dispatch has no project_id of its own — the WHERE EXISTS guards
    // against dispatching to a worker registered on a different project than
    // the track (worker_dispatch.track_number alone isn't unique across
    // projects, so this also protects GET .../dispatch's history query below).
    const { rows: [inserted], rowCount } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action)
       SELECT $1, $2, $3
       WHERE EXISTS (SELECT 1 FROM workers WHERE id = $1 AND project_id = $4)
       RETURNING id`,
      [worker_id, track.track_number, action, track.project_id]
    );
    if (rowCount === 0) return res.status(400).json({ error: 'worker does not belong to this track\'s project' });
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI-side: dispatch history for a track (both lane-action and, in theory,
// any project-level entries that happen to share this track_number — in
// practice only lane-action entries have a track_number at all).
app.get('/api/tracks/:id/dispatch', async (req, res) => {
  try {
    const { rows: [track] } = await pool.query('SELECT id, project_id, track_number FROM tracks WHERE id = $1', [req.params.id]);
    if (!track) return res.status(404).json({ error: 'track not found' });

    const { rows } = await pool.query(
      `SELECT wd.* FROM worker_dispatch wd
       JOIN workers w ON w.id = wd.worker_id
       WHERE wd.track_number = $1 AND w.project_id = $2
       ORDER BY wd.created_at DESC`,
      [track.track_number, track.project_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1089: Provisioning targets CRUD
app.get('/api/projects/:id/provision-targets', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM provision_targets WHERE project_id = $1 ORDER BY created_at ASC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error?.({ err }, '[api] Failed to list provision targets') || console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/provision-targets', async (req, res) => {
  try {
    const { id } = req.params;
    const { host, label } = req.body;
    if (!host || typeof host !== 'string' || !host.trim()) {
      return res.status(400).json({ error: 'host is required' });
    }
    const userUid = req.user?.uid || null;
    const result = await pool.query(
      `INSERT INTO provision_targets (project_id, user_uid, host, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, host) DO UPDATE SET label = EXCLUDED.label
       RETURNING *`,
      [id, userUid, host.trim(), label?.trim() || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error?.({ err }, '[api] Failed to create provision target') || console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/provision-targets/:targetId', async (req, res) => {
  try {
    const { id, targetId } = req.params;
    const result = await pool.query(
      'DELETE FROM provision_targets WHERE id = $1 AND project_id = $2 RETURNING id',
      [targetId, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Target not found' });
    }
    res.json({ success: true, id: Number(targetId) });
  } catch (err) {
    logger.error?.({ err }, '[api] Failed to delete provision target') || console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// UI-side: enqueue a project-scoped (deploy / provision) dispatch entry — no track_number,
// since project-level actions aren't tied to any one track's lane.
app.post('/api/projects/:id/dispatch', async (req, res) => {
  try {
    let { worker_id, action, payload, track_number } = req.body;
    if (!action) return res.status(400).json({ error: 'action is required' });

    // Track 1112 D7: the "Merge to main" button doesn't make the client
    // pick a worker — it resolves server-side, reusing 1084's
    // resolveAssignee/resolvePinnedWorkers so the merge lands on whichever
    // worker is already holding that track's session (continuity-first),
    // falling back to any live worker for the project only when the
    // assignee has none of their own (claimable-tracks' same zero-config
    // fallback). A caller MAY still pass worker_id explicitly (tests, or a
    // future "pick a worker" UI) — resolution only fires when it's absent.
    // Track 1114: same auto-resolution as merge-worktree, extended to
    // remove-worktree and auto-complete-track — none of these should make
    // the client pick a worker. remove-worktree and refresh-worktrees are
    // the exceptions to requiring a track_number: neither is scoped to a
    // single track (a detached worktree has no track-* branch to resolve
    // an assignee from; a cache refresh isn't track-scoped at all), so
    // both always fall straight to "any live worker for the project."
    // Track 10018: create-pr/merge-pr are the pr-mode siblings of
    // merge-worktree — same worker-resolution treatment (a track-scoped
    // git/gh operation, not something the client should be picking a
    // worker for).
    if ((action === 'merge-worktree' || action === 'remove-worktree' || action === 'auto-complete-track' || action === 'refresh-worktrees' || action === 'discard-track' || action === 'create-pr' || action === 'merge-pr') && !worker_id) {
      const trackNumber = payload?.track_number;
      if (action !== 'remove-worktree' && action !== 'refresh-worktrees' && !trackNumber) {
        return res.status(400).json({ error: `payload.track_number is required for ${action}` });
      }

      const { rows: [project] } = await pool.query('SELECT owner_uid FROM projects WHERE id = $1', [req.params.id]);
      if (!project) return res.status(404).json({ error: 'project not found' });

      let resolvedWorkerId = null;
      if (trackNumber) {
        const { rows: [track] } = await pool.query(
          'SELECT assignee_uid, created_by_uid FROM tracks WHERE project_id = $1 AND track_number = $2',
          [req.params.id, String(trackNumber)]
        );
        const assignee = track ? resolveAssignee(track, project) : null;
        if (assignee) {
          const own = await resolvePinnedWorkers(pool, req.params.id, assignee);
          if (own.length > 0) resolvedWorkerId = own[0].id;
        }
      }
      if (!resolvedWorkerId) {
        const { rows: any } = await pool.query(
          `SELECT id FROM workers WHERE project_id = $1 AND last_heartbeat > NOW() - INTERVAL '60 seconds' ORDER BY id LIMIT 1`,
          [req.params.id]
        );
        resolvedWorkerId = any[0]?.id ?? null;
      }
      if (!resolvedWorkerId) return res.status(400).json({ error: `no worker available for this project to run ${action} on` });
      worker_id = resolvedWorkerId;
    }

    if (!worker_id || !action) return res.status(400).json({ error: 'worker_id and action are required' });
    if ((action === 'deploy' || action === 'build_and_deploy') && !payload?.environment) {
      return res.status(400).json({ error: 'payload.environment is required for deploy' });
    }

    if (action === 'provision-worker') {
      if (!payload?.target_host) {
        return res.status(400).json({ error: 'payload.target_host is required for provision-worker' });
      }
      if (req.params.id && req.params.id !== 'null') {
        const targetProjId = payload.target_project_id || req.params.id;
        const { rows: targets } = await pool.query(
          'SELECT id FROM provision_targets WHERE project_id = $1 AND host = $2',
          [targetProjId, payload.target_host]
        );
        if (targets.length === 0) {
          return res.status(400).json({ error: `target_host '${payload.target_host}' is not a registered provision target for project` });
        }
      }
    }

    if (action === 'deploy' && (payload?.buildId || payload?.build_id)) {
      const buildId = payload.buildId || payload.build_id;
      if (req.params.id !== 'null') {
        const { rows: [proj] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
        if (proj?.repo_path) {
          const build = getBuildById(proj.repo_path, buildId);
          if (!build) {
            return res.status(404).json({ error: `Build artifact '${buildId}' not found` });
          }
        }
      }
    }

    const trackNum = track_number || payload?.track_number || null;
    const projId = req.params.id === 'null' || !req.params.id ? null : req.params.id;

    const { rows: [inserted], rowCount } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (
         SELECT 1 FROM workers
         WHERE id = $1
           AND (project_id IS NOT DISTINCT FROM $5 OR (type = 'manager' AND $5 IS NULL) OR $3 = 'provision-worker')
       )
       RETURNING id`,
      [worker_id, trackNum, action, payload ? JSON.stringify(payload) : null, projId]
    );
    if (rowCount === 0) return res.status(400).json({ error: 'worker does not belong to this project' });
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1114 follow-up: named convenience route for forcing a worktree
// cache re-audit, so the Worktrees panel doesn't have to know the
// underlying dispatch action name — thin wrapper over the same
// worker-resolution + insert the generic /dispatch endpoint does for
// refresh-worktrees, since this action is never track-scoped.
app.post('/api/projects/:id/worktrees/refresh', async (req, res) => {
  try {
    const { rows: any } = await pool.query(
      `SELECT id FROM workers WHERE project_id = $1 AND last_heartbeat > NOW() - INTERVAL '60 seconds' ORDER BY id LIMIT 1`,
      [req.params.id]
    );
    const workerId = any[0]?.id ?? null;
    if (!workerId) return res.status(400).json({ error: 'no worker available for this project to refresh worktrees' });

    const { rows: [inserted] } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       VALUES ($1, NULL, 'refresh-worktrees', NULL)
       RETURNING id`,
      [workerId]
    );
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/deploy', async (req, res) => {
  try {
    const { worker_id, environment, buildId } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id is required' });
    if (!environment) return res.status(400).json({ error: 'environment is required' });

    if (buildId) {
      const { rows: [proj] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
      if (proj?.repo_path) {
        const build = getBuildById(proj.repo_path, buildId);
        if (!build) {
          return res.status(404).json({ error: `Build artifact '${buildId}' not found` });
        }
      }
    }

    const payload = { environment, ...(buildId ? { buildId } : {}) };

    const { rows: [inserted], rowCount } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (SELECT 1 FROM workers WHERE id = $1 AND project_id = $5)
       RETURNING id`,
      [worker_id, null, 'deploy', JSON.stringify(payload), req.params.id]
    );
    if (rowCount === 0) return res.status(400).json({ error: 'worker does not belong to this project' });
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1091 Phase 1 Task 3: create-project dispatch, global (not
// project-scoped) — a manager worker's own project_id is null, so unlike
// deploy/lane-action dispatch this can't validate the worker against an
// existing :id in the URL. Restricted to type: 'manager' workers only.
app.post('/api/dispatch/create-project', requireAuth, async (req, res) => {
  try {
    const { worker_id, payload } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id is required' });
    if (!payload?.repo_source) return res.status(400).json({ error: 'payload.repo_source is required' });

    const workerResult = await pool.query('SELECT id, type FROM workers WHERE id = $1', [worker_id]);
    if (workerResult.rows.length === 0) return res.status(404).json({ error: 'worker not found' });
    if (workerResult.rows[0].type !== 'manager') {
      return res.status(400).json({ error: 'create-project dispatch requires a manager-type worker' });
    }

    const { rows: [inserted] } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [worker_id, null, 'create-project', JSON.stringify(payload)]
    );
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1089 Phase 6: provision-worker dispatch, restricted to type:
// 'manager' workers — same reasoning as create-project just above. A
// manager's project_id is always null, so the existing project-scoped
// POST /api/projects/:id/dispatch can never validate it (that endpoint
// requires the dispatched-to worker to belong to the given project).
//
// The chosen manager IS the machine choice: a manager is a machine-level
// singleton, and it starts the worker locally on its own machine (no SSH
// — see track 1089 index.md). It resolves the project folder itself from
// its own --projects-dir, so no path is passed here.
app.post('/api/dispatch/provision-worker', requireAuth, async (req, res) => {
  try {
    const { worker_id, payload } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id is required' });
    if (!payload?.project_name) return res.status(400).json({ error: 'payload.project_name is required' });

    const workerResult = await pool.query('SELECT id, type FROM workers WHERE id = $1', [worker_id]);
    if (workerResult.rows.length === 0) return res.status(404).json({ error: 'worker not found' });
    if (workerResult.rows[0].type !== 'manager') {
      return res.status(400).json({ error: 'provision-worker dispatch requires a manager-type worker' });
    }

    let workerNumber = payload?.worker_number;
    if (!workerNumber && payload?.project_id) {
      const numRes = await pool.query(
        "SELECT COALESCE(MAX(worker_number), 0) + 1 as next_num FROM workers WHERE project_id = $1",
        [payload.project_id]
      );
      workerNumber = numRes.rows[0]?.next_num || 1;
    }
    const finalPayload = { ...payload, worker_number: workerNumber || 1 };

    const { rows: [inserted] } = await pool.query(
      `INSERT INTO worker_dispatch(worker_id, track_number, action, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [worker_id, null, 'provision-worker', JSON.stringify(finalPayload)]
    );
    res.json({ ok: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1091 Phase 4: poll a create-project dispatch's status/result. Global
// like its POST counterpart above — a create-project dispatch has no
// project to scope the URL to (that's the whole point of it).
app.get('/api/dispatch/:dispatchId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, worker_id, action, status, result, created_at, claimed_at FROM worker_dispatch WHERE id = $1',
      [req.params.dispatchId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Dispatch not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI-side: deploy dispatch history for a project (track_number IS NULL
// entries only — lane-action history is per-track, see GET .../tracks/:id/dispatch).
app.get('/api/projects/:id/dispatch', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wd.*, w.hostname as worker_hostname, w.worker_number
       FROM worker_dispatch wd
       JOIN workers w ON w.id = wd.worker_id
       WHERE w.project_id = $1 AND wd.track_number IS NULL
       ORDER BY wd.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1087 Phase 8: a worker's own chat turns, so the Activity panel can
// restore the conversation after a page refresh. The turns were always
// persisted (prompt in payload.prompt, reply in result) — the panel just
// had no way to read them back. Worker-scoped rather than project-scoped
// like GET /api/projects/:id/dispatch above, which mixes in deploys and
// can't address a manager worker at all (its project_id is null).
// Returned oldest-first so the client can render them straight down as a
// conversation.
app.get('/api/workers/:id/chat-history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const workerId = parseInt(req.params.id);

    // Remote mode: a chat transcript is private content, so scope it the
    // same way GET /api/workers scopes the worker list — own workers, or
    // ones explicitly shared with this user. Without this, any signed-in
    // user could read any other user's worker conversations by id.
    // AUTH_ENABLED is false in local single-user mode, where this is moot.
    if (AUTH_ENABLED) {
      const uid = req.user?.uid || null;
      const { rows: allowed } = await pool.query(
        `SELECT 1 FROM workers w
          WHERE w.id = $1 AND (
            w.visibility = 'public'
            OR w.user_uid = $2
            OR w.user_uid IS NULL
            OR (w.visibility = 'team' AND EXISTS (
                  SELECT 1 FROM worker_permissions wp
                   WHERE wp.worker_id = w.id AND wp.user_uid = $2))
          )`,
        [workerId, uid]
      );
      if (allowed.length === 0) return res.status(404).json({ error: 'worker not found' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT id, worker_id, track_number, action, payload, status, result, created_at
         FROM worker_dispatch
         WHERE worker_id = $1 AND action IN ('worker_adhoc_chat', 'track_chat')
         ORDER BY created_at DESC
         LIMIT $2
       ) recent ORDER BY created_at ASC`,
      [workerId, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI-side: which deploy environments this project has configured, for the
// "Deploy Now" dropdown. Reads conductor/deploy.json directly off disk (it
// isn't synced into conductor_files like workflow.json/product.md are).
app.get('/api/projects/:id/deploy-environments', async (req, res) => {
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const deployJsonPath = project.repo_path ? join(project.repo_path, 'conductor', 'deploy.json') : null;
    if (!deployJsonPath || !existsSync(deployJsonPath)) return res.json({ environments: [], defaultEnvironment: null });

    const deployConfig = JSON.parse(readFileSync(deployJsonPath, 'utf8'));
    const envs = Object.keys(deployConfig.environments || {});
    const defaultEnv = deployConfig.defaultEnvironment && envs.includes(deployConfig.defaultEnvironment)
      ? deployConfig.defaultEnvironment
      : (envs[0] || null);

    res.json({ environments: envs, defaultEnvironment: defaultEnv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI-side: full deployment configuration read/write (conductor/deploy.json)
app.get('/api/projects/:id/deploy-config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const deployJsonPath = project.repo_path ? join(project.repo_path, 'conductor', 'deploy.json') : null;
    if (!deployJsonPath || !existsSync(deployJsonPath)) {
      return res.json({ environments: {} });
    }

    const deployConfig = JSON.parse(readFileSync(deployJsonPath, 'utf8'));
    if (!deployConfig.environments || typeof deployConfig.environments !== 'object') {
      deployConfig.environments = {};
    }
    res.json(deployConfig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/deploy-config', async (req, res) => {
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { environments, defaultEnvironment } = req.body || {};
    if (!environments || typeof environments !== 'object' || Array.isArray(environments)) {
      return res.status(400).json({ error: 'environments object is required' });
    }

    for (const [envName, envConfig] of Object.entries(environments)) {
      if (!envConfig || typeof envConfig !== 'object' || Array.isArray(envConfig)) {
        return res.status(400).json({ error: `Environment "${envName}" must be an object` });
      }
      const hasCommand = typeof envConfig.command === 'string';
      const hasCommands = Array.isArray(envConfig.commands) && envConfig.commands.every(c =>
        typeof c === 'string' || (typeof c === 'object' && c !== null && typeof c.command === 'string')
      );
      if (!hasCommand && !hasCommands) {
        return res.status(400).json({ error: `Environment "${envName}" must have a command string or commands array` });
      }
    }

    if (defaultEnvironment !== undefined && defaultEnvironment !== null && defaultEnvironment !== '') {
      if (typeof defaultEnvironment !== 'string' || !environments[defaultEnvironment]) {
        return res.status(400).json({ error: `defaultEnvironment "${defaultEnvironment}" must match a configured environment` });
      }
    }

    if (!project.repo_path) {
      return res.status(400).json({ error: 'Project has no repo_path configured' });
    }

    const conductorDir = join(project.repo_path, 'conductor');
    if (!existsSync(conductorDir)) {
      mkdirSync(conductorDir, { recursive: true });
    }

    const deployJsonPath = join(conductorDir, 'deploy.json');
    const fullConfig = {
      ...req.body,
      environments,
      ...(defaultEnvironment ? { defaultEnvironment } : {}),
    };
    if (!defaultEnvironment) {
      delete fullConfig.defaultEnvironment;
    }
    writeFileSync(deployJsonPath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf8');

    res.json({ ok: true, environments, defaultEnvironment: fullConfig.defaultEnvironment || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deploy Script Builder (Track 1098) ───────────────────────────────────────
app.post('/api/projects/:id/deploy-script', async (req, res) => {
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (!project.repo_path) return res.status(400).json({ error: 'Project has no repo_path configured' });

    const { script, provider, db, secrets, environments } = req.body || {};
    if (!script || typeof script !== 'string') {
      return res.status(400).json({ error: 'script string is required' });
    }

    // Write to scripts/deploy.sh (create dir if missing)
    const scriptsDir = join(project.repo_path, 'scripts');
    if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });

    const scriptPath = join(scriptsDir, 'deploy.sh');
    writeFileSync(scriptPath, script, 'utf8');

    // Make executable
    try { chmodSync(scriptPath, 0o755); } catch (_) { /* non-fatal on Windows */ }

    res.json({
      ok: true,
      path: 'scripts/deploy.sh',
      provider, db, secrets,
      environments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Build Artifact Management (Track 1097) ───────────────────────────────────
app.get('/api/projects/:id/builds', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (!project.repo_path) return res.json({ builds: [] });

    const builds = getBuilds(project.repo_path);
    res.json({ builds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/builds', async (req, res) => {
  try {
    const { rows: [project] } = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (!project.repo_path) {
      return res.status(400).json({ error: 'Project has no repo_path configured' });
    }

    const createdBy = req.user?.email || req.body?.createdBy || 'system';
    const build = createBuildArtifact(project.repo_path, {
      createdBy,
      trackIds: req.body?.trackIds
    });

    res.json({ ok: true, build });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ── API Key Management ────────────────────────────────────────────────────────

// Resolve the calling user's uid — returns null when auth is disabled (local-api mode)
function resolveUid(req) {
  return req.user?.uid ?? null;
}

// Track 1084: resolve which developer is responsible for a track —
// explicit assignee, falling back to the track's creator, falling back to
// the project owner. Pure function; track/project are plain row objects.
function resolveAssignee(track, project) {
  return track.assignee_uid ?? track.created_by_uid ?? project.owner_uid ?? null;
}

// Track 1084: all of a developer's own workers for a project (may be
// empty). "Own" = registered under their identity (workers.user_uid, set
// automatically at registration via API key/Firebase auth — see
// /worker/register) — not a separate pin/grant mechanism. A developer
// running workers on several machines under the same identity (e.g. a
// laptop and a cloud VM) already gets all of them here; routing to a
// worker registered under someone *else's* identity is deliberately not
// supported — that would mean dispatching work to another person's
// machine, a real security boundary that needs its own explicit
// consent/permission design, not just a query.
async function resolvePinnedWorkers(pool, projectId, userUid) {
  if (!userUid) return [];
  const { rows } = await pool.query(
    'SELECT * FROM workers WHERE project_id = $1 AND user_uid = $2',
    [projectId, userUid]
  );
  return rows;
}

// Track 1084 Phase 4: collapse an assignee's own workers into a single
// status for the track card badge — 'busy' if any is actively working,
// 'idle' if any is alive but idle, 'offline' if all of them have gone
// stale, or null if the assignee has no workers at all (nothing to show).
const ASSIGNEE_WORKER_STALE_MS = 120_000;
function resolveAssigneeWorkerStatus(workers, now = new Date()) {
  if (!workers || workers.length === 0) return null;
  const nowMs = now.getTime();
  const fresh = workers.filter(w => nowMs - new Date(w.last_heartbeat).getTime() < ASSIGNEE_WORKER_STALE_MS);
  if (fresh.some(w => w.status === 'busy')) return 'busy';
  if (fresh.length > 0) return 'idle';
  return 'offline';
}

// Generate a new API key for the authenticated user (remote-api mode)
app.post('/api/keys', requireAuth, async (req, res) => {
  try {
    const user_uid = resolveUid(req);
    const name = req.body.name || null;
    // Generate key: lc_live_<random hex>
    const rawKey = `lc_live_${randomUUID().replace(/-/g, '')}`;
    const key_hash = hashApiKey(rawKey);
    const key_prefix = rawKey.slice(0, 16); // lc_live_XXXXXXXX
    await pool.query(
      'INSERT INTO api_keys(user_uid, key_hash, key_prefix, name) VALUES($1, $2, $3, $4)',
      [user_uid, key_hash, key_prefix, name]
    );
    // Return the raw key ONCE — it cannot be recovered later
    res.json({ ok: true, key: rawKey, key_prefix, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List API keys for the authenticated user (shows prefix only, never raw key)
app.get('/api/keys', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, key_prefix, name, created_at, last_used_at FROM api_keys WHERE user_uid IS NOT DISTINCT FROM $1 ORDER BY created_at DESC',
      [resolveUid(req)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke an API key
app.delete('/api/keys/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM api_keys WHERE id = $1 AND user_uid IS NOT DISTINCT FROM $2',
      [req.params.id, resolveUid(req)]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'key not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Worker Visibility & Permissions ───────────────────────────────────────────

// Update worker visibility (owner only)
app.patch('/api/workers/:id/visibility', requireAuth, async (req, res) => {
  try {
    const { visibility } = req.body;
    if (!['private', 'team', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be private, team, or public' });
    }
    const { rowCount } = await pool.query(
      'UPDATE workers SET visibility = $1 WHERE id = $2 AND (user_uid = $3 OR user_uid IS NULL)',
      [visibility, req.params.id, resolveUid(req)]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'worker not found or not owner' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get team permissions for a worker (owner sees who has access)
app.get('/api/workers/:id/permissions', requireAuth, async (req, res) => {
  try {
    const { rows: workers } = await pool.query(
      'SELECT id FROM workers WHERE id = $1 AND (user_uid = $2 OR user_uid IS NULL)',
      [req.params.id, req.user.uid]
    );
    if (workers.length === 0) return res.status(404).json({ error: 'worker not found or not owner' });
    const { rows } = await pool.query(
      'SELECT user_uid, added_at FROM worker_permissions WHERE worker_id = $1',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grant a user access to your worker (team visibility)
app.post('/api/workers/:id/permissions', requireAuth, async (req, res) => {
  try {
    const { user_uid } = req.body;
    if (!user_uid) return res.status(400).json({ error: 'user_uid is required' });
    const { rows: workers } = await pool.query(
      'SELECT id FROM workers WHERE id = $1 AND (user_uid = $2 OR user_uid IS NULL)',
      [req.params.id, req.user.uid]
    );
    if (workers.length === 0) return res.status(404).json({ error: 'worker not found or not owner' });
    await pool.query(
      'INSERT INTO worker_permissions(worker_id, user_uid) VALUES($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, user_uid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke a user's access to your worker
app.delete('/api/workers/:id/permissions/:uid', requireAuth, async (req, res) => {
  try {
    const { rows: workers } = await pool.query(
      'SELECT id FROM workers WHERE id = $1 AND (user_uid = $2 OR user_uid IS NULL)',
      [req.params.id, req.user.uid]
    );
    if (workers.length === 0) return res.status(404).json({ error: 'worker not found or not owner' });
    await pool.query(
      'DELETE FROM worker_permissions WHERE worker_id = $1 AND user_uid = $2',
      [req.params.id, req.params.uid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track 1084: Assignee & Worker Pins ──────────────────────────────────────────

// Set (or clear, with assignee_uid: null) a track's explicit assignee
app.patch('/api/projects/:id/tracks/:num/assignee', async (req, res) => {
  try {
    const { assignee_uid } = req.body;
    if (assignee_uid !== null && typeof assignee_uid !== 'string') {
      return res.status(400).json({ error: 'assignee_uid must be a string or null' });
    }
    const { rowCount } = await pool.query(
      'UPDATE tracks SET assignee_uid = $1 WHERE project_id = $2 AND track_number = $3',
      [assignee_uid, req.params.id, req.params.num]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'track not found' });
    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track 1084 Phase 3: which of this project's queue-status tracks a given
// worker is currently allowed to claim. Fetched once per auto-launch cycle
// (not per track) — the worker has "zero DB knowledge" per its own design,
// so authorization stays server-side, reusing resolveAssignee/
// resolvePinnedWorkers.
//
// Rule (matches track 1084's design): resolve the track's assignee
// (assignee_uid ?? created_by_uid ?? project.owner_uid); if that assignee has
// no workers of their own registered at all, the track is open to any
// worker (today's zero-config behavior, unchanged). If they do, only one of
// their own workers (workers.user_uid — set at registration, not a separate
// grant) may claim it. (Continuity-first routing via track_sessions — track
// 1086 — is a follow-up once that table exists; this is the assignee gate
// alone.)
app.get('/api/projects/:id/claimable-tracks', async (req, res) => {
  try {
    const workerId = req.query.worker_id ? parseInt(req.query.worker_id) : null;
    if (!workerId) return res.status(400).json({ error: 'worker_id is required' });

    const { rows: [project] } = await pool.query('SELECT owner_uid FROM projects WHERE id = $1', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { rows: tracks } = await pool.query(
      "SELECT track_number, assignee_uid, created_by_uid FROM tracks WHERE project_id = $1 AND lane_action_status = 'queue'",
      [req.params.id]
    );

    const ownWorkersCache = new Map(); // user_uid -> Set(worker_id) — avoid re-querying per track
    const claimable = [];
    for (const track of tracks) {
      const assignee = resolveAssignee(track, project);
      if (!assignee) { claimable.push(track.track_number); continue; } // no owner info at all — open claim

      if (!ownWorkersCache.has(assignee)) {
        const own = await resolvePinnedWorkers(pool, req.params.id, assignee);
        ownWorkersCache.set(assignee, new Set(own.map(w => w.id)));
      }
      const candidates = ownWorkersCache.get(assignee);
      if (candidates.size === 0 || candidates.has(workerId)) claimable.push(track.track_number);
    }

    res.json({ claimable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project Registration ────────────────────────────────────────────────────────
app.post('/project/ensure', async (req, res, next) => {
  if (AUTH_ENABLED) {
    return requireAuth(req, res, next);
  }
  return collectorAuth(req, res, next);
}, async (req, res) => {
  try {
    const { git_remote, name, repo_path, primary_cli, primary_model, dev_command, dev_url } = req.body;
    let user_uid = req.body.user_uid || null;
    let git_global_id = null;

    if (AUTH_ENABLED && req.user) {
      user_uid = req.user.uid;
    }

    if (git_remote) {
      git_global_id = gitGlobalId(git_remote);
    }

    // 1. Upsert Project
    const projRes = await pool.query(`
    INSERT INTO projects (name, repo_path, git_remote, git_global_id, primary_cli, primary_model, dev_command, dev_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (repo_path) DO UPDATE SET
      name = EXCLUDED.name,
      git_remote = EXCLUDED.git_remote,
      git_global_id = EXCLUDED.git_global_id,
      primary_cli = EXCLUDED.primary_cli,
      primary_model = EXCLUDED.primary_model,
      dev_command = CASE WHEN EXCLUDED.dev_command IS NOT NULL THEN EXCLUDED.dev_command ELSE projects.dev_command END,
      dev_url = CASE WHEN EXCLUDED.dev_url IS NOT NULL THEN EXCLUDED.dev_url ELSE projects.dev_url END
    RETURNING id
  `, [name, repo_path, git_remote, git_global_id, primary_cli, primary_model, dev_command || null, dev_url || null]);

    const project_id = projRes.rows[0].id;

    // 2. Add user to project_members if provided
    if (user_uid) {
      // First user becomes owner, subsequent become member. Handled naturally: 
      // if no rows exist for this project, role is 'owner'.
      const membersRes = await pool.query('SELECT COUNT(*) FROM project_members WHERE project_id = $1', [project_id]);
      const role = parseInt(membersRes.rows[0].count, 10) === 0 ? 'owner' : 'member';

      await pool.query(`
      INSERT INTO project_members (project_id, user_uid, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (project_id, user_uid) DO NOTHING
    `, [project_id, user_uid, role]);
    }

    res.json({ project_id, git_global_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Auto-populate git_global_id on startup if project has git_remote but no git_global_id
async function ensureGitGlobalId() {
  try {
    const r = await pool.query(
      'SELECT id, git_remote, git_global_id FROM projects WHERE git_remote IS NOT NULL AND git_global_id IS NULL'
    );
    for (const row of r.rows) {
      const uuid = gitGlobalId(row.git_remote);
      await pool.query('UPDATE projects SET git_global_id = $1 WHERE id = $2', [uuid, row.id]);
      console.log(`[collector] git_global_id populated for project ${row.id}: ${uuid}`);
    }
  } catch (err) {
    console.warn(`[collector] Could not populate git_global_id: ${err.message}`);
  }
}

if (process.env.NODE_ENV !== 'test') {
  // Without this handler, a failed listen() (e.g. EADDRINUSE from a stale/
  // duplicate process still holding the port) is an unhandled 'error' event
  // and crashes with a raw stack trace instead of a clear, logged exit.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ err, port: PORT }, `[LaneConductor API] Port ${PORT} already in use — another instance is likely still running`);
    } else {
      logger.error({ err, port: PORT }, '[LaneConductor API] Failed to start listening');
    }
    process.exit(1);
  });

  server.listen(PORT, async () => {
    console.log(`[LaneConductor API] Listening on:${PORT}`);
    // console.log('[LaneConductor API] Auth: configured via auth module');
    // ensureGitGlobalId() is removed or needs an explicit project DB poll if needed, better skip for now since it's collector specific
    console.log(`[LaneConductor API] http://localhost:${PORT}/api/health`);
  });
}

// ── Server Shutdown ────────────────────────────────────────────────────────────
// Kill all running dev servers on process exit
process.on('exit', () => {
  for (const [projectId, { pid }] of devServers.entries()) {
    try {
      kill(pid, 'SIGTERM');
    } catch (e) {
      // Process might already be dead
    }
  }
  devServers.clear();
});
