import { createHash, randomUUID } from 'crypto';
import express from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import cors from 'cors';
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync, statSync, appendFileSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { kill } from 'process';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { initWebSocket, broadcast } from './wsBroadcast.mjs';
import { slugify, trackTemplates, appendRegressionTest } from './utils.mjs';
import { loadAuthConfig, authRouter, requireAuth, AUTH_ENABLED, TEST_MODE } from './auth.mjs';

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

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});


const app = express();
const server = createServer(app);
initWebSocket(server);

// ── Dev Servers (per project) ────────────────────────────────────────────────
// Map: projectId -> { proc, pid, url }
const devServers = new Map();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8090', 'http://127.0.0.1:8090'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

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
      SELECT w.id, w.hostname, w.pid, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, w.mode, p.name AS project_name
       FROM workers w
       JOIN projects p ON p.id = w.project_id
       WHERE w.project_id = $1 AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'
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

app.get('/api/workers', async (req, res) => {
  try {
    const userId = req.user?.uid || null;

    let queryStr = `
      SELECT w.id, w.hostname, w.pid, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, w.mode,
              p.id AS project_id, p.name AS project_name, p.repo_path
       FROM workers w
       JOIN projects p ON p.id = w.project_id
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

    const { stdout, stderr } = await execAsync('make lc-start', { cwd: repo_path });
    res.json({ ok: true, stdout, stderr });
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
              t.auto_implement_launched, t.auto_review_launched,
              t.lane_action_status, t.lane_action_result, t.priority,
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
           AND uc.author IN ('claude', 'gemini')
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
    res.json(result.rows);
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
    const { title, description = '', type = 'feature' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

    // Get project repo_path
    const projResult = await pool.query(
      'SELECT id, repo_path FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { repo_path } = projResult.rows[0];

    // Compute next track number
    const numResult = await pool.query(
      `SELECT COALESCE(MAX(CAST(track_number AS INTEGER)), 0) + 1 AS next_num
       FROM tracks WHERE project_id = $1 AND track_number ~ '^[0-9]+$'`,
      [req.params.id]
    );
    const nextNum = numResult.rows[0].next_num;
    const trackNumber = String(nextNum).padStart(3, '0');

    // Register in DB via collector as 'queue' for automation
    await collectorWrite('POST', '/track', {
      track_number: trackNumber,
      title: title.trim(),
      content_summary: description.trim(),
      lane_status: 'plan',
      progress_percent: 0,
      last_updated_by: 'human'
    }, req.params.id);

    // Write a typed track-create entry to file_sync_queue.md
    // The sync worker processes pending entries and creates track folders + DB rows
    const queuePath = join(repo_path, 'conductor', 'tracks', 'file_sync_queue.md');
    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${trackNumber}: ${title.trim()}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${title.trim()}\n**Description**: ${description.trim() || 'No description.'}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;

    // 1. Sync to local filesystem (if possible)
    try {
      let existingQueue = existsSync(queuePath) ? readFileSync(queuePath, 'utf8') : '# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n';
      // Insert before "## Config Sync Requests" section
      existingQueue = existingQueue.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
      writeFileSync(queuePath, existingQueue, 'utf8');
    } catch (e) {
      console.warn(`[queue] Failed to write local file_sync_queue.md: ${e.message}`);
    }

    // 2. Queue for remote worker sync (DB → Filesystem)
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
           AND uc.author IN ('claude', 'gemini')
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

    const result = await pool.query(
      `SELECT t.id AS track_id, t.track_number, t.title, t.lane_status,
              t.lane_action_status,
              p.id AS project_id, p.name AS project_name,
              lc.author AS last_comment_author, lc.body AS last_comment_body, lc.created_at AS last_comment_at,
              uc.unreplied_count, hr.human_needs_reply
       FROM tracks t
       JOIN projects p ON p.id = t.project_id
       JOIN LATERAL (
         SELECT body, author, created_at FROM track_comments
         WHERE track_id = t.id AND is_hidden = FALSE ORDER BY created_at DESC LIMIT 1
       ) lc ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS unreplied_count FROM track_comments uc
         WHERE uc.track_id = t.id
           AND uc.author IN ('claude', 'gemini')
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
       WHERE 1=1 ${projectFilter}
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

    console.log(`[workflow] Updated workflow.json for project ${req.params.id}`);
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
      'SELECT primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files } = r.rows[0];

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
      db: lcJson.db || null,
      ui_port: lcJson.ui?.port || 8090,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/config', async (req, res) => {
  try {
    const { primary, secondary, dev, create_quality_gate, collectors, db, ui_port } = req.body;

    const dbResult = await pool.query(
      'SELECT repo_path, conductor_files FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (!dbResult.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const { repo_path, conductor_files } = dbResult.rows[0];

    // Update DB columns
    await pool.query(
      `UPDATE projects SET
        primary_cli = $1, primary_model = $2,
        secondary_cli = $3, secondary_model = $4,
        create_quality_gate = $5
       WHERE id = $6`,
      [
        primary?.cli || null, primary?.model || null,
        secondary?.cli || null, secondary?.model || null,
        create_quality_gate ?? false,
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

    console.log(`[config] Updated project config for project ${req.params.id}`);
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
      `SELECT id, track_number, title, lane_status, progress_percent,
              current_phase, content_summary, last_heartbeat, created_at,
              index_content, plan_content, spec_content, test_content, last_log_tail
       FROM tracks
       WHERE project_id = $1 AND track_number = $2`,
      [req.params.id, req.params.num]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Track not found' });
    const t = result.rows[0];
    res.json({
      track_number: t.track_number,
      title: t.title,
      lane_status: t.lane_status,
      progress_percent: t.progress_percent,
      current_phase: t.current_phase,
      content_summary: t.content_summary,
      last_heartbeat: t.last_heartbeat,
      index: t.index_content,
      plan: t.plan_content,
      spec: t.spec_content,
      test: t.test_content,
      last_log_tail: t.last_log_tail,
    });
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

    // Write back to file
    writeFileSync(trackIndexPath, content, 'utf8');

    console.log(`[sync-to-file] Track ${trackNum} synced: ${Object.keys(updates).join(', ')}`);
    return true;
  } catch (err) {
    console.error(`[sync-to-file] Error syncing track ${trackNum}:`, err.message);
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
              const append = `\n> **human** ${req.body.no_wake ? '(note)' : ''}: ${body}\n`;
              appendFileSync(convPath, append, 'utf8');
              // Advance cursor past the line we just wrote so the worker doesn't re-sync it
              const newSize = existsSync(convPath) ? statSync(convPath).size : 0;
              writeFileSync(cursorPath, String(newSize), 'utf8');
              console.log(`[sync-to-file] Comment synced to ${convPath} (cursor → ${newSize})`);

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

    broadcast('track:updated', { projectId: req.params.id, trackNumber: req.params.num });
    res.json({ ok: true, message: 'Track moved to waiting state' });
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

    // Kill existing dev server if any
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
      cwd: repo_path,
      detached: true,
      stdio: 'ignore'
    });

    devServers.set(projectId, { proc, pid: proc.pid, url: dev_url });

    // Save PID to DB
    await pool.query(
      'UPDATE projects SET dev_server_pid = $1 WHERE id = $2',
      [proc.pid, projectId]
    );

    broadcast('conductor:updated', { projectId });
    res.json({ running: true, pid: proc.pid, url: dev_url });
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

    if (entry?.pid) {
      try {
        // kill with signal 0 checks if process exists without sending signal
        kill(entry.pid, 0);
        running = true;
        pid = entry.pid;
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
      dev_command: devCommand
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

export { app, pool, runMigration, uuidV5, gitGlobalId };

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

  // 1. If global token configured, enforce it.
  if (COLLECTOR_TOKEN_ENV) {
    if (!bearer) return res.status(401).json({ error: 'unauthorized' });
    if (bearer === COLLECTOR_TOKEN_ENV) return next();
  }

  // 2. Identify worker via machine_token
  if (bearer) {
    try {
      let queryArgs = [bearer];
      let queryStr = 'SELECT id, project_id, user_uid, visibility FROM workers WHERE machine_token = $1';
      const requestedProject = req.query.project_id || req.body.project_id;
      if (requestedProject) {
        queryStr += ' AND project_id = $2';
        queryArgs.push(requestedProject);
      }
      const { rows } = await pool.query(queryStr, queryArgs);
      if (rows.length > 0) {
        req.worker_id = rows[0].id;
        req.worker_project_id = rows[0].project_id;
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

    // Fetch old state to detect transitions
    const oldRes = await pool.query(
      'SELECT id, lane_status, lane_action_status FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, track_number]
    );
    const oldTrack = oldRes.rows[0];

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
      index_content, plan_content, spec_content, test_content, insertActionStatus];

    const qRes = await pool.query(`
    INSERT INTO tracks
      (project_id, track_number, title, lane_status, progress_percent,
       current_phase, content_summary, phase_step, index_content, plan_content, spec_content, test_content,
       last_heartbeat, sync_status, last_updated_by, lane_action_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'syncing', 'worker', $13)
    ON CONFLICT (project_id, track_number) DO UPDATE SET
      title            = EXCLUDED.title,
      ${laneStatusClause}
      progress_percent = EXCLUDED.progress_percent,
      current_phase    = EXCLUDED.current_phase,
      content_summary  = EXCLUDED.content_summary,
      phase_step       = EXCLUDED.phase_step,
      index_content    = EXCLUDED.index_content,
      plan_content     = EXCLUDED.plan_content,
      spec_content     = EXCLUDED.spec_content,
      test_content     = COALESCE(EXCLUDED.test_content, tracks.test_content),
      last_heartbeat   = NOW(),
      sync_status      = 'syncing',
      last_updated_by  = 'worker'
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
    res.json({ ok: true });
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
      auto_planning_launched, auto_implement_launched, auto_review_launched } = req.body;

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
    await pool.query(
      `UPDATE tracks SET ${sets.join(', ')} WHERE project_id = $1 AND track_number = $2`,
      params
    );

    // ── Sync DB changes back to track files (Phase 3) ──
    const syncUpdates = {};
    if (lane_status !== undefined) syncUpdates.lane_status = lane_status;
    if (lane_action_status !== undefined) syncUpdates.lane_action_status = lane_action_status;
    if (progress_percent !== undefined) syncUpdates.progress_percent = progress_percent;
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

app.post('/track/:num/comment', collectorAuth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
    const { author = 'human', body } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });
    const VALID_AUTHORS = ['human', 'claude', 'gemini'];
    const safeAuthor = VALID_AUTHORS.includes(author) ? author : 'human';

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
    // Resolve user_uid: Firebase auth > API key auth > request body (legacy)
    let user_uid = (AUTH_ENABLED && req.user?.uid) || req.user_uid || req.body.user_uid || null;

    const projectId = req.body.project_id ? parseInt(req.body.project_id) : null;
    if (!projectId) return res.status(400).json({ error: 'project_id is required' });

    // Resolve visibility from request body (worker sends its configured visibility)
    const visibility = req.body.visibility || 'private';

    // First check if this specific worker process already has a machine token
    let r = await pool.query('SELECT machine_token FROM workers WHERE project_id = $1 AND hostname = $2 AND pid = $3', [projectId, hostname, pid]);
    let machine_token = r.rows[0]?.machine_token;

    if (!machine_token) {
      machine_token = randomUUID();
    }

    await pool.query(`
    INSERT INTO workers(project_id, hostname, pid, status, machine_token, user_uid, visibility, mode, last_heartbeat)
    VALUES($1, $2, $3, 'idle', $4, $5, $6, $7, NOW())
    ON CONFLICT(project_id, hostname, pid) DO UPDATE SET
    status = 'idle', machine_token = EXCLUDED.machine_token, user_uid = EXCLUDED.user_uid,
    mode = EXCLUDED.mode,
    last_heartbeat = NOW()
  `, [projectId, hostname, pid, machine_token, user_uid, visibility, mode || 'polling']);


    broadcast('worker:updated', { projectId });
    res.json({ ok: true, machine_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/worker/heartbeat', collectorAuth, async (req, res) => {
  try {
    console.log('[API] /worker/heartbeat body:', req.body);
    const { hostname, pid, status, current_task, mode } = req.body;
    const projectId = req.worker_project_id || (req.body.project_id ? parseInt(req.body.project_id) : null);
    const sets = ['last_heartbeat = NOW()'];
    const params = [projectId, hostname, pid];
    let i = 4;
    if (status) { sets.push(`status = $${i++} `); params.push(status); }
    if (current_task !== undefined) { sets.push(`current_task = $${i++} `); params.push(current_task); }
    if (mode) { sets.push(`mode = $${i++} `); params.push(mode); }
    await pool.query(
      `UPDATE workers SET ${sets.join(', ')}
      WHERE project_id = $1 AND hostname = $2 AND pid = $3`,
      params
    );
    broadcast('worker:updated', { projectId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/worker', collectorAuth, async (req, res) => {
  try {
    const { hostname, pid } = req.body;
    const projectId = req.worker_project_id || (req.body.project_id ? parseInt(req.body.project_id) : null);
    await pool.query(
      'DELETE FROM workers WHERE project_id = $1 AND hostname = $2 AND pid = $3',
      [projectId, hostname, pid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API Key Management ────────────────────────────────────────────────────────

// Resolve the calling user's uid — returns null when auth is disabled (local-api mode)
function resolveUid(req) {
  return req.user?.uid ?? null;
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
