const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const dns = require("node:dns");

require('dotenv').config();
admin.initializeApp();

const dbPassword = defineSecret("CLOUD_DB_PASSWORD");
const dbHost = defineSecret("CLOUD_DB_HOST");
const dbUser = defineSecret("CLOUD_DB_USER");

let pool;
function createPool() {
  // Use pooler host which is IPv4 compatible
  const host = dbHost.value().trim();
  const user = dbUser.value().trim();
  const port = 5432; // session-mode pooler
  const database = "postgres";
  const password = dbPassword.value().trim();

  console.log(`[pool] Creating new pool: host=${host} user=${user} port=${port} db=${database} (forcing IPv4)`);

  const p = new Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    lookup: (hostname, options, callback) => {
      dns.lookup(hostname, { family: 4 }, callback);
    }
  });

  p.on('error', (err) => {
    console.error('[pool] Error, will recreate on next request:', err.message);
    pool = null;
  });

  return p;
}

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

// Wrap pool.query to auto-recreate pool on circuit-breaker / connection errors
async function query(sql, params) {
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    if (err.message?.includes('Circuit breaker') || err.message?.includes('authentication') || err.message?.includes('connect')) {
      console.warn('[pool] Resetting pool due to:', err.message);
      pool = null;
      return getPool().query(sql, params); // one retry with fresh pool
    }
    throw err;
  }
}

