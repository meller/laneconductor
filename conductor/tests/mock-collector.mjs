#!/usr/bin/env node
// conductor/tests/mock-collector.mjs
// Minimal HTTP mock for the LaneConductor Collector API.
// Uses Node built-in `http` only — zero extra deps.
//
// Run: node conductor/tests/mock-collector.mjs [port]
//   Prints "MOCK_COLLECTOR_PORT=<port>" to stdout when ready.
//
// Test helper endpoints:
//   GET /_state  — return full in-memory state

import { createServer } from 'node:http';

// ── In-memory state ───────────────────────────────────────────────────────────

const state = {
  tracks: {},  // { [track_number]: { track_number, lane_status, lane_action_status, fail_count, ... } }
};

// ── Tiny router helper ────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function reply(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function route(method, urlPattern, req) {
  if (req.method !== method) return null;
  const urlPath = req.url.split('?')[0];
  const re = new RegExp('^' + urlPattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  const m = urlPath.match(re);
  return m ? m.groups : null;
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const body = await readBody(req);
  let params;

  // ── Startup ────────────────────────────────────────────────────────────────
  if ((params = route('POST', '/project/ensure', req)) !== null)
    return reply(res, 200, { project_id: 1 });

  if ((params = route('POST', '/worker/register', req)) !== null)
    return reply(res, 200, { machine_token: 'mock-token' });

  if ((params = route('PATCH', '/worker/heartbeat', req)) !== null)
    return reply(res, 200, { ok: true });

  if ((params = route('DELETE', '/worker', req)) !== null)
    return reply(res, 200, { ok: true });

  // ── Track upsert (called when chokidar picks up file changes) ─────────────
  if ((params = route('POST', '/track', req)) !== null) {
    const { track_number, lane_status, lane_action_status, progress_percent } = body;
    if (!track_number) return reply(res, 400, { error: 'track_number required' });
    if (!state.tracks[track_number])
      state.tracks[track_number] = { track_number, lane_action_status: 'queue', fail_count: 0 };
    const t = state.tracks[track_number];
    if (lane_status !== undefined) t.lane_status = lane_status;
    if (lane_action_status !== undefined) t.lane_action_status = lane_action_status;
    if (progress_percent !== undefined) t.progress_percent = progress_percent;
    return reply(res, 200, { ok: true });
  }

  // ── Claim queue ────────────────────────────────────────────────────────────
  // Returns 'queue' tracks WITHOUT atomically claiming them.
  // The worker PATCHes them to 'running' after spawning, which is sufficient
  // for single-worker tests (no race conditions to prevent).
  if ((params = route('POST', '/tracks/claim-queue', req)) !== null) {
    const limit = body?.limit ?? 1;
    const queued = Object.values(state.tracks)
      .filter(t => t.lane_action_status === 'queue')
      .slice(0, limit);
    return reply(res, 200, { tracks: queued });
  }

  // ── Action status update ───────────────────────────────────────────────────
  if ((params = route('PATCH', '/track/:num/action', req)) !== null) {
    const { num } = params;
    const { lane_action_status, lane_action_result, lane_status, progress_percent } = body;
    if (!state.tracks[num]) state.tracks[num] = { track_number: num, fail_count: 0 };
    const t = state.tracks[num];
    if (lane_action_status !== undefined) t.lane_action_status = lane_action_status;
    if (lane_action_result !== undefined) t.lane_action_result = lane_action_result;
    if (lane_status !== undefined) t.lane_status = lane_status;
    if (progress_percent !== undefined) t.progress_percent = progress_percent;
    return reply(res, 200, { ok: true });
  }

  // ── Retry count ────────────────────────────────────────────────────────────
  if ((params = route('GET', '/track/:num/retry-count', req)) !== null) {
    const t = state.tracks[params.num];
    return reply(res, 200, { count: t?.fail_count ?? 0 });
  }

  // ── Block (max retries reached) ────────────────────────────────────────────
  if ((params = route('PATCH', '/track/:num/block', req)) !== null) {
    if (!state.tracks[params.num]) state.tracks[params.num] = { track_number: params.num, fail_count: 0 };
    state.tracks[params.num].lane_action_status = 'failure';
    state.tracks[params.num].lane_action_result = 'max_retries_reached';
    return reply(res, 200, { ok: true });
  }

  // ── Comments (increment fail_count on automation-failure bodies) ───────────
  if ((params = route('POST', '/track/:num/comment', req)) !== null) {
    const { body: commentBody } = body;
    if (typeof commentBody === 'string' && commentBody.includes('Automation failed')) {
      if (!state.tracks[params.num]) state.tracks[params.num] = { track_number: params.num, fail_count: 0 };
      state.tracks[params.num].fail_count = (state.tracks[params.num].fail_count || 0) + 1;
    }
    return reply(res, 200, { ok: true });
  }

  // ── Lock / Unlock (Track 1010) ─────────────────────────────────────────────
  if ((params = route('POST', '/track/:num/lock', req)) !== null) {
    const { num } = params;
    if (!state.tracks[num]) state.tracks[num] = { track_number: num, fail_count: 0 };
    state.tracks[num].lane_action_status = 'running';
    state.tracks[num].locked_by = `${body.user}@${body.machine}`;
    return reply(res, 200, { ok: true });
  }

  if ((params = route('POST', '/track/:num/unlock', req)) !== null) {
    const { num } = params;
    if (state.tracks[num]) {
      state.tracks[num].locked_by = null;
    }
    return reply(res, 200, { ok: true });
  }

  // ── Bulk track operations (stale cleanup, heartbeat) ──────────────────────
  if ((params = route('GET', '/tracks/stale', req)) !== null)
    return reply(res, 200, { tracks: [] });

  if ((params = route('POST', '/tracks/reset-stuck-actions', req)) !== null)
    return reply(res, 200, { reset: 0 });

  if ((params = route('POST', '/tracks/heartbeat', req)) !== null)
    return reply(res, 200, { updated: 0 });

  // ── Conductor files + workflow ─────────────────────────────────────────────
  if ((params = route('POST', '/conductor-files', req)) !== null)
    return reply(res, 200, { ok: true });

  if ((params = route('GET', '/projects/:id/workflow', req)) !== null)
    return reply(res, 200, {});

  // ── File sync queue (no-op: tests don't use file-sync) ────────────────────
  if ((params = route('POST', '/file-sync/claim', req)) !== null)
    return reply(res, 200, { tasks: [] });

  if ((params = route('PATCH', '/file-sync/:id', req)) !== null)
    return reply(res, 200, { ok: true });

  // ── Provider status ────────────────────────────────────────────────────────
  if ((params = route('POST', '/provider-status', req)) !== null)
    return reply(res, 200, { ok: true });

  if ((params = route('GET', '/provider-status', req)) !== null)
    return reply(res, 200, { providers: [] });

  // ── Test helpers ───────────────────────────────────────────────────────────
  if ((params = route('GET', '/_state', req)) !== null)
    return reply(res, 200, state);

  // Reset all track state between tests
  if ((params = route('POST', '/_reset', req)) !== null) {
    state.tracks = {};
    return reply(res, 200, { ok: true });
  }

  // ── 404 fallback ───────────────────────────────────────────────────────────
  process.stderr.write(`[mock-collector] UNHANDLED ${req.method} ${req.url}\n`);
  reply(res, 404, { error: `unhandled: ${req.method} ${req.url}` });
});

// ── Start ──────────────────────────────────────────────────────────────────────

const port = parseInt(process.argv[2] || '0');
server.listen(port, '127.0.0.1', () => {
  const { port: p } = server.address();
  process.stdout.write(`MOCK_COLLECTOR_PORT=${p}\n`);
  process.stderr.write(`[mock-collector] listening on http://127.0.0.1:${p}\n`);
});
