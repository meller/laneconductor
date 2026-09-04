const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const dns = require("node:dns");
const fetch = require("node-fetch");
const adapterRegistry = require("./src/adapters");
const { COLLECTOR_API_VERSION, buildRouteManifest, formatManifestRoutes } = require("./collector-manifest");

require('dotenv').config();
admin.initializeApp();

const dbPassword = defineSecret("CLOUD_DB_PASSWORD");
const dbHost = defineSecret("CLOUD_DB_HOST");
const dbUser = defineSecret("CLOUD_DB_USER");
const dbUrl = defineSecret("DATABASE_URL");

let pool;
function createPool() {
  const connectionString = dbUrl.value().trim();
  
  if (connectionString) {
    console.log(`[pool] Creating new pool using connectionString from Secret Manager`);
    const p = new Pool({
      connectionString,
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

  // Fallback to legacy individual secrets (e.g. for local testing)
  const host = dbHost.value().trim();
  const user = dbUser.value().trim();
  const port = 5432;
  const database = "postgres";
  const password = dbPassword.value().trim();

  console.log(`[pool] Creating new pool using individual secrets: host=${host}`);

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

// Errors that mean "this pool is bad, throw it away" rather than "this SQL is bad".
function isRecoverablePoolError(err) {
  return Boolean(
    err.message?.includes('Circuit breaker') ||
    err.message?.includes('authentication') ||
    err.message?.includes('connect')
  );
}

// Wrap pool.query to auto-recreate pool on circuit-breaker / connection errors
async function query(sql, params) {
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    if (isRecoverablePoolError(err)) {
      console.warn('[pool] Resetting pool due to:', err.message);
      pool = null;
      return getPool().query(sql, params); // one retry with fresh pool
    }
    throw err;
  }
}

/**
 * Track 10053: run `fn` inside a transaction on ONE checked-out client.
 *
 * `query()` above cannot express this. It borrows a connection per statement,
 * so a BEGIN / SELECT ... FOR UPDATE SKIP LOCKED / UPDATE / COMMIT sequence
 * run through it can land on four different connections — the BEGIN applies to
 * a connection that is then returned to the pool, and SKIP LOCKED stops
 * excluding anything because the row locks it relies on belong to a
 * transaction the later statements aren't in. The visible symptom would be two
 * cloud workers claiming the same track, intermittently and unreproducibly.
 *
 * Deliberately NOT retried on a recoverable pool error the way `query()` is: a
 * transaction that died mid-flight may have partially applied, and blindly
 * replaying the whole callback could double-apply it. The pool is discarded so
 * the next request gets a fresh one, and the error is raised to the caller.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // The connection may already be unusable; a failed ROLLBACK must not mask
    // the original error, which is the one that explains what went wrong.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('[tx] ROLLBACK failed:', rollbackErr.message);
    }
    if (isRecoverablePoolError(err)) {
      console.warn('[tx] Discarding pool due to:', err.message);
      pool = null;
    }
    throw err;
  } finally {
    client.release();
  }
}

console.log('API starting revision 2026-03-06 21:30 (session pooler)...');
const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'https://app.laneconductor.com',
      'https://laneconductor-app.web.app',
      'http://localhost:8090',
      'http://127.0.0.1:8090'
    ];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Track 10053: worker identity, carried separately from workspace auth.
//
// `Authorization` answers "which workspace is this?" — an lc_ API key or a
// Firebase ID token. It cannot answer "which worker is this?", because in
// remote-api mode every worker on a project authenticates with the same
// project API key (the worker's resolveCollectorToken puts COLLECTOR_n_TOKEN
// ahead of the machine_token it adopted at registration). Yet
// /track/:num/session is per (track, worker), and /tracks/claim-queue records
// claimed_by and filters on worker visibility — all of which need the specific
// worker.
//
// So worker identity travels in its own header, as a credential rather than an
// id. Taking a client-supplied `worker_id` instead would let any holder of a
// project key act as any worker in that project — see the local handler's own
// note that identity must come from the caller's credential, "never a
// client-supplied worker_id".
const WORKER_TOKEN_HEADER = 'x-worker-token';

async function resolveWorkerIdentity(req, res, next) {
  const workerToken = req.headers[WORKER_TOKEN_HEADER];
  // Absent header is the normal case for the cloud UI and for every worker
  // route that doesn't need per-worker identity. Unchanged behavior.
  if (!workerToken) return next();

  try {
    // Scoped to the authenticated workspace via the worker's project. A token
    // for a worker in someone else's workspace and a token matching no worker
    // at all both return zero rows and are answered identically — the caller
    // learns nothing about which it was.
    const { rows } = await query(
      `SELECT w.id, w.project_id, w.user_uid, w.visibility
         FROM workers w
         JOIN projects p ON p.id = w.project_id
        WHERE w.machine_token = $1 AND p.workspace_id = $2`,
      [workerToken, req.workspace_id]
    );
    if (rows.length === 0) {
      console.warn('[auth] Rejected worker token not resolvable in workspace', req.workspace_id);
      return res.status(403).json({ error: 'forbidden: worker token not valid for this workspace' });
    }

    req.worker_id = rows[0].id;
    req.worker_project_id = rows[0].project_id;
    req.worker_user_uid = rows[0].user_uid;
    req.worker_visibility = rows[0].visibility;
    req.machine_token = workerToken;
    return next();
  } catch (err) {
    console.error('[auth] worker identity error:', err);
    return res.status(500).json({ error: 'internal server error during worker identity check' });
  }
}

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
        return resolveWorkerIdentity(req, res, next);
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
        return resolveWorkerIdentity(req, res, next);
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
      return resolveWorkerIdentity(req, res, next);
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

// syncToJira is deprecated in favor of the Integration Proxy and Worker-led hooks.
// Credentials should be managed per-project in the 'projects' table.

// Routes
// Track 10061: the collector handshake. `cloud: true` kept for existing
// consumers (D2) — route manifest is derived from this app's own live
// router at request time (D1), via the vendored copy of
// conductor/services/collector-manifest.mjs (D4; see
// cloud/functions/collector-manifest.js's DO NOT EDIT banner).
app.get('/health', (req, res) => res.json({
  ok: true,
  cloud: true,
  server: 'cloud',
  api_version: COLLECTOR_API_VERSION,
  routes: formatManifestRoutes(buildRouteManifest(app)),
}));

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

app.get('/api/projects/:id/config', auth, checkProject, async (req, res) => {
  try {
    const r = await query(
      'SELECT primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files, integrations FROM projects WHERE id = $1',
      [req.project_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, repo_path, conductor_files, integrations } = r.rows[0];

    // Prefer DB conductor_files if set (source of truth for cloud)
    let lcJson = {};
    if (conductor_files?.laneconductor_json) {
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

app.patch('/api/projects/:id/config', auth, checkProject, async (req, res) => {
  try {
    const { primary, secondary, dev, create_quality_gate, collectors, db, ui_port, integrations } = req.body;

    // 1. Update DB columns including the integrations JSONB
    await query(
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
        integrations ? JSON.stringify(integrations) : null,
        req.project_id
      ]
    );

    // 2. Sync to laneconductor_json inside conductor_files
    const dbResult = await query('SELECT conductor_files FROM projects WHERE id = $1', [req.project_id]);
    const conductor_files = dbResult.rows[0]?.conductor_files || {};
    
    let lcJson = {};
    if (conductor_files.laneconductor_json) {
      try { lcJson = typeof conductor_files.laneconductor_json === 'string' 
        ? JSON.parse(conductor_files.laneconductor_json) 
        : conductor_files.laneconductor_json; } catch { /* ignore */ }
    }

    if (!lcJson.project) lcJson.project = {};
    if (primary) { lcJson.project.primary = { cli: primary.cli, model: primary.model || null }; }
    if (secondary?.cli) { lcJson.project.secondary = { cli: secondary.cli, model: secondary.model || null }; }
    else { delete lcJson.project.secondary; }
    if (dev?.command || dev?.url) { lcJson.project.dev = dev; }
    else { delete lcJson.project.dev; }
    lcJson.project.create_quality_gate = create_quality_gate ?? false;
    if (collectors) { 
      lcJson.collectors = collectors.map(c => ({ 
        url: c.url, 
        token: c.token || null, 
        ...(lcJson.collectors?.find(e => e.url === c.url) || {}) 
      })); 
    }
    if (db) { lcJson.db = { ...lcJson.db, ...db }; }
    if (ui_port) { lcJson.ui = { ...(lcJson.ui || {}), port: ui_port }; }

    conductor_files.laneconductor_json = JSON.stringify(lcJson, null, 2);
    
    await query('UPDATE projects SET conductor_files = $1 WHERE id = $2', [conductor_files, req.project_id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[patch/api/projects/:id/config] Error:', err);
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
         WHERE p.workspace_id = $1 AND t.lane_action_status = 'queue'
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
         WHERE t.project_id = $1 AND t.lane_action_status = 'queue'
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
                index_content, plan_content, spec_content, test_content, last_log_tail, COALESCE(priority, 0) as priority,
                waiting_reason
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
      priority: t.priority,
      waiting_reason: t.waiting_reason, // Track 10055
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

// Track 10055 (REQ-7): un-park a track sitting at `<lane>:waiting`. Mirrors
// the local collector's route exactly, minus syncTrackToFile — the cloud
// function has no filesystem to write to; the worker's own file sync carries
// the change down to disk.
app.post('/api/projects/:id/tracks/:num/resume', auth, checkProject, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT lane_status, lane_action_status FROM tracks WHERE project_id = $1 AND track_number = $2',
      [req.project_id, req.params.num]
    );
    if (!rows[0]) return res.status(404).json({ error: 'track not found' });
    if (rows[0].lane_action_status !== 'waiting') {
      return res.status(409).json({
        error: `track ${req.params.num} is not waiting (it is ${rows[0].lane_status}:${rows[0].lane_action_status}) — nothing to resume`,
      });
    }
    await query(
      `UPDATE tracks
          SET lane_action_status = 'queue', lane_action_result = NULL,
              waiting_reason = NULL, claimed_by = NULL, last_heartbeat = NOW()
        WHERE project_id = $1 AND track_number = $2`,
      [req.project_id, req.params.num]
    );
    res.json({ ok: true, lane_status: rows[0].lane_status, lane_action_status: 'queue' });
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
    if (!git_global_id) {
      const salt = git_remote
        ? git_remote.toLowerCase().replace(/\.git$/, '')
        : (name ? `name:${req.workspace_id}:${name.toLowerCase()}` : null);

      if (salt) {
        // Deterministic UUID v5
        const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
        const ns = Buffer.from(URL_NAMESPACE.replace(/-/g, ''), 'hex');
        const nameBytes = Buffer.from(salt, 'utf8');
        const hash = crypto.createHash('sha1').update(ns).update(nameBytes).digest();
        hash[6] = (hash[6] & 0x0f) | 0x50;
        hash[8] = (hash[8] & 0x3f) | 0x80;
        const h = hash.toString('hex');
        git_global_id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
      }
    }

    if (!git_global_id) return res.status(400).json({ error: 'git_remote, name, or git_global_id required' });

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

    const { rows: projRows } = await query('SELECT id FROM projects WHERE git_global_id = $1', [git_global_id]);
    const project_id = projRows[0].id;

    res.json({ ok: true, git_global_id, project_id });
  } catch (err) {
    console.error('[project/ensure] Error:', err);
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
      index_content, plan_content, spec_content, test_content,
      lane_action_status,
      // Track 10055: why a `<lane>:waiting` track is parked
      waiting_reason
    } = req.body;

    console.log(`[POST /track] project_id=${req.project_id} (body ${req.body.project_id}) track=${track_number}`);

    const insertLaneStatus = lane_status ?? 'planning';
    // Track 10055: this used to be followed by
    // `if (insertActionStatus === 'waiting') insertActionStatus = 'queue';`.
    //
    // That line, and six others in this file, dated from before `waiting`
    // meant anything: cloud used it in the pre-10035 sense of "waiting for a
    // worker to pick it up" — writing it on a lane move, on a human comment,
    // and on a stuck-action reset, and *claiming* it in
    // /tracks/claim-queue-workspace. Internally consistent, but the exact
    // opposite of what `waiting` means everywhere else in the system now:
    // "paused, nothing may claim this until a human acts".
    //
    // Leaving those in place while accepting `waiting` here would have been
    // worse than the downgrade it replaced — a deliberately parked track would
    // have been picked straight back up by cloud's own claim query. So all
    // seven sites were moved to 'queue' (their actual meaning) in one pass,
    // and `waiting` now carries the same meaning on both collectors.
    // file_sync_queue.status = 'waiting' is a different column with its own
    // vocabulary and is deliberately untouched.
    const insertActionStatus = lane_action_status ?? 'queue';

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
         last_heartbeat, sync_status, last_updated_by, lane_action_status, waiting_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'synced', 'worker', $13, $14)
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
        -- Track 10055: written when supplied, retired when the incoming
        -- status is anything other than waiting, otherwise left alone — a
        -- reason that outlives the pause it explains reads as current.
        waiting_reason   = CASE
          WHEN $14::text IS NOT NULL THEN $14
          WHEN $13::text IS DISTINCT FROM 'waiting' THEN NULL
          ELSE tracks.waiting_reason
        END,
        last_updated_by  = 'worker'
    `, [req.project_id, track_number, title, insertLaneStatus, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content, test_content, insertActionStatus,
      waiting_reason ?? null]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track action/lane updates
app.patch('/track/:num/action', auth, checkProject, async (req, res) => {
  try {
    const { lane_action_status, lane_action_result, lane_status, progress_percent, waiting_reason } = req.body;
    // pool via query() wrapper
    const sets = ['last_heartbeat = NOW()'];
    const params = [req.project_id, req.params.num];
    let i = 3;
    if (lane_action_status !== undefined) {
      sets.push(`lane_action_status = $${i++}`);
      params.push(lane_action_status);
      // Track 10055: leaving `waiting` retires the reason that explained it,
      // unless this same request supplies a new one below.
      if (lane_action_status !== 'waiting' && waiting_reason === undefined) sets.push('waiting_reason = NULL');
    }
    if (waiting_reason !== undefined) { sets.push(`waiting_reason = $${i++}`); params.push(waiting_reason); }
    if (lane_action_result !== undefined) { sets.push(`lane_action_result = $${i++}`); params.push(lane_action_result); }
    if (lane_status !== undefined) { sets.push(`lane_status = $${i++}`); params.push(lane_status); }
    if (progress_percent !== undefined) { sets.push(`progress_percent = $${i++}`); params.push(progress_percent); }

    await query(`UPDATE tracks SET ${sets.join(', ')} WHERE project_id = $1 AND track_number = $2`, params);

    // Jira Feedback Loop
    if (lane_status === 'done' || lane_status === 'review' || lane_action_result === 'success') {
      const { rows } = await query('SELECT title FROM tracks WHERE project_id = $1 AND track_number = $2', [req.project_id, req.params.num]);
      if (rows.length > 0) {
        let msg = `Track status updated to ${lane_status || 'completed'}.`;
        if (lane_action_result === 'success') msg += ` Action completed successfully.`;
        syncToJira(req.params.num, `[LaneConductor] ${msg}`);
      }
    }

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
      `UPDATE tracks SET lane_status = $3, lane_action_status = 'queue', lane_action_result = NULL, last_heartbeat = NOW()
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
        `UPDATE tracks SET lane_action_status = 'queue', lane_action_result = NULL
         WHERE project_id = $1 AND track_number = $2 AND lane_action_status != 'running'`,
        [req.project_id, req.params.num]
      );
    }

    res.status(201).json(r.rows[0]);

    // Jira Feedback Loop for human comments
    if (author === 'human' || author === 'claude' || author === 'gemini') {
      syncToJira(req.params.num, `[LaneConductor] ${author}: ${body}`);
    }
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
       -- Track 10055: 'queue', matching the local collector. A run that timed
       -- out is a phantom to be retried, not a deliberate human pause — those
       -- must stay distinguishable, or every stuck track lands in the state
       -- that means "someone chose this" and nothing ever picks it up again.
       SET lane_action_status = 'queue', lane_action_result = 'stuck_timeout', claimed_by = NULL
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
              AND t.lane_action_status = 'queue'
              AND t.lane_status IN ('planning', 'in-progress', 'review', 'quality-gate')
            RETURNING t.track_number, t.lane_status, p.git_global_id
            LIMIT $2
        `, [req.workspace_id, req.body.limit || 5]);
    res.json({ tracks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Integration Proxy (e.g., Worker -> Jira) ─────────────────────────────────

app.post('/v1/projects/:projectId/integrations/:provider/proxy', auth, async (req, res) => {
  const { projectId, provider } = req.params;
  const { path, method = 'POST', body, headers = {} } = req.body;

  try {
    // 1. Verify project access
    const { rows: projRows } = await query(
      'SELECT integrations FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );

    if (projRows.length === 0) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const integrations = projRows[0].integrations || {};
    const config = integrations[provider];

    if (!config) {
      return res.status(400).json({ error: `No configuration found for provider: ${provider}` });
    }

    // 2. Handle Provider-specific Proxy Logic
    if (provider === 'jira') {
      const { domain, email, token } = config;
      if (!domain || !email || !token) {
        return res.status(500).json({ error: 'Incomplete Jira integration configuration. Required: domain, email, token' });
      }

      const jiraUrl = `https://${domain}${path}`;
      const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

      console.log(`[proxy] Forwarding ${method} to Jira: ${jiraUrl}`);

      const response = await fetch(jiraUrl, {
        method,
        headers: {
          ...headers,
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: (method !== 'GET' && method !== 'HEAD' && body) ? JSON.stringify(body) : undefined
      });

      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json(data);
    }

    res.status(400).json({ error: `Proxy not implemented for provider: ${provider}` });
  } catch (err) {
    console.error(`[proxy] Error calling ${provider}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── Generic Webhook Router (authenticated via ?token=) ───────────────────────

// ── Webhook Diagnostic Endpoint (for debugging Jira connectivity) ─────────────
app.all('/v1/webhooks/ping', (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    ip: req.ip,
    bodyLength: req.body ? JSON.stringify(req.body).length : 0,
  };
  console.log('[webhook:diagnostic] PING received:', JSON.stringify(diagnostics, null, 2));
  return res.status(200).json({ ok: true, received: diagnostics });
});

app.post('/v1/webhooks/:format', async (req, res) => {
  const { format } = req.params;
  const token = req.query.token;

  // Log all webhook attempts for diagnostic purposes
  console.log(`[webhook:${format}] Incoming request:`, {
    url: req.originalUrl,
    method: req.method,
    headers: { 'user-agent': req.headers['user-agent'], 'x-atlassian-webhook-signature': req.headers['x-atlassian-webhook-signature']?.substring(0, 20) },
    hasToken: !!token,
    bodySize: JSON.stringify(req.body).length,
  });

  if (!token) {
    return res.status(401).json({ error: 'Missing webhook token. Use ?token=YOUR_PROJECT_WEBHOOK_TOKEN' });
  }

  try {
    // 1. Find the project and integration config by token
    const { rows: projRows } = await query(
      `SELECT id, workspace_id, integrations->'${format}' as config
       FROM projects
       WHERE (integrations->'${format}'->>'webhookToken' = $1)
          OR (integrations->'${format}'->>'webhook_token' = $1)`,
      [token]
    );

    if (projRows.length === 0) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const { id: projectId, workspace_id: workspaceId, config } = projRows[0];

    // 2. Verify signature if the service requires it
    const signature = req.headers['x-hub-signature'] || req.headers['x-atlassian-webhook-signature'];
    const webhookSecret = config?.webhookSecret || config?.webhook_secret;

    if (webhookSecret && signature) {
      const hmac = crypto.createHmac('sha256', webhookSecret);
      const digest = hmac.update(JSON.stringify(req.body)).digest('hex');
      const provided = signature.replace('sha256=', '');
      if (provided !== digest) {
        console.warn(`[webhook:${format}] Invalid signature for project ${projectId}`);
        return res.status(401).send('Invalid signature');
      }
    }

    // 3. Translate and Upsert
    const action = adapterRegistry.translate(format, req.body);
    if (!action) return res.status(200).send('Event ignored by adapter');

    if (action.type === 'UPSERT_TRACK') {
      await query(`
        INSERT INTO tracks (project_id, track_number, title, content_summary, integrations, last_heartbeat)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (project_id, track_number) DO UPDATE SET
          title = EXCLUDED.title,
          content_summary = EXCLUDED.content_summary,
          integrations = EXCLUDED.integrations,
          last_heartbeat = NOW()
      `, [projectId, action.track_number, action.title, action.summary, action.metadata]);

      console.log(`[webhook:${format}] Upserted track ${action.track_number} for project ${projectId}`);
      return res.status(200).json({ ok: true, track: action.track_number });
    }

    res.status(400).json({ error: 'Unsupported action type' });
  } catch (err) {
    console.error(`[webhook:${format}] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── Legacy Jira Webhook (DEPRECATED: Use /v1/webhooks/jira?token=...) ─────────
// Removing to avoid confusion and enforce secure project-specific logic.

// ── File Sync Queue ─────────────────────────────────────────────────────────

app.post('/file-sync/claim', auth, async (req, res) => {
  try {
    const { limit = 10 } = req.body;
    const projectId = req.body.project_id || req.query.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });

    // Verify project belongs to workspace
    const projCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, req.workspace_id]
    );
    if (projCheck.rows.length === 0) return res.status(403).json({ error: 'forbidden: project not in workspace' });

    const client = await getPool().connect();
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
      `, [projectId, req.api_token || 'machine', limit]);
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

app.patch('/file-sync/:id', auth, async (req, res) => {
  try {
    const { status, error_message } = req.body;
    await query(
      'UPDATE file_sync_queue SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
      [status, error_message, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file-sync/:id', auth, async (req, res) => {
  try {
    const r = await query('SELECT status, error_message FROM file_sync_queue WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Sync task not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/dev-server/status', async (req, res) => {
  res.json({ running: false, available: false, message: 'Dev server not available in cloud production environment' });
});

app.post('/api/projects/:id/dev-server/start', async (req, res) => {
  res.status(400).json({ error: 'Dev server cannot be started from cloud environment' });
});

app.post('/api/projects/:id/dev-server/stop', async (req, res) => {
  res.status(400).json({ error: 'Dev server cannot be stopped from cloud environment' });
});

// ── Track 10053: routes the sync worker needs ────────────────────────────────
//
// Ported from ui/server/index.mjs, which is the reference implementation. Track
// 10052 fixed Hosting's rewrite globs so these paths reach this function; until
// this section existed they arrived and 404'd, so a worker in remote-api mode
// registered successfully and then could not do anything at all.
//
// Contracts (status codes, response shapes, side effects) match the local
// server exactly — conductor/tests/cloud-route-parity.test.mjs asserts every
// (method, path) the worker calls is served here, and the per-handler jest
// cases in test/ported-worker-routes.test.js assert the shapes. Two deliberate
// divergences, both because this function has no repo checkout and more than
// one tenant, are called out at their handlers.
//
// The lanes a queued track may be claimed in. Mirror of CLAIMABLE_LANES in
// conductor/constants.mjs, which is ESM and so cannot be required from here.
// conductor/tests/cloud-route-parity.test.mjs fails if the two drift — adding a
// lane in one place and not the other is exactly how `done` became silently
// unclaimable after track 10035.
const CLAIMABLE_LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];

const DISPATCH_STATUSES = ['pending', 'claimed', 'done', 'failed'];

/**
 * Resolve the project a worker call is about, and prove it belongs to the
 * caller's workspace.
 *
 * Most of these routes carry no project at all — the worker calls
 * `/conductor-files`, `/tracks/claim-queue`, `/track/:num/lock` and
 * `/track/:num/unlock` with neither a `:id` param nor a `project_id`. Locally
 * that works because collectorAuth resolves the project from the machine_token
 * bearer's own worker row. Here it comes from `X-Worker-Token` via
 * resolveWorkerIdentity, with an explicit `project_id` as the fallback —
 * preferring the worker's own project, same precedence as the local handlers.
 *
 * Responds and returns null on failure, so callers `if (!projectId) return;`.
 *
 * @returns {Promise<number|null>}
 */
async function resolveWorkerProject(req, res) {
  const explicit = req.body?.project_id ?? req.query.project_id;
  const parsedExplicit = explicit === undefined || explicit === null ? null : parseInt(explicit, 10);
  const projectId = req.worker_project_id ?? (Number.isNaN(parsedExplicit) ? null : parsedExplicit);

  if (!projectId) {
    res.status(400).json({
      error: 'project could not be resolved: send X-Worker-Token or a project_id',
    });
    return null;
  }

  const { rows } = await query(
    'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
    [projectId, req.workspace_id]
  );
  if (rows.length === 0) {
    console.warn(`[worker-routes] Forbidden: project ${projectId} not in workspace ${req.workspace_id}`);
    res.status(403).json({ error: 'forbidden: project not in workspace' });
    return null;
  }
  return rows[0].id;
}

/** Is this worker id one of the caller's workspace's workers? */
async function workerInWorkspace(workerId, workspaceId) {
  const { rows } = await query(
    `SELECT w.id FROM workers w
       JOIN projects p ON p.id = w.project_id
      WHERE w.id = $1 AND p.workspace_id = $2`,
    [workerId, workspaceId]
  );
  return rows.length > 0;
}

// ── Project workflow + conductor files ───────────────────────────────────────

// DIVERGENCE from ui/server/index.mjs: the local handler falls back to reading
// conductor/workflow.json off disk when the DB copy is absent. There is no repo
// checkout here, so this returns {} instead — same as the local handler's own
// final fallback. The worker treats {} as "no project-specific workflow".
app.get('/projects/:id/workflow', auth, checkProject, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT conductor_files FROM projects WHERE id = $1',
      [req.project_id]
    );
    const workflowJson = rows[0]?.conductor_files?.workflow_json;
    if (!workflowJson) return res.json({});

    try {
      // Stored as the raw text of conductor/workflow.json, not as nested JSON.
      return res.json(typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson);
    } catch {
      // Malformed stored content must not 500 a worker's every sync cycle.
      console.warn(`[workflow] project ${req.project_id} has unparseable workflow_json`);
      return res.json({});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/conductor-files', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    const { content } = req.body;
    await query('UPDATE projects SET conductor_files = $1 WHERE id = $2', [content, projectId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Track read-back ──────────────────────────────────────────────────────────

app.get('/track/:num', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    const trackResult = await query(
      'SELECT * FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );
    if (trackResult.rows.length === 0) return res.status(404).json({ error: 'track not found' });

    const commentsResult = await query(
      'SELECT * FROM track_comments WHERE track_id = $1 ORDER BY created_at ASC',
      [trackResult.rows[0].id]
    );
    res.json({ ...trackResult.rows[0], comments: commentsResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Git lock coordination (track 1010) ───────────────────────────────────────

app.post('/track/:num/lock', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    const { user, machine, pattern, lock_file_path } = req.body;

    const trackRes = await query(
      'SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );
    if (!trackRes.rows[0]) return res.status(404).json({ error: 'track not found' });

    // ON CONFLICT on (project_id, track_number) is what makes two racing
    // lock calls converge on one row held by the later caller, rather than
    // two rows that both look authoritative.
    await query(
      `INSERT INTO track_locks (project_id, track_id, track_number, "user", machine, pattern, lock_file_path, locked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (project_id, track_number)
       DO UPDATE SET
         "user" = EXCLUDED."user",
         machine = EXCLUDED.machine,
         pattern = EXCLUDED.pattern,
         lock_file_path = EXCLUDED.lock_file_path,
         locked_at = NOW()`,
      [projectId, trackRes.rows[0].id, req.params.num, user, machine, pattern || 'cli', lock_file_path]
    );

    await query(
      `UPDATE tracks SET locked_by = $3, lane_action_status = 'running'
        WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num, `${user}@${machine}`]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/unlock', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    await query(
      'DELETE FROM track_locks WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );
    await query(
      'UPDATE tracks SET locked_by = NULL WHERE project_id = $1 AND track_number = $2',
      [projectId, req.params.num]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pre-spawn block counter (track 10040) ────────────────────────────────────
// Needs migrations/20260903120000_add_prespawn_block_columns.sql applied: the
// four columns only ever existed in ui/server/migrations/, which has no runner,
// so they were absent from the cloud database.

app.post('/track/:num/prespawn-block', auth, async (req, res) => {
  try {
    const { kind, reason } = req.body;
    if (!kind) return res.status(400).json({ error: 'kind is required' });

    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    const r = await query(
      `UPDATE tracks SET prespawn_block_count = prespawn_block_count + 1,
              prespawn_block_kind = $3, prespawn_block_reason = $4, prespawn_blocked_at = NOW()
        WHERE project_id = $1 AND track_number = $2
        RETURNING prespawn_block_count AS count, prespawn_block_kind AS kind, prespawn_block_reason AS reason`,
      [projectId, req.params.num, kind, reason ?? null]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'track not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/prespawn-block/reset', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    await query(
      `UPDATE tracks SET prespawn_block_count = 0, prespawn_block_kind = NULL,
              prespawn_block_reason = NULL, prespawn_blocked_at = NULL
        WHERE project_id = $1 AND track_number = $2`,
      [projectId, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Persistent sessions (tracks 1086 / 10047) ────────────────────────────────
// One resumable CLI session per (track_number, worker_id), keyed off the
// calling worker's own identity — resolveWorkerIdentity's req.worker_id, from
// the X-Worker-Token credential, never a client-supplied worker_id.

app.get('/track/:num/session', auth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });

    const { rows } = await query(
      'SELECT claude_session_id, last_context_tokens, resume_count FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
      [req.params.num, req.worker_id]
    );
    res.json({
      claude_session_id: rows[0]?.claude_session_id ?? null,
      // last_context_tokens is reported as-is and never coerced to 0: track
      // 10047's cap policy (conductor/services/session-cap.mjs) distinguishes
      // "never measured" (null) from "measured as zero", and collapsing them
      // would silently change which runs it allows to resume.
      last_context_tokens: rows[0]?.last_context_tokens ?? null,
      resume_count: rows[0]?.resume_count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/track/:num/session', auth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });

    const { claude_session_id, context_tokens } = req.body;
    if (!claude_session_id) return res.status(400).json({ error: 'claude_session_id is required' });

    // resume_count is computed server-side (increment when the id is the same
    // session being resumed again, reset to 0 when it's a different one) so the
    // worker never has to read-then-write. last_context_tokens is COALESCEd:
    // a POST that didn't measure it must not erase a prior measurement.
    await query(
      `INSERT INTO track_sessions(track_number, worker_id, claude_session_id, last_used_at, last_context_tokens, resume_count)
       VALUES($1, $2, $3, NOW(), $4, 0)
       ON CONFLICT (track_number, worker_id) DO UPDATE SET
         claude_session_id = EXCLUDED.claude_session_id,
         last_used_at = NOW(),
         resume_count = CASE
           WHEN track_sessions.claude_session_id = EXCLUDED.claude_session_id THEN track_sessions.resume_count + 1
           ELSE 0
         END,
         last_context_tokens = COALESCE($4, track_sessions.last_context_tokens)`,
      [req.params.num, req.worker_id, claude_session_id, context_tokens ?? null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Invalidate a session after a detected resume failure (the stored id was
// pruned or never existed), so the next attempt cold-starts instead of
// retrying the same broken --resume forever.
app.delete('/track/:num/session', auth, async (req, res) => {
  try {
    if (!req.worker_id) return res.status(400).json({ error: 'worker identity required' });

    await query(
      'DELETE FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
      [req.params.num, req.worker_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Queue claim ──────────────────────────────────────────────────────────────

app.post('/tracks/claim-queue', auth, async (req, res) => {
  try {
    const projectId = await resolveWorkerProject(req, res);
    if (!projectId) return;

    const workerUser = req.worker_user_uid || null;
    const workerVisibility = req.worker_visibility || 'private';
    const workerId = req.worker_id || null;

    // withTransaction, not query(): BEGIN / FOR UPDATE SKIP LOCKED / UPDATE /
    // COMMIT must run on one held connection or SKIP LOCKED stops excluding
    // rows and two workers can claim the same track.
    const result = await withTransaction(async (client) => {
      let queryStr = `
        UPDATE tracks t
        SET lane_action_status = 'running',
            lane_action_result = 'claimed',
            claimed_by = $3
        FROM (
          SELECT id FROM tracks
          WHERE project_id = $1 AND lane_action_status = 'queue'
            AND lane_status = ANY($4)
      `;
      const params = [projectId, req.body.limit || 5, req.machine_token, CLAIMABLE_LANES];

      // Worker visibility, as in the local handler:
      //  - public:  any track in the project
      //  - team:    the owner's tracks, plus tracks whose requester granted
      //             this worker access via worker_permissions
      //  - private: the owner's tracks only
      // Auth is always on here, so there is no AUTH_ENABLED guard to mirror.
      if (workerUser && workerVisibility !== 'public') {
        if (workerVisibility === 'team' && workerId) {
          const userIdx = params.length + 1;
          const workerIdx = params.length + 2;
          queryStr += `
            AND (
              t.last_updated_by_uid = $${userIdx}
              OR t.last_updated_by_uid IS NULL
              OR EXISTS (
                SELECT 1 FROM worker_permissions wp
                WHERE wp.worker_id = $${workerIdx} AND wp.user_uid = t.last_updated_by_uid
              )
            )
          `;
          params.push(workerUser, workerId);
        } else {
          queryStr += ` AND (t.last_updated_by_uid = $${params.length + 1} OR t.last_updated_by_uid IS NULL) `;
          params.push(workerUser);
        }
      }

      // Optional single-track target: the worker's own auto-launch picks a
      // candidate from local file state, then asks atomically whether that
      // specific track is still claimable. Placed after the visibility filter
      // so a targeted claim obeys the same ownership rules as any other.
      const targetTrackNumber = req.body.track_number || null;
      if (targetTrackNumber) {
        params.push(targetTrackNumber);
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

      // Only diagnose a TARGETED claim that won nothing. An untargeted
      // "give me up to N" claim returning zero is ordinary idle polling, and a
      // second query on every idle beat of every worker is real cost for no
      // signal. Runs inside the transaction so the answer is consistent with
      // the attempt.
      let reason = null;
      if (r.rows.length === 0 && targetTrackNumber) {
        const diag = await client.query(
          'SELECT lane_status, lane_action_status FROM tracks WHERE project_id = $1 AND track_number = $2',
          [projectId, targetTrackNumber]
        );
        if (!diag.rows[0]) {
          reason = 'no_candidates';
        } else if (diag.rows[0].lane_action_status !== 'queue') {
          reason = 'already_claimed';
        } else if (!CLAIMABLE_LANES.includes(diag.rows[0].lane_status)) {
          reason = 'lane_not_claimable';
        } else {
          reason = 'not_permitted';
        }
      }

      return { tracks: r.rows, reason };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Worker dispatch inbox (track 1085) ───────────────────────────────────────
// DIVERGENCE from ui/server/index.mjs: the :id worker must be verified to
// belong to the caller's workspace. Locally there is one tenant, so the local
// handler correctly does not check; here, without it, any project key could
// read and write another workspace's dispatch queue.

app.get('/worker/:id/dispatch', auth, async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    if (!(await workerInWorkspace(workerId, req.workspace_id))) {
      return res.status(403).json({ error: 'forbidden: worker not in workspace' });
    }

    const { rows } = await query(
      "SELECT * FROM worker_dispatch WHERE worker_id = $1 AND status = 'pending' ORDER BY created_at ASC",
      [workerId]
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A dispatch this worker claimed but never reported the outcome of — its child
// finished after a restart orphaned the exit handler. Startup reconciliation
// reads this to decide which tracks are worth checking for completion evidence.
app.get('/worker/:id/dispatch/claimed', auth, async (req, res) => {
  try {
    const workerId = parseInt(req.params.id, 10);
    if (!(await workerInWorkspace(workerId, req.workspace_id))) {
      return res.status(403).json({ error: 'forbidden: worker not in workspace' });
    }

    const { rows } = await query(
      "SELECT * FROM worker_dispatch WHERE worker_id = $1 AND status = 'claimed' ORDER BY claimed_at ASC",
      [workerId]
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/worker-dispatch/:id', auth, async (req, res) => {
  try {
    const { status, result } = req.body;
    if (!DISPATCH_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${DISPATCH_STATUSES.join(', ')}` });
    }

    // worker_dispatch has no project_id column, so the workspace check goes
    // through the owning worker: dispatch -> workers.project_id ->
    // projects.workspace_id. Doing it as a subquery in the UPDATE keeps it to
    // one statement and makes an out-of-workspace id indistinguishable from a
    // missing one (both 404).
    const claimedAtSet = status === 'claimed' ? ', claimed_at = NOW()' : '';
    // `result` present vs absent is a real distinction, not a nicety: a
    // 'claimed' report carries no result, and writing NULL over an earlier
    // one would erase it.
    const scopedTo = (placeholder) => `
      AND worker_id IN (
        SELECT w.id FROM workers w
          JOIN projects p ON p.id = w.project_id
         WHERE p.workspace_id = ${placeholder}
      )`;

    const { rowCount } =
      result !== undefined
        ? await query(
            `UPDATE worker_dispatch SET status = $1, result = $2${claimedAtSet}
              WHERE id = $3 ${scopedTo('$4')}`,
            [status, result, req.params.id, req.workspace_id]
          )
        : await query(
            `UPDATE worker_dispatch SET status = $1${claimedAtSet}
              WHERE id = $2 ${scopedTo('$3')}`,
            [status, req.params.id, req.workspace_id]
          );

    if (rowCount === 0) return res.status(404).json({ error: 'dispatch entry not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Claimable tracks (assignee gate, track 1084) ─────────────────────────────

/** A track's effective owner: explicit assignee, else creator, else project owner. */
function resolveAssignee(track, project) {
  return track.assignee_uid ?? track.created_by_uid ?? project.owner_uid ?? null;
}

/**
 * All of a developer's own workers for a project (may be empty). "Own" means
 * registered under their identity (workers.user_uid, set at registration) —
 * not a separate grant. Routing to a worker registered under someone else's
 * identity is deliberately unsupported: that would dispatch work onto another
 * person's machine, which needs its own consent design, not just a query.
 */
async function resolveOwnWorkers(projectId, userUid) {
  if (!userUid) return [];
  const { rows } = await query(
    'SELECT id FROM workers WHERE project_id = $1 AND user_uid = $2',
    [projectId, userUid]
  );
  return rows;
}

app.get('/api/projects/:id/claimable-tracks', auth, checkProject, async (req, res) => {
  try {
    const workerId = req.query.worker_id ? parseInt(req.query.worker_id, 10) : null;
    if (!workerId) return res.status(400).json({ error: 'worker_id is required' });

    const { rows: [project] } = await query(
      'SELECT owner_uid FROM projects WHERE id = $1',
      [req.project_id]
    );
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { rows: tracks } = await query(
      "SELECT track_number, assignee_uid, created_by_uid FROM tracks WHERE project_id = $1 AND lane_action_status = 'queue'",
      [req.project_id]
    );

    const ownWorkersCache = new Map(); // user_uid -> Set(worker_id), avoids re-querying per track
    const claimable = [];
    for (const track of tracks) {
      const assignee = resolveAssignee(track, project);
      if (!assignee) {
        claimable.push(track.track_number); // no owner info at all — open claim
        continue;
      }

      if (!ownWorkersCache.has(assignee)) {
        const own = await resolveOwnWorkers(req.project_id, assignee);
        ownWorkersCache.set(assignee, new Set(own.map((w) => w.id)));
      }
      const candidates = ownWorkersCache.get(assignee);
      if (candidates.size === 0 || candidates.has(workerId)) claimable.push(track.track_number);
    }

    res.json({ claimable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

exports.api = onRequest({ invoker: "public", secrets: [dbPassword, dbHost, dbUser, dbUrl] }, app);
// forced update for environment (2026-03-06 15:40)

if (process.env.NODE_ENV === 'test') {
  module.exports = app;
}