console.log('API starting revision 2026-03-06 21:30 (session pooler)...');
const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://app.laneconductor.com', 'http://localhost:8090', 'http://127.0.0.1:8090'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Auth middleware - supports lc_xxxx API tokens or Firebase ID tokens
async function auth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-collector-token'];
  if (!bearer) return res.status(401).json({ error: 'unauthorized: missing token' });

  // pool via query() wrapper

  try {
    if (bearer.startsWith('lc_')) {
      // 1. Try api_tokens table (plaintext — legacy worker tokens)
      const { rows: tokenRows } = await query(
        'SELECT workspace_id FROM api_tokens WHERE token = $1',
        [bearer]
      );
      if (tokenRows.length > 0) {
        req.workspace_id = tokenRows[0].workspace_id;
        req.api_token = bearer;
        return next();
      }

      // 2. Try api_keys table (SHA-256 hash — UI-generated keys)
      const keyHash = crypto.createHash('sha256').update(bearer).digest('hex');
      const { rows: keyRows } = await query(
        'SELECT user_uid FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );
      if (keyRows.length > 0) {
        // Update last_used_at asynchronously
        query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [keyHash]).catch(() => {});
        // Resolve workspace_id from user_uid
        const { rows: wsRows } = await query(
          'SELECT workspace_id FROM workspace_members WHERE firebase_uid = $1 LIMIT 1',
          [keyRows[0].user_uid]
        );
        if (wsRows.length === 0) {
          return res.status(403).json({ error: 'forbidden: no workspace associated with key owner' });
        }
        req.workspace_id = wsRows[0].workspace_id;
        req.api_token = bearer;
        return next();
      }

      return res.status(401).json({ error: 'unauthorized: invalid api token' });
    } else {
      // Firebase ID token auth (from UI)
      const decoded = await admin.auth().verifyIdToken(bearer);
      req.user = decoded;

      const { rows } = await query(
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
    console.error('[auth] Error:', err);
    res.status(401).json({ error: 'unauthorized: invalid token', details: err.message });
  }
}

// Helper to check if project belongs to workspace
async function checkProject(req, res, next) {
  // Try to find project by git_global_id or numeric ID
  const git_global_id = req.body.project_git_global_id || req.query.project_git_global_id || req.body.git_global_id;
  // If :num is present in params, we often need project_id from elsewhere if it's not in :id
  const projectId = req.params.id || req.body.project_id || req.query.project_id;

  // pool via query() wrapper
  let rows = [];

  try {
    if (git_global_id) {
      const r = await query(
        'SELECT id FROM projects WHERE git_global_id = $1 AND workspace_id = $2',
        [git_global_id, req.workspace_id]
      );
      rows = r.rows;
    } else if (projectId) {
      const r = await query(
        'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
        [projectId, req.workspace_id]
      );
      rows = r.rows;
    }

    if (rows.length === 0) {
      console.warn(`[checkProject] Forbidden: Project ${projectId || git_global_id} not in workspace ${req.workspace_id}`);
      return res.status(403).json({ error: 'forbidden: project not in workspace' });
    }

    req.project_id = rows[0].id;
    next();
  } catch (err) {
    console.error('[checkProject] Error:', err);
    res.status(500).json({ error: 'internal server error during project check' });
  }
}

// Routes
app.get('/health', (req, res) => res.json({ ok: true, cloud: true }));

app.get('/auth/config', (req, res) => {
  res.json({
    enabled: true,
    firebase: {
      apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    }
  });
});

// ── API Key Management ────────────────────────────────────────────────────────

// Generate a new API key for the authenticated user
app.post('/api/keys', auth, async (req, res) => {
  if (!req.user?.uid) return res.status(403).json({ error: 'forbidden: firebase auth required' });
  try {
    const user_uid = req.user.uid;
    const name = req.body.name || null;
    const rawKey = `lc_live_${crypto.randomUUID().replace(/-/g, '')}`;
    const key_hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const key_prefix = rawKey.slice(0, 16);
    await query(
      'INSERT INTO api_keys(user_uid, key_hash, key_prefix, name) VALUES($1, $2, $3, $4)',
      [user_uid, key_hash, key_prefix, name]
    );
    res.json({ ok: true, key: rawKey, key_prefix, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List API keys for the authenticated user (prefix only, never raw key)
app.get('/api/keys', auth, async (req, res) => {
  if (!req.user?.uid) return res.status(403).json({ error: 'forbidden: firebase auth required' });
  try {
    const { rows } = await query(
      'SELECT id, key_prefix, name, created_at, last_used_at FROM api_keys WHERE user_uid = $1 ORDER BY created_at DESC',
      [req.user.uid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke an API key (owner only)
app.delete('/api/keys/:id', auth, async (req, res) => {
  if (!req.user?.uid) return res.status(403).json({ error: 'forbidden: firebase auth required' });
  try {
    const { rowCount } = await query(
      'DELETE FROM api_keys WHERE id = $1 AND user_uid = $2',
      [req.params.id, req.user.uid]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'key not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Token generation and workspace signup
app.post('/auth/token', async (req, res) => {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return res.status(401).json({ error: 'unauthorized: missing token' });

  try {
    const decoded = await admin.auth().verifyIdToken(bearer);
    // pool via query() wrapper

    // We expect GitHub username from Firebase OAuth claims
    const github_org = decoded.firebase?.identities?.['github.com']?.[0] || decoded.uid;
    const github_username = decoded.name || decoded.uid;

    // Upsert workspace
    const { rows: wsRows } = await query(`
      INSERT INTO workspaces (github_org, display_name)
      VALUES ($1, $2)
      ON CONFLICT (github_org) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `, [github_org, github_username]);

    const workspace_id = wsRows[0].id;

    // Upsert workspace_member
    await query(`
      INSERT INTO workspace_members (workspace_id, firebase_uid, github_username, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (workspace_id, firebase_uid) DO NOTHING
    `, [workspace_id, decoded.uid, github_username]);

    // Generate new token
    const token = 'lc_' + crypto.randomBytes(24).toString('hex');
    await query(`
      INSERT INTO api_tokens (token, workspace_id, created_by)
      VALUES ($1, $2, $3)
    `, [token, workspace_id, decoded.uid]);

    res.json({ token, workspace_id });
  } catch (err) {
    res.status(err.code?.startsWith('auth/') ? 401 : 500).json({ error: 'failed to generate token', details: err.message });
  }
});

// ── Dashboard API (Reader) ───────────────────────────────────────────────────

app.get('/api/projects', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
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

app.get('/api/tracks', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
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
         WHERE p.workspace_id = $1
         ORDER BY p.name, t.track_number`,
      [req.workspace_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inbox', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    const { project_id } = req.query;
    const values = [req.workspace_id];
    let projectFilter = '';
    if (project_id) {
      projectFilter = `AND t.project_id = $${values.push(project_id)}`;
    }

    const result = await query(
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
         WHERE p.workspace_id = $1 ${projectFilter}
         ORDER BY lc.created_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tracks/waiting', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    const { project_id } = req.query;
    const values = [req.workspace_id];
    let projectFilter = '';
    if (project_id) {
      projectFilter = `AND t.project_id = $${values.push(project_id)}`;
    }

    const result = await query(
      `SELECT t.track_number, t.title, t.lane_status, t.lane_action_status, 
                COALESCE(t.priority, 0) as priority, t.created_at, p.name as project_name, p.id as project_id
         FROM tracks t
         JOIN projects p ON p.id = t.project_id
         WHERE p.workspace_id = $1 AND t.lane_action_status = 'waiting'
           AND t.lane_status NOT IN ('done', 'backlog')
           ${projectFilter}
         ORDER BY priority DESC, t.created_at ASC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[api/tracks/waiting] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks/waiting', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT t.track_number, t.title, t.lane_status, t.lane_action_status, 
                COALESCE(t.priority, 0) as priority, t.created_at, p.name as project_name, p.id as project_id
         FROM tracks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = $1 AND t.lane_action_status = 'waiting'
           AND t.lane_status NOT IN ('done', 'backlog')
         ORDER BY priority DESC, t.created_at ASC`,
      [req.project_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[api/projects/:id/tracks/waiting] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// All workers for workspace (used when no project is selected)
app.get('/api/workers', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT w.id, w.hostname, w.pid, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, w.project_id, p.name AS project_name
         FROM workers w
         JOIN projects p ON p.id = w.project_id
         WHERE p.workspace_id = $1 AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'
         ORDER BY w.hostname, w.pid`,
      [req.workspace_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/workers', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT w.id, w.hostname, w.pid, w.status, w.current_task, w.last_heartbeat, w.created_at,
              w.visibility, w.user_uid, p.name AS project_name
         FROM workers w
         JOIN projects p ON p.id = w.project_id
         WHERE w.project_id = $1 AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'
         ORDER BY w.hostname, w.pid`,
      [req.project_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/providers', auth, checkProject, async (req, res) => {
  // In cloud environment, provider status from the local collector 
  // isn't directly accessible in the same way. We stub this out so 
  // the frontend doesn't crash on 404.
  res.json([]);
});

app.get('/api/projects/:id/tracks', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT t.id, t.track_number, t.title, t.lane_status, t.progress_percent,
                t.current_phase, t.phase_step, t.content_summary, t.last_heartbeat, t.created_at,
                t.auto_implement_launched, t.auto_review_launched,
                t.lane_action_status, t.lane_action_result, COALESCE(t.priority, 0) as priority,
                p.create_quality_gate,
                lc.body AS last_comment_body, lc.author AS last_comment_author, lc.created_at AS last_comment_at,
                uc.unreplied_count, hr.human_needs_reply, retries.retry_count
         FROM tracks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN LATERAL (
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
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int as retry_count FROM track_comments
            WHERE track_id = t.id
              AND author IN ('worker', 'claude', 'gemini')
              AND (
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
         ORDER BY t.track_number`,
      [req.project_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[api/projects/:id/tracks] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks/:num', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT id, track_number, title, lane_status, progress_percent,
                current_phase, content_summary, last_heartbeat, created_at,
                index_content, plan_content, spec_content, test_content, last_log_tail, COALESCE(priority, 0) as priority
         FROM tracks
         WHERE project_id = $1 AND track_number = $2`,
      [req.project_id, req.params.num]
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
      priority: t.priority
    });
  } catch (err) {
    console.error('[api/projects/:id/tracks/:num] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tracks/:num/comments', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const result = await query(
      `SELECT id, author, body, is_replied, created_at FROM track_comments 
         WHERE track_id = (SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2)
           AND is_hidden = FALSE
         ORDER BY created_at ASC`,
      [req.project_id, req.params.num]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/tracks/:num/dismiss', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    await query(
      `UPDATE track_comments SET is_hidden = TRUE 
       WHERE track_id = (SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2)`,
      [req.project_id, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/tracks/:num/priority', auth, checkProject, async (req, res) => {
  const { priority } = req.body;
  if (priority === undefined) return res.status(400).json({ error: 'priority is required' });
  req.url = `/track/${req.params.num}/priority`;
  app.handle(req, res);
});

app.patch('/api/projects/:id/tracks/:num', auth, checkProject, async (req, res) => {
  // Redirect to patched collector action
  req.url = `/track/${req.params.num}/action`;
  app.handle(req, res);
});

app.post('/api/projects/:id/tracks/:num/comments', auth, checkProject, async (req, res) => {
  // Redirect to collector comment
  req.url = `/track/${req.params.num}/comment`;
  app.handle(req, res);
});

// ── Collector API ────────────────────────────────────────────────────────────

// Project registration
app.post('/project/ensure', auth, async (req, res) => {
  try {
    const { git_remote, name, repo_path, primary_cli, primary_model, git_global_id: provided_id } = req.body;
    // pool via query() wrapper

    let git_global_id = provided_id;
    if (!git_global_id && git_remote) {
      // Deterministic UUID v5 for git_remote
      const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const ns = Buffer.from(URL_NAMESPACE.replace(/-/g, ''), 'hex');
      const nameBytes = Buffer.from(git_remote.toLowerCase().replace(/\.git$/, ''), 'utf8');
      const hash = crypto.createHash('sha1').update(ns).update(nameBytes).digest();
      hash[6] = (hash[6] & 0x0f) | 0x50;
      hash[8] = (hash[8] & 0x3f) | 0x80;
      const h = hash.toString('hex');
      git_global_id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    }

    if (!git_global_id) return res.status(400).json({ error: 'git_remote or git_global_id required' });

    await query(`
      INSERT INTO projects (git_global_id, git_remote, name, repo_path, workspace_id, primary_cli, primary_model)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (git_global_id) DO UPDATE SET
        git_remote = EXCLUDED.git_remote,
        name = EXCLUDED.name,
        repo_path = EXCLUDED.repo_path,
        primary_cli = EXCLUDED.primary_cli,
        primary_model = EXCLUDED.primary_model
      WHERE projects.workspace_id = $5
    `, [git_global_id, git_remote, name, repo_path, req.workspace_id, primary_cli, primary_model]);

    res.json({ ok: true, git_global_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backward compatibility with /project
app.post('/project', auth, async (req, res) => {
  // Redirect to ensure
  req.url = '/project/ensure';
  app.handle(req, res);
});

// Track sync
app.post('/track', auth, checkProject, async (req, res) => {
  try {
    const {
      track_number, title, lane_status, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content, test_content
    } = req.body;

    const insertLaneStatus = lane_status ?? 'planning';
    const insertActionStatus = 'waiting';

    const laneStatusClause = lane_status !== null
      ? `lane_status = EXCLUDED.lane_status,
         lane_action_status = CASE
           WHEN tracks.lane_action_status = 'running' THEN 'running'
           WHEN tracks.lane_status != EXCLUDED.lane_status THEN 'queue'
           ELSE tracks.lane_action_status
         END,
         lane_action_result = CASE
           WHEN tracks.lane_status != EXCLUDED.lane_status THEN NULL
           ELSE tracks.lane_action_result
         END,`
      : '';

    // pool via query() wrapper
    await query(`
      INSERT INTO tracks
        (project_id, track_number, title, lane_status, progress_percent,
         current_phase, content_summary, phase_step, index_content, plan_content, spec_content, test_content,
         last_heartbeat, sync_status, last_updated_by, lane_action_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'synced', 'worker', $13)
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
        sync_status      = 'synced',
        last_updated_by  = 'worker'
    `, [req.project_id, track_number, title, insertLaneStatus, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content, test_content, insertActionStatus]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track action/lane updates
app.patch('/track/:num/action', auth, checkProject, async (req, res) => {
  try {
    const { lane_action_status, lane_action_result, lane_status, progress_percent } = req.body;
    // pool via query() wrapper
    const sets = ['last_heartbeat = NOW()'];
    const params = [req.project_id, req.params.num];
    let i = 3;
    if (lane_action_status !== undefined) { sets.push(`lane_action_status = $${i++}`); params.push(lane_action_status); }
    if (lane_action_result !== undefined) { sets.push(`lane_action_result = $${i++}`); params.push(lane_action_result); }
    if (lane_status !== undefined) { sets.push(`lane_status = $${i++}`); params.push(lane_status); }
    if (progress_percent !== undefined) { sets.push(`progress_percent = $${i++}`); params.push(progress_percent); }

    await query(`UPDATE tracks SET ${sets.join(', ')} WHERE project_id = $1 AND track_number = $2`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('[patch /track/:num/action] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/lane', auth, checkProject, async (req, res) => {
  try {
    const { lane_status } = req.body;
    // pool via query() wrapper
    await query(
      `UPDATE tracks SET lane_status = $3, lane_action_status = 'waiting', lane_action_result = NULL, last_heartbeat = NOW()
             WHERE project_id = $1 AND track_number = $2`,
      [req.project_id, req.params.num, lane_status]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[patch /track/:num/lane] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/priority', auth, checkProject, async (req, res) => {
  try {
    const { priority } = req.body;
    if (priority === undefined) return res.status(400).json({ error: 'priority is required' });
    // pool via query() wrapper
    await query(
      `UPDATE tracks SET priority = $3, last_heartbeat = NOW()
             WHERE project_id = $1 AND track_number = $2`,
      [req.project_id, req.params.num, priority]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[patch /track/:num/priority] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Comments
app.post('/track/:num/comment', auth, checkProject, async (req, res) => {
  try {
    const { author = 'human', body, is_replied } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });

    // pool via query() wrapper
    const r = await query(
      `INSERT INTO track_comments (track_id, author, body, is_replied)
       VALUES ((SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2), $3, $4, $5)
       RETURNING id, author, body, created_at`,
      [req.project_id, req.params.num, author, body, is_replied === true]
    );

    // Human comment wakes worker
    if (author === 'human') {
      await query(
        `UPDATE tracks SET lane_action_status = 'waiting', lane_action_result = NULL
         WHERE project_id = $1 AND track_number = $2 AND lane_action_status != 'running'`,
        [req.project_id, req.params.num]
      );
    }

    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Worker heartbeat
app.post('/heartbeat', auth, checkProject, async (req, res) => {
  try {
    const { worker_id, pid, mode } = req.body;
    // pool via query() wrapper
    await query(`
      INSERT INTO workers(project_id, hostname, pid, status, mode, last_heartbeat)
      VALUES($1, $2, $3, 'idle', $4, NOW())
      ON CONFLICT(project_id, hostname, pid) DO UPDATE SET
      status = 'idle', mode = EXCLUDED.mode, last_heartbeat = NOW()
    `, [req.project_id, worker_id || 'unknown', pid || 0, mode || 'polling']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logs
app.post('/log', auth, checkProject, async (req, res) => {
  try {
    const { tail } = req.body;
    // pool via query() wrapper
    await query(
      `UPDATE tracks SET last_log_tail = $3, last_heartbeat = NOW() WHERE project_id = $1 AND track_number = $2`,
      [req.project_id, req.params.num, tail]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Worker registration
app.post('/worker/register', auth, async (req, res) => {
  try {
    const { hostname, pid, mode } = req.body;
    const projectId = req.body.project_id; // checkProject middleware not used because project might not be in req yet
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper

    // Verify project belongs to workspace
    const projCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );
    if (projCheck.rows.length === 0) return res.status(403).json({ error: 'forbidden: project not in workspace' });

    const machine_token = crypto.randomUUID();

    await query(`
      INSERT INTO workers(project_id, hostname, pid, status, mode, machine_token, last_heartbeat)
      VALUES($1, $2, $3, 'idle', $4, $5, NOW())
      ON CONFLICT(project_id, hostname, pid) DO UPDATE SET
      status = 'idle', mode = EXCLUDED.mode, machine_token = EXCLUDED.machine_token, last_heartbeat = NOW()
    `, [projectId, hostname, pid, mode || 'polling', machine_token]);

    res.json({ ok: true, machine_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/worker/heartbeat', auth, async (req, res) => {
  try {
    const { hostname, pid, status, current_task, mode } = req.body;
    const projectId = req.body.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    // Verify project belongs to workspace
    const projCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );
    if (projCheck.rows.length === 0) return res.status(403).json({ error: 'forbidden: project not in workspace' });

    const sets = ['last_heartbeat = NOW()'];
    const params = [projectId, hostname, pid];
    let i = 4;
    if (status) { sets.push(`status = $${i++}`); params.push(status); }
    if (current_task !== undefined) { sets.push(`current_task = $${i++}`); params.push(current_task); }
    if (mode) { sets.push(`mode = $${i++}`); params.push(mode); }

    await query(
      `UPDATE workers SET ${sets.join(', ')}
       WHERE project_id = $1 AND hostname = $2 AND pid = $3`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/worker', auth, async (req, res) => {
  try {
    const { hostname, pid } = req.body;
    const projectId = req.body.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    // Verify project belongs to workspace
    const projCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );
    if (projCheck.rows.length === 0) return res.status(403).json({ error: 'forbidden: project not in workspace' });

    await query(
      'DELETE FROM workers WHERE project_id = $1 AND hostname = $2 AND pid = $3',
      [projectId, hostname, pid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stale and heartbeat
app.get('/tracks/running', auth, async (req, res) => {
  try {
    const projectId = req.query.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    const r = await query(
      `SELECT track_number, lane_status FROM tracks t
       JOIN projects p ON t.project_id = p.id
       WHERE t.project_id = $1 AND p.workspace_id = $2 AND t.lane_action_status = 'running'`,
      [projectId, req.workspace_id]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/tracks/stale', auth, async (req, res) => {
  try {
    const projectId = req.query.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    const r = await query(
      `SELECT track_number FROM tracks t
       JOIN projects p ON t.project_id = p.id
       WHERE t.project_id = $1 AND p.workspace_id = $2 AND t.sync_status = 'syncing'`,
      [projectId, req.workspace_id]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tracks/heartbeat', auth, async (req, res) => {
  try {
    const projectId = req.body.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    const r = await query(
      `UPDATE tracks t
       SET last_heartbeat = NOW()
       FROM projects p
       WHERE t.project_id = p.id AND t.project_id = $1 AND p.workspace_id = $2 AND t.lane_status = 'in-progress'
       RETURNING t.track_number`,
      [projectId, req.workspace_id]
    );
    res.json({ updated: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tracks/reset-stuck-actions', auth, async (req, res) => {
  try {
    const projectId = req.body.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    const r = await query(
      `UPDATE tracks t
       SET lane_action_status = 'waiting', lane_action_result = 'stuck_timeout', claimed_by = NULL
       FROM projects p
       WHERE t.project_id = p.id AND t.project_id = $1 AND p.workspace_id = $2 
         AND t.lane_action_status = 'running'
         AND t.last_heartbeat < NOW() - INTERVAL '2 minutes'
       RETURNING t.track_number`,
      [projectId, req.workspace_id]
    );
    res.json({ reset: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Provider status
app.post('/provider-status', auth, async (req, res) => {
  try {
    const { provider, status, reset_at, last_error } = req.body;
    const projectId = req.body.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    // Verify project belongs to workspace
    const projCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );
    if (projCheck.rows.length === 0) return res.status(403).json({ error: 'forbidden: project not in workspace' });

    await query(`
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

app.get('/provider-status', auth, async (req, res) => {
  try {
    const projectId = req.query.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // pool via query() wrapper
    const r = await query(
      `SELECT provider, status, reset_at, last_error, updated_at 
       FROM provider_status ps
       JOIN projects p ON ps.project_id = p.id
       WHERE ps.project_id = $1 AND p.workspace_id = $2`,
      [projectId, req.workspace_id]
    );
    res.json({ providers: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retry count and blocking
app.get('/track/:num/retry-count', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    const c = await query(
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
      [req.project_id]
    );
    res.json({ count: c.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/block', auth, checkProject, async (req, res) => {
  try {
    // pool via query() wrapper
    await query(
      `UPDATE tracks SET lane_action_status = 'blocked', lane_action_result = 'max_retries_reached'
       WHERE id = $1`,
      [req.project_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim tracks for worker
app.post('/tracks/claim-waiting', auth, async (req, res) => {
  try {
    // pool via query() wrapper
    // Claim across the whole workspace
    const { rows } = await query(`
            UPDATE tracks t
            SET lane_action_status = 'running', lane_action_result = 'claimed'
            FROM projects p
            WHERE t.project_id = p.id AND p.workspace_id = $1
              AND t.lane_action_status = 'waiting'
              AND t.lane_status IN ('planning', 'in-progress', 'review', 'quality-gate')
            RETURNING t.track_number, t.lane_status, p.git_global_id
            LIMIT $2
        `, [req.workspace_id, req.body.limit || 5]);
    res.json({ tracks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

exports.api = onRequest({ invoker: "public", secrets: [dbPassword, dbHost, dbUser] }, app);
// forced update for environment (2026-03-06 15:40)
