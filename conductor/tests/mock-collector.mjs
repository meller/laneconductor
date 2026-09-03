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

  // Track 1102 F12: simulate a genuine full outage window — every write
  // (any non-GET) fails until a deadline, regardless of endpoint.
  // Time-based rather than a request-count budget: unrelated background
  // traffic (file-sync polling, other periodic POSTs) shares whatever
  // pool a count-based budget would use and can consume it before the
  // exit handler's own calls ever arrive, making a count non-deterministic.
  // Distinct from /_set-fail-track-action (one specific endpoint only) —
  // this is for reproducing "the network/DB was down for a moment"
  // across every call a run's exit handler makes, not just its direct
  // completion PATCH. The /_set-fail-* control endpoints themselves are
  // exempt so a test can always turn this off.
  if (req.method !== 'GET' && !req.url.startsWith('/_') && state.failAllWritesUntil && Date.now() < state.failAllWritesUntil) {
    return reply(res, 500, { error: 'simulated full outage (test-injected)' });
  }
  if ((params = route('POST', '/_set-fail-all-writes', req)) !== null) {
    state.failAllWritesUntil = Number(body.durationMs) > 0 ? Date.now() + Number(body.durationMs) : 0;
    return reply(res, 200, { ok: true });
  }

  // ── Startup ────────────────────────────────────────────────────────────────
  if ((params = route('POST', '/project/ensure', req)) !== null) {
    state.projectEnsureCalls++;
    return reply(res, 200, { project_id: 1 });
  }

  if ((params = route('POST', '/worker/register', req)) !== null) {
    // Track 1084 Phase 8: lets a test simulate a worker whose
    // /worker/register call never succeeds (the live 2026-08-17 incident —
    // a race left one process's myWorkerId permanently null) without
    // needing a real collector-side failure to reproduce.
    if (state.failRegister) return reply(res, 500, { error: 'registration disabled for this test' });
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

  if ((params = route('POST', '/_set-fail-register', req)) !== null) {
    state.failRegister = body.fail !== false;
    return reply(res, 200, { ok: true });
  }

  // Track 1102 F12: fail the next N PATCH /track/:num/action calls (the
  // exit handler's "run finished" report), so a test can reproduce a
  // transient network/DB outage at that exact moment and prove whether
  // anything ever retries it.
  if ((params = route('POST', '/_set-fail-track-action', req)) !== null) {
    state.failTrackActionCount = Number(body.count) || 0;
    return reply(res, 200, { ok: true });
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

  // Track 10020 Phase 2/4: mirrors the real server's GET
  // /worker/:id/dispatch/claimed (ui/server/index.mjs) — periodic orphan
  // reconciliation reads this to find dispatches this worker claimed but
  // never reported an outcome for.
  if ((params = route('GET', '/worker/:id/dispatch/claimed', req)) !== null) {
    const entries = state.dispatch.filter(d => String(d.worker_id) === params.id && d.status === 'claimed');
    return reply(res, 200, { entries });
  }

  // Track 10054: mirrors the real server's GET
  // /project/:id/dispatch/claimed-by-offline-workers — the counterpart
  // above only ever finds a dispatch still owned by ITS OWN worker_id, so
  // a dispatch claimed by a now-offline DIFFERENT worker identity
  // (--worker-number, track 1084) was invisible to every other worker's
  // reconciler. `state.offlineWorkerIds` (settable via
  // /_set-offline-workers) stands in for the real server's
  // last_heartbeat-staleness check.
  if ((params = route('GET', '/project/:id/dispatch/claimed-by-offline-workers', req)) !== null) {
    const offlineIds = new Set((state.offlineWorkerIds || []).map(String));
    const offlineWorkerIdsForProject = new Set(
      state.workers.filter(w => String(w.project_id) === params.id && offlineIds.has(String(w.id))).map(w => String(w.id))
    );
    const entries = state.dispatch.filter(d => offlineWorkerIdsForProject.has(String(d.worker_id)) && d.status === 'claimed');
    return reply(res, 200, { entries });
  }

  if ((params = route('POST', '/_set-offline-workers', req)) !== null) {
    state.offlineWorkerIds = body.workerIds || [];
    return reply(res, 200, { ok: true });
  }

  if ((params = route('PATCH', '/worker-dispatch/:id', req)) !== null) {
    const entry = state.dispatch.find(d => String(d.id) === params.id);
    if (!entry) return reply(res, 404, { error: 'dispatch entry not found' });
    entry.status = body.status;
    if (body.result !== undefined) entry.result = body.result;
    // Mirrors the real server's `claimed_at = NOW()` write on a transition
    // to 'claimed' — Phase 2's grace-period guard reads this.
    if (body.status === 'claimed') entry.claimed_at = new Date().toISOString();
    // Track 10020 Phase 4 (TC-2.3): count TERMINAL-outcome PATCHes only
    // (not the claim-time PATCH above) so a test can assert
    // reconcileActiveDispatch() and the periodic orphan-reconcile tick
    // never both finalize the same dispatch.
    if (body.status !== 'claimed') entry.finalizePatchCount = (entry.finalizePatchCount || 0) + 1;
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
    const entry = byToken[params.num];
    // Track 10047 (REQ-7): sessionsByToken entries are now objects, not
    // bare claude_session_id strings — mirrors the real server's GET
    // returning last_context_tokens/resume_count alongside the id, which
    // is what the worker's bounded-resume cap actually reads.
    return reply(res, 200, {
      claude_session_id: entry?.claude_session_id ?? null,
      last_context_tokens: entry?.last_context_tokens ?? null,
      resume_count: entry?.resume_count ?? 0,
    });
  }

  if ((params = route('POST', '/track/:num/session', req)) !== null) {
    if (bearerToken) {
      const byToken = (state.sessionsByToken[bearerToken] ??= {});
      const existing = byToken[params.num];
      const sameSession = !!existing && existing.claude_session_id === body.claude_session_id;
      byToken[params.num] = {
        claude_session_id: body.claude_session_id,
        // Mirrors the real server's ON CONFLICT CASE: increment on the
        // same session id, reset to 0 on a different one.
        resume_count: sameSession ? (existing.resume_count ?? 0) + 1 : 0,
        // Mirrors the real server's COALESCE: only overwritten when this
        // POST actually supplies context_tokens.
        last_context_tokens: (body.context_tokens ?? null) !== null
          ? body.context_tokens
          : (existing?.last_context_tokens ?? null),
      };
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
    if (state.failTrackActionCount > 0) {
      state.failTrackActionCount -= 1;
      return reply(res, 500, { error: 'simulated outage (test-injected)' });
    }
    const { num } = params;
    const { lane_action_status, lane_action_result, lane_status, progress_percent, last_log_tail, active_cli,
      pr_number, pr_url, pr_status, merge_mode } = body;
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
    // Track 10018 Phase 11: patchTrackPrFields() PATCHes this same endpoint
    // with these fields (see laneconductor.sync.mjs) — needed so a
    // subprocess test can assert the worker actually synced PR state to
    // the collector, not just to the local index.md marker.
    if (pr_number !== undefined) t.pr_number = pr_number;
    if (pr_url !== undefined) t.pr_url = pr_url;
    if (pr_status !== undefined) t.pr_status = pr_status;
    if (merge_mode !== undefined) t.merge_mode = merge_mode;
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
    state.failRegister = false;
    state.failTrackActionCount = 0;
    state.failAllWritesUntil = 0;
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
