#!/usr/bin/env node
// conductor/collector/index.mjs
// LaneConductor Collector — ingestion API for the heartbeat worker
// Run via: make lc-start  (starts alongside the worker)

import express from 'express';
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';

// ── Config + env ─────────────────────────────────────────────────────────────

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const { db, project, collectors } = config;

const collectorConfig = collectors?.[0] ?? {};
const PORT = process.env.COLLECTOR_PORT ?? collectorConfig.port ?? 8092;
const TOKEN = process.env.COLLECTOR_0_TOKEN ?? collectorConfig.token ?? null;

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? db.host,
  port: Number(process.env.DB_PORT ?? db.port),
  database: process.env.DB_NAME ?? db.name,
  user: process.env.DB_USER ?? db.user,
  password: process.env.DB_PASSWORD ?? db.password,
  ssl: (process.env.DB_SSL ?? db.ssl) ? { rejectUnauthorized: false } : false,
});

// ── Auth middleware ───────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { loadAuthConfig, requireAuth, AUTH_ENABLED } from '../../ui/server/auth.mjs';

// ── Auth middleware ───────────────────────────────────────────────────────────

async function auth(req, res, next) {
  if (!TOKEN) return next(); // no token configured = localhost trust
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return res.status(401).json({ error: 'unauthorized' });

  // 1. Check static collector token (backward compat)
  if (bearer === TOKEN) return next();

  // 2. Check machine token from DB (Multi-Tenant Auth)
  try {
    let queryArgs = [bearer];
    let queryStr = 'SELECT project_id FROM workers WHERE machine_token = $1';

    // If a project_id was passed explicitly, we also validate against it
    // req.query is available on GET/PATCH endpoints, or we fallback if requested
    const requestedProject = req.query.project_id || req.body.project_id;
    if (requestedProject) {
      queryStr += ' AND project_id = $2';
      queryArgs.push(requestedProject);
    }

    const { rows } = await pool.query(queryStr, queryArgs);
    if (rows.length > 0) {
      req.worker_project_id = rows[0].project_id;
      req.machine_token = bearer;
      return next();
    }
  } catch (err) {
    console.error('[collector] auth DB error:', err);
  }

  res.status(401).json({ error: 'unauthorized' });
}

// ── git_global_id helper (UUID v5, URL namespace, no extra deps) ─────────────

