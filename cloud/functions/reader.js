const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const dns = require("node:dns");

const cloudDbPassword = defineSecret('CLOUD_DB_PASSWORD');
const cloudDbHost = defineSecret('CLOUD_DB_HOST');
const cloudDbUser = defineSecret('CLOUD_DB_USER');

let pool;
function getPool() {
  if (!pool) {
    const host = cloudDbHost.value().trim();
    const user = cloudDbUser.value().trim();
    const port = Number(process.env.CLOUD_DB_PORT || 5432);
    const database = process.env.CLOUD_DB_NAME || "postgres";
    const password = cloudDbPassword.value();

    console.log(`[reader pool] Creating new pool → user: ${user}, host: ${host}, port: ${port}, db: ${database} (forcing IPv4)`);

    pool = new Pool({
      host, port, database, user, password,
      ssl: { rejectUnauthorized: true },
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, callback);
      }
    });
  }
  return pool;
}

const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://app.laneconductor.com', 'http://localhost:8090', 'http://127.0.0.1:8090'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Auth middleware - extract workspace_id from token
async function auth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return res.status(401).json({ error: 'unauthorized: missing token' });

  const db = getPool();

  try {
    if (bearer.startsWith('lc_')) {
      // API token auth (from worker)
      const { rows } = await db.query(
        'SELECT workspace_id FROM api_tokens WHERE token = $1',
        [bearer]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'unauthorized: invalid api token' });
      }
      req.workspace_id = rows[0].workspace_id;
      return next();
    } else {
      // Firebase ID token auth (from UI)
      const decoded = await admin.auth().verifyIdToken(bearer);
      req.user = decoded;

      const { rows } = await db.query(
        'SELECT workspace_id FROM workspace_members WHERE firebase_uid = $1 LIMIT 1',
        [decoded.uid]
      );
      if (rows.length === 0) {
        return res.status(403).json({ error: 'forbidden: no workspace associated with user' });
      }
      req.workspace_id = rows[0].workspace_id;
      return next();
    }
  } catch (err) {
    res.status(401).json({ error: 'unauthorized: invalid token', details: err.message });
  }
}

// Health check
app.get('/health', (req, res) => res.json({ ok: true, cloud: true }));

// ── All projects in workspace ────────────────────────────────────────────────
app.get('/api/projects', auth, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, name, repo_path, git_remote, git_global_id, primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, created_at
       FROM projects
       WHERE workspace_id = $1
       ORDER BY name`,
      [req.workspace_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workers per project ────────────────────────────────────────────────────
app.get('/api/projects/:id/workers', auth, async (req, res) => {
  try {
    const db = getPool();

    // Verify project belongs to workspace
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspace_id]
    );
    if (projResult.rows.length === 0) {
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    const result = await db.query(
      `SELECT id, hostname, pid, status, current_task, last_heartbeat, created_at
       FROM workers
       WHERE project_id = $1 AND last_heartbeat > NOW() - INTERVAL '60 seconds'
       ORDER BY hostname, pid`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tracks per project ─────────────────────────────────────────────────────
app.get('/api/projects/:id/tracks', auth, async (req, res) => {
  try {
    const db = getPool();

    // Verify project belongs to workspace
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspace_id]
    );
    if (projResult.rows.length === 0) {
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    const result = await db.query(
      `SELECT t.id, t.track_number, t.title, t.lane_status, t.progress_percent,
              t.current_phase, t.phase_step, t.content_summary, t.last_heartbeat, t.created_at,
              t.auto_implement_launched, t.auto_review_launched,
              t.lane_action_status, t.lane_action_result,
              p.create_quality_gate,
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
       WHERE t.project_id = $1
       ORDER BY t.track_number`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Conductor context files ─────────────────────────────────────────────────
app.get('/api/projects/:id/conductor', auth, async (req, res) => {
  try {
    const db = getPool();

    // Verify project belongs to workspace
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspace_id]
    );
    if (projResult.rows.length === 0) {
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    const result = await db.query(
      'SELECT conductor_files FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0].conductor_files ?? {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track detail ────────────────────────────────────────────────────────────
app.get('/api/projects/:id/tracks/:num', auth, async (req, res) => {
  try {
    const db = getPool();

    // Verify project belongs to workspace
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspace_id]
    );
    if (projResult.rows.length === 0) {
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    const result = await db.query(
      `SELECT id, track_number, title, lane_status, progress_percent,
              current_phase, content_summary, last_heartbeat, created_at,
              index_content, plan_content, spec_content, last_log_tail
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
      last_log_tail: t.last_log_tail,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track comments ──────────────────────────────────────────────────────────
app.get('/api/projects/:id/tracks/:num/comments', auth, async (req, res) => {
  try {
    const db = getPool();

    // Verify project belongs to workspace
    const projResult = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.workspace_id]
    );
    if (projResult.rows.length === 0) {
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    const trackResult = await db.query(
      'SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2',
      [req.params.id, req.params.num]
    );
    if (trackResult.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const result = await db.query(
      'SELECT id, author, body, is_replied, created_at FROM track_comments WHERE track_id = $1 ORDER BY created_at ASC',
      [trackResult.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All tracks (all projects in workspace) ────────────────────────────────────
app.get('/api/tracks', auth, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
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
       WHERE p.workspace_id = $1
       ORDER BY p.name, t.track_number`,
      [req.workspace_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inbox (latest comments) ─────────────────────────────────────────────────
app.get('/api/inbox', auth, async (req, res) => {
  try {
    const db = getPool();
    const { project_id } = req.query;
    const values = [req.workspace_id];
    const projectFilter = project_id
      ? `AND t.project_id = $${values.push(Number(project_id))}`
      : '';

    const result = await db.query(
      `SELECT t.id AS track_id, t.track_number, t.title, t.lane_status,
              t.lane_action_status,
              p.id AS project_id, p.name AS project_name,
              lc.author AS last_comment_author, lc.body AS last_comment_body, lc.created_at AS last_comment_at,
              uc.unreplied_count, hr.human_needs_reply
       FROM tracks t
       JOIN projects p ON p.id = t.project_id
       JOIN LATERAL (
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
       WHERE p.workspace_id = $1 ${projectFilter}
       ORDER BY lc.created_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

exports.reader = onRequest({ secrets: [cloudDbPassword, cloudDbHost, cloudDbUser] }, app);
