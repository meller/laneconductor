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
  workers: [], // [{ hostname, pid, worker_number, project_id, ... }] — every /worker/register call, in order
  claimable: null, // Track 1084 Phase 3: null = "not configured" (endpoint 500s, matching a real misconfigured server); an array = the claimable set /api/projects/:id/claimable-tracks returns
  nextWorkerId: 900, // arbitrary base so test worker ids don't collide with anything real
  dispatch: [], // Track 1085: [{ id, worker_id, track_number, action, payload, status, result }] — seeded via /_enqueue-dispatch
  nextDispatchId: 1,
  sessions: {}, // Track 1086: { [track_number]: claude_session_id } — mirrors whichever worker wrote LAST, kept for tests written before per-worker scoping existed. Only accurate when a single worker is in play; see sessionsByToken for the real per-caller view.
  sessionsByToken: {}, // Track 1113: { [bearerToken]: { [track_number]: claude_session_id } } — every worker gets its OWN machine_token (see /worker/register below), and session lookup/write is scoped by the CALLING worker's token, matching collectorAuth's req.worker_id scoping on the real server. Added after a real cross-worker session leak (track 182, aitutor, 2026-08-14) traced back to every worker in a project sharing one token in this mock, which could never have caught it.
  comments: [], // Track 1086 Phase 4: [{ track_number, author, body }] — every /track/:num/comment POST, in order (proves conversation.md entries actually reach the sync pipeline, not just the file)
  projectEnsureCalls: 0, // Track 1091 Phase 2: proves a manager worker skips /project/ensure entirely (it isn't "for" any project)
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
  const bearerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  let params;

  // ── Startup ────────────────────────────────────────────────────────────────
  if ((params = route('POST', '/project/ensure', req)) !== null) {
    state.projectEnsureCalls++;
    return reply(res, 200, { project_id: 1 });
  }

  if ((params = route('POST', '/worker/register', req)) !== null) {
    const id = state.nextWorkerId++;
    // One token PER WORKER — a shared 'mock-token' for every registrant is
    // exactly the bug this mock is meant to be able to catch (see the
    // sessionsByToken comment above). Callers only get back the token for
    // their own registration; using it is what proves identity downstream.
    const machine_token = `mock-token-${id}`;
    state.workers.push({ ...body, id, machine_token });
    return reply(res, 200, { machine_token, id });
  }

  // Track 1084 Phase 3: claimable-tracks. Defaults to null (endpoint 500s,
  // matching how the real server would fail if misconfigured) so tests that
  // don't care about this feature see the sync worker fall back to
  // unrestricted claiming, same as today's behavior. Set via /_set-claimable.
  if ((params = route('GET', '/api/projects/:id/claimable-tracks', req)) !== null) {
    if (state.claimable === null) return reply(res, 500, { error: 'claimable-tracks not configured for this test' });
    return reply(res, 200, { claimable: state.claimable });
  }

  if ((params = route('GET', '/api/projects/:id/tracks', req)) !== null) {
    return reply(res, 200, Object.values(state.tracks));
  }

  if ((params = route('POST', '/_set-claimable', req)) !== null) {
    state.claimable = body.claimable ?? [];
    return reply(res, 200, { ok: true });
  }

  // Track 1085: dispatch inbox — worker-facing endpoints only (the
  // enqueue-side /api/tracks/:id/dispatch and /api/projects/:id/dispatch
  // endpoints live on the real Collector API/ui-server, not the sync
  // worker's collector connection, so they're not mocked here).
  if ((params = route('GET', '/worker/:id/dispatch', req)) !== null) {
    const entries = state.dispatch.filter(d => String(d.worker_id) === params.id && d.status === 'pending');
    return reply(res, 200, { entries });
  }

  if ((params = route('PATCH', '/worker-dispatch/:id', req)) !== null) {
    const entry = state.dispatch.find(d => String(d.id) === params.id);
    if (!entry) return reply(res, 404, { error: 'dispatch entry not found' });
    entry.status = body.status;
    if (body.result !== undefined) entry.result = body.result;
    return reply(res, 200, { ok: true });
  }

  if ((params = route('POST', '/_enqueue-dispatch', req)) !== null) {
    const id = state.nextDispatchId++;
    state.dispatch.push({ id, status: 'pending', payload: null, result: null, ...body });
    return reply(res, 200, { id });
  }

  // Track 1086/1113: session lookup/upsert, scoped by the CALLING worker's
  // bearer token — mirrors the real server's (track_number, req.worker_id)
  // key. state.sessions[num] is also updated as a flat "last writer" mirror
  // so single-worker tests written before per-worker scoping existed don't
  // need to change.
  if ((params = route('GET', '/track/:num/session', req)) !== null) {
    const byToken = bearerToken ? (state.sessionsByToken[bearerToken] ??= {}) : {};
    return reply(res, 200, { claude_session_id: byToken[params.num] ?? null });
  }

  if ((params = route('POST', '/track/:num/session', req)) !== null) {
    if (bearerToken) {
      (state.sessionsByToken[bearerToken] ??= {})[params.num] = body.claude_session_id;
    }
    state.sessions[params.num] = body.claude_session_id;
    return reply(res, 200, { ok: true });
  }

  if ((params = route('DELETE', '/track/:num/session', req)) !== null) {
    if (bearerToken && state.sessionsByToken[bearerToken]) delete state.sessionsByToken[bearerToken][params.num];
    delete state.sessions[params.num];
    return reply(res, 200, { ok: true });
  }

  if ((params = route('PATCH', '/worker/heartbeat', req)) !== null) {
    const w = state.workers.find(x => x.hostname === body.hostname && x.pid === body.pid);
    if (w) {
      if (body.available_models !== undefined) w.available_models = body.available_models;
      if (body.status !== undefined) w.status = body.status;
    }
    return reply(res, 200, { ok: true });
  }

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
  // Track 1110 Phase 3: this used to just RETURN 'queue' tracks without
  // marking them claimed — fine when nothing could race, but the whole
  // point of this endpoint (and this mock) is now to prove races DON'T
  // happen. Mutates lane_action_status to 'running' on whatever it
  // returns, single-threaded (Node's request handling here is not
  // actually concurrent per request, mirroring the real server's
  // FOR UPDATE SKIP LOCKED transaction: only one caller can ever see a
  // given track in the 'queue' state). Supports an optional track_number
  // filter, matching the real server (POST /tracks/claim-queue accepts
  // it since Track 1110 Phase 3).
  if ((params = route('POST', '/tracks/claim-queue', req)) !== null) {
    const limit = body?.limit ?? 1;
    const trackNumberFilter = body?.track_number;
    const eligible = Object.values(state.tracks).filter(t =>
      t.lane_action_status === 'queue' && (!trackNumberFilter || t.track_number === trackNumberFilter)
    );
    const claimed = eligible.slice(0, limit);
    for (const t of claimed) {
      t.lane_action_status = 'running';
      t.lane_action_result = 'claimed';
    }
    return reply(res, 200, { tracks: claimed });
  }

  // ── Action status update ───────────────────────────────────────────────────
  if ((params = route('PATCH', '/track/:num/action', req)) !== null) {
    const { num } = params;
    const { lane_action_status, lane_action_result, lane_status, progress_percent, last_log_tail, active_cli } = body;
    if (!state.tracks[num]) state.tracks[num] = { track_number: num, fail_count: 0 };
    const t = state.tracks[num];
    if (lane_action_status !== undefined) t.lane_action_status = lane_action_status;
    if (lane_action_result !== undefined) t.lane_action_result = lane_action_result;
    if (lane_status !== undefined) t.lane_status = lane_status;
    if (progress_percent !== undefined) t.progress_percent = progress_percent;
    // Track 1087 Phase 7: capture the raw-tail PATCH fields so tests can
    // confirm the old (pre-1087) mechanism still fires unmodified for
    // non-claude CLIs (Phase 2 Task 4's "no regression" claim).
    if (last_log_tail !== undefined) t.last_log_tail = last_log_tail;
    if (active_cli !== undefined) t.active_cli = active_cli;
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
    const { body: commentBody, author } = body;
    state.comments.push({ track_number: params.num, author, body: commentBody });
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
    state.workers = [];
    state.claimable = null;
    state.dispatch = [];
    state.sessions = {};
    state.sessionsByToken = {};
    state.comments = [];
    state.projectEnsureCalls = 0;
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