const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidV5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(ns).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function gitGlobalId(gitRemote) {
  if (!gitRemote) return null;
  const normalised = gitRemote.toLowerCase().replace(/\.git$/, '');
  return uuidV5(URL_NAMESPACE, normalised);
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Project ───────────────────────────────────────────────────────────────────

app.get('/project', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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
app.patch('/project', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.get('/projects/:id/workflow', auth, async (req, res) => {
  try {
    const projectId = req.params.id;
    const r = await pool.query(
      'SELECT conductor_files FROM projects WHERE id = $1',
      [projectId]
    );
    if (!r.rows[0]) return res.json({});

    const workflowMd = r.rows[0].conductor_files?.workflow || '';
    const blockRegex = /## Workflow Configuration\s+```json\s+([\s\S]*?)\s+```/;
    const match = workflowMd.match(blockRegex);
    if (!match) return res.json({});

    res.json(JSON.parse(match[1]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/conductor-files', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.post('/track', auth, async (req, res) => {
  try {
    const {
      track_number, title, lane_status, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content,
      lane_action_status,
    } = req.body;

    if (track_number === 'undefined' || track_number === 'null') {
      return res.status(400).json({ error: 'Invalid track_number: ' + track_number });
    }

    const insertLaneStatus = lane_status ?? 'planning';
    // New tracks start as 'queue' so the worker picks them up for automation.
    const insertActionStatus = lane_action_status ?? 'queue';

    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);

    // Fetch old state to detect transitions
    const oldRes = await pool.query(
      'SELECT id, lane_status, lane_action_status FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, track_number]
    );
    const oldTrack = oldRes.rows[0];

    let laneStatusClause = '';
    if (lane_status !== null) {
      laneStatusClause = `lane_status = EXCLUDED.lane_status,
         lane_action_status = CASE
           WHEN tracks.lane_action_status = 'running' THEN 'running'
           WHEN tracks.lane_status != EXCLUDED.lane_status THEN 'queue'
           ELSE tracks.lane_action_status
         END,
         lane_action_result = CASE
           WHEN tracks.lane_status != EXCLUDED.lane_status THEN NULL
           ELSE tracks.lane_action_result
         END,`;
    }

    if (lane_action_status !== null && lane_action_status !== undefined) {
      // If action status provided in body, it takes precedence (unless running)
      laneStatusClause += ` lane_action_status = CASE WHEN tracks.lane_action_status = 'running' THEN 'running' ELSE $12 END,`;
      laneStatusClause += ` lane_action_result = CASE WHEN tracks.lane_action_status = 'running' THEN tracks.lane_action_result ELSE NULL END,`;
    }

    const qRes = await pool.query(`
      INSERT INTO tracks
        (project_id, track_number, title, lane_status, progress_percent,
         current_phase, content_summary, phase_step, index_content, plan_content, spec_content,
         last_heartbeat, sync_status, last_updated_by, lane_action_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 'syncing', 'worker', $12)
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
        last_heartbeat   = NOW(),
        sync_status      = 'syncing',
        last_updated_by  = 'worker'
      RETURNING id
    `, [projectId, track_number, title, insertLaneStatus, progress_percent,
      current_phase, content_summary, phase_step,
      index_content, plan_content, spec_content, insertActionStatus]);

    const trackId = qRes.rows[0]?.id;

    // Reset retries by adding a human system comment if lane changed or manual reset to queue
    if (trackId && oldTrack) {
      const laneChanged = oldTrack.lane_status !== lane_status;
      const manuallyQueued = oldTrack.lane_action_status === 'failure' && lane_action_status === 'queue';
      
      if (laneChanged || manuallyQueued) {
        await pool.query(
          "INSERT INTO track_comments (track_id, author, body) VALUES ($1, 'human', $2)",
          [trackId, laneChanged ? `Moved to ${lane_status} (via file sync)` : `Manual retry (via file sync)`]
        );
      }
    }

    await pool.query(
      `UPDATE tracks SET sync_status = 'synced' WHERE project_id = $1 AND track_number = $2`,
      [projectId, track_number]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/heartbeat', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.patch('/track/:num/action', auth, async (req, res) => {
  try {
    const { lane_action_status, lane_action_result, last_log_tail, active_cli,
      lane_status, progress_percent,
      auto_planning_launched, auto_implement_launched, auto_review_launched } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/provider-status', auth, async (req, res) => {
  try {
    const { provider, status, reset_at, last_error } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.get('/provider-status', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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
app.post('/tracks/heartbeat', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
    const r = await pool.query(
      `UPDATE tracks SET last_heartbeat = NOW()
       WHERE project_id = $1 AND lane_status = 'in-progress'
       RETURNING track_number`,
      [projectId]
    );
    res.json({ updated: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim waiting tracks for auto-implement — atomic, uses FOR UPDATE SKIP LOCKED
// Claim tracks ready for automation (queue status)
// Supports both old endpoint name (/claim-waiting) and new (/claim-queue) for backward compatibility
async function claimTracks(req, res) {
  const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE tracks t
      SET lane_action_status = 'running',
          lane_action_result = 'claimed',
          claimed_by = $3
      FROM (
        SELECT id FROM tracks
        WHERE project_id = $1 AND lane_action_status = 'queue'
          AND lane_status IN ('planning', 'in-progress', 'review', 'quality-gate')
        ORDER BY priority DESC, CASE
          WHEN lane_status = 'planning' THEN 1
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
    `, [projectId, req.body.limit || 5, req.machine_token]);
    await client.query('COMMIT');
    res.json({ tracks: r.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

app.post('/tracks/claim-waiting', auth, claimTracks); // legacy endpoint name
app.post('/tracks/claim-queue', auth, claimTracks); // new endpoint name

app.get('/tracks/running', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.get('/tracks/waiting', auth, async (req, res) => {
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

app.get('/tracks/stale', auth, async (_req, res) => {
  try {
    const projectId = _req.query.project_id ? parseInt(_req.query.project_id) : project.id;
    const r = await pool.query(
      `SELECT track_number FROM tracks WHERE project_id = $1 AND sync_status = 'syncing'`,
      [projectId]
    );
    res.json({ tracks: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/track/:num/retry-count', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.post('/tracks/reset-stuck-actions', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
    // Reset tracks stuck in 'running' for more than 2 minutes
    const r = await pool.query(
      `UPDATE tracks SET lane_action_status = 'queue', lane_action_result = 'stuck_timeout', claimed_by = NULL
       WHERE project_id = $1 AND lane_action_status = 'running'
         AND last_heartbeat < NOW() - INTERVAL '2 minutes'
       RETURNING track_number`,
      [projectId]
    );
    res.json({ reset: r.rows.map(r => r.track_number) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/block', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.patch('/track/:num/last-comment', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.get('/track/:num', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.post('/track/:num/comment', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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
    if (safeAuthor === 'human') {
      await pool.query(
        `UPDATE tracks SET lane_action_status = 'queue', lane_action_result = NULL
         WHERE id = $1 AND lane_status IN('planning', 'in-progress', 'review', 'quality-gate')
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

    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lane drag from UI — validates lane, resets action status
app.patch('/track/:num/priority', auth, async (req, res) => {
  try {
    const { priority } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
    await pool.query(
      `UPDATE tracks SET priority = $1 WHERE project_id = $2 AND track_number = $3`,
      [priority, projectId, req.params.num]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/track/:num/lane', auth, async (req, res) => {
  try {
    const { lane_status, phase_step } = req.body;
    const VALID_LANES = ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done'];
    const VALID_STEPS = ['planning', 'coding', 'reviewing', 'complete', null];
    if (!VALID_LANES.includes(lane_status)) return res.status(400).json({ error: 'Invalid lane_status' });
    if (phase_step !== undefined && !VALID_STEPS.includes(phase_step)) return res.status(400).json({ error: 'Invalid phase_step' });

    const nextActionStatus = lane_status === 'done' ? 'success' : 'queue';
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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
      `INSERT INTO track_comments (track_id, author, body) VALUES ($1, 'human', $2)`,
      [r.rows[0].id, `Moved to ${lane_status}` + (phase_step ? ` (${phase_step})` : '')]
    );

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset track for update/fix-review — moves back to active state
app.patch('/track/:num/reset', auth, async (req, res) => {
  try {
    const { lane_status = 'planning', last_updated_by = 'human' } = req.body;
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

app.patch('/track/:num/sync-status', auth, async (req, res) => {
  try {
    const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : project.id);
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

// ── Worker registration ───────────────────────────────────────────────────────

app.post('/worker/register', async (req, res, next) => {
  if (AUTH_ENABLED) {
    return requireAuth(req, res, next);
  }
  return auth(req, res, next);
}, async (req, res) => {
  try {
    const { hostname, pid, mode } = req.body;
    let user_uid = req.body.user_uid || null;
    const projectId = req.body.project_id ? parseInt(req.body.project_id) : project.id;

    if (AUTH_ENABLED && req.user) {
      user_uid = req.user.uid;
    }

    // First check if this specific worker process already has a machine token
    let r = await pool.query('SELECT machine_token FROM workers WHERE project_id = $1 AND hostname = $2 AND pid = $3', [projectId, hostname, pid]);
    let machine_token = r.rows[0]?.machine_token;

    if (!machine_token) {
      machine_token = randomUUID();
    }

    await pool.query(`
      INSERT INTO workers(project_id, hostname, pid, status, mode, machine_token, user_uid, last_heartbeat)
      VALUES($1, $2, $3, 'idle', $4, $5, $6, NOW())
      ON CONFLICT(project_id, hostname, pid) DO UPDATE SET
      status = 'idle', mode = EXCLUDED.mode, machine_token = EXCLUDED.machine_token, user_uid = EXCLUDED.user_uid, last_heartbeat = NOW()
    `, [projectId, hostname, pid, mode || 'polling', machine_token, user_uid]);

    res.json({ ok: true, machine_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/worker/heartbeat', auth, async (req, res) => {
  try {
    const { hostname, pid, status, current_task, mode } = req.body;
    const projectId = req.worker_project_id || (req.body.project_id ? parseInt(req.body.project_id) : project.id);
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/worker', auth, async (req, res) => {
  try {
    const { hostname, pid } = req.body;
    const projectId = req.worker_project_id || (req.body.project_id ? parseInt(req.body.project_id) : project.id);
    await pool.query(
      'DELETE FROM workers WHERE project_id = $1 AND hostname = $2 AND pid = $3',
      [projectId, hostname, pid]
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
  return auth(req, res, next);
}, async (req, res) => {
  try {
    const { git_remote, name, repo_path, primary_cli, primary_model } = req.body;
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
      INSERT INTO projects (name, repo_path, git_remote, git_global_id, primary_cli, primary_model)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (repo_path) DO UPDATE SET
        name = EXCLUDED.name,
        git_remote = EXCLUDED.git_remote,
        git_global_id = EXCLUDED.git_global_id,
        primary_cli = EXCLUDED.primary_cli,
        primary_model = EXCLUDED.primary_model
      RETURNING id
    `, [name, repo_path, git_remote, git_global_id, primary_cli, primary_model]);

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
      'SELECT git_remote, git_global_id FROM projects WHERE id = $1',
      [project.id]
    );
    const row = r.rows[0];
    if (row && row.git_remote && !row.git_global_id) {
      const uuid = gitGlobalId(row.git_remote);
      await pool.query('UPDATE projects SET git_global_id = $1 WHERE id = $2', [uuid, project.id]);
      console.log(`[collector] git_global_id populated: ${uuid} `);
    }
  } catch (err) {
    console.warn(`[collector] Could not populate git_global_id: ${err.message} `);
  }
}

app.listen(PORT, async () => {
  await loadAuthConfig();
  console.log(`[collector] Listening on:${PORT} `);
  console.log(`[collector] Project: ${project.name} (id: ${project.id})`);
  console.log(`[collector] DB: ${db.name} @${db.host}:${db.port} `);
  if (AUTH_ENABLED) console.log('[collector] Auth Mode: REMOTE (Firebase Admin enabled)');
  else if (TOKEN) console.log('[collector] Auth Mode: LOCAL (static token required)');
  else console.log('[collector] Auth: none (localhost)');
  await ensureGitGlobalId();
});

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
process.on('SIGINT', async () => { await pool.end(); process.exit(0); });
