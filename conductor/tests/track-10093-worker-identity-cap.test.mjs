// Track AM-10093 Phase 5: unit coverage for the worker-identity
// classifier and startup cap decision (conductor/services/
// orphan-worker-detection.mjs), plus wiring pins into the real startup
// sequence in laneconductor.sync.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyWorkerIdentity,
  findLiveBaseIdentities,
  decideWorkerIdentityCap,
  CLAIM_WORKER_NUMBER_BASE_MULTIPLIER,
} from '../services/orphan-worker-detection.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

// ── classifyWorkerIdentity ──────────────────────────────────────────────
test('classifyWorkerIdentity: base identities are every value below the multiplier', () => {
  for (const n of [1, 2, 3, 105, 106, 999, 20007, 20008, 20012, 20014, 20015, 20018, 99999]) {
    assert.equal(classifyWorkerIdentity(n), 'base', `worker_number=${n} must classify as base`);
  }
});

test('classifyWorkerIdentity: claim-scoped identities are every value at or above the multiplier', () => {
  for (const n of [CLAIM_WORKER_NUMBER_BASE_MULTIPLIER, 100001, 100002, 200001, 300005]) {
    assert.equal(classifyWorkerIdentity(n), 'claim-scoped', `worker_number=${n} must classify as claim-scoped`);
  }
});

test('classifyWorkerIdentity: this track\'s own census — 105/106/20007/20008/20012/20014/20015/20018 are all structurally impossible as claim-scoped derivations', () => {
  // A claim-scoped row's worker_number is always workerNumber * 100000 + slot
  // (>= 100001 for the smallest possible real base identity of 1), so every
  // one of these confirmed-live-observed values must classify as base —
  // this is the corrected finding recorded in spec.md, pinned as a test so
  // it can never silently regress back to the disproven "might be
  // claim-scoped" theory.
  for (const n of [105, 106, 20007, 20008, 20012, 20014, 20015, 20018]) {
    assert.equal(classifyWorkerIdentity(n), 'base');
  }
});

test('classifyWorkerIdentity: non-numeric/negative input fails toward counting it (base), never silently dropped', () => {
  assert.equal(classifyWorkerIdentity(undefined), 'base');
  assert.equal(classifyWorkerIdentity(NaN), 'base');
  assert.equal(classifyWorkerIdentity(-1), 'base');
});

// ── findLiveBaseIdentities ──────────────────────────────────────────────
// TC-5.4
test('TC-5.4: project with 1 base identity running 3 concurrent lane actions (3 claim-scoped rows) counts as 1', () => {
  const workers = [
    { worker_number: 1, project_id: 1, hostname: 'h1', pid: 100 },
    { worker_number: 100001, project_id: 1, hostname: 'h1', pid: 101 },
    { worker_number: 100002, project_id: 1, hostname: 'h1', pid: 102 },
    { worker_number: 100003, project_id: 1, hostname: 'h1', pid: 103 },
  ];
  const live = findLiveBaseIdentities(workers, { projectId: 1, hostname: 'h1' });
  assert.equal(live.length, 1);
  assert.equal(live[0].worker_number, 1);
});

// TC-5.5
test('TC-5.5: a manager row (type: manager) is never counted, even with a small worker_number and matching project_id null', () => {
  const workers = [
    { worker_number: 1, project_id: null, hostname: 'h1', pid: 50, type: 'manager' },
    { worker_number: 1, project_id: 1, hostname: 'h1', pid: 100 },
  ];
  const live = findLiveBaseIdentities(workers, { projectId: 1, hostname: 'h1' });
  assert.equal(live.length, 1);
  assert.equal(live[0].pid, 100);
});

test('findLiveBaseIdentities filters by project_id and hostname independently', () => {
  const workers = [
    { worker_number: 1, project_id: 1, hostname: 'h1', pid: 1 },
    { worker_number: 1, project_id: 2, hostname: 'h1', pid: 2 }, // different project
    { worker_number: 1, project_id: 1, hostname: 'h2', pid: 3 }, // different host
  ];
  const live = findLiveBaseIdentities(workers, { projectId: 1, hostname: 'h1' });
  assert.equal(live.length, 1);
  assert.equal(live[0].pid, 1);
});

test('findLiveBaseIdentities tolerates a non-array input (defensive)', () => {
  assert.deepEqual(findLiveBaseIdentities(null, { projectId: 1, hostname: 'h1' }), []);
  assert.deepEqual(findLiveBaseIdentities(undefined, { projectId: 1, hostname: 'h1' }), []);
});

// ── decideWorkerIdentityCap ─────────────────────────────────────────────
// TC-5.1
test('TC-5.1: a second base identity is refused when one already exists (default cap 1)', () => {
  const d = decideWorkerIdentityCap({ liveCount: 1, maxBaseWorkersPerProject: 1 });
  assert.equal(d.allow, false);
  assert.equal(d.warn, true);
});

test('no existing identity — always allowed, no warning', () => {
  const d = decideWorkerIdentityCap({ liveCount: 0, maxBaseWorkersPerProject: 1 });
  assert.equal(d.allow, true);
  assert.equal(d.warn, false);
});

// TC-5.2
test('TC-5.2: LC_ALLOW_DUPLICATE_WORKER override allows starting anyway, but still warns', () => {
  const d = decideWorkerIdentityCap({ liveCount: 1, maxBaseWorkersPerProject: 1, allowDuplicate: true });
  assert.equal(d.allow, true);
  assert.equal(d.warn, true);
});

// TC-5.3
test('TC-5.3: LC_MAX_BASE_WORKERS_PER_PROJECT=0 disables the check entirely', () => {
  const d = decideWorkerIdentityCap({ liveCount: 5, maxBaseWorkersPerProject: 0 });
  assert.equal(d.allow, true);
});

test('a higher configured cap allows more than one before refusing', () => {
  assert.equal(decideWorkerIdentityCap({ liveCount: 2, maxBaseWorkersPerProject: 3 }).allow, true);
  assert.equal(decideWorkerIdentityCap({ liveCount: 3, maxBaseWorkersPerProject: 3 }).allow, false);
});

// ── Wiring pins ─────────────────────────────────────────────────────────
test('TC-5.5/TC-5.6: the startup cap check is skipped for local-fs and for the manager', () => {
  const checkSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('Track AM-10093 (REQ-8/REQ-9)'),
    SYNC_SRC.indexOf('await upsertWorker();')
  );
  assert.ok(checkSection.includes('if (!getIsLocalFs() && !isManager)'), 'must gate on both local-fs and manager exemptions');
});

test('the startup check runs before this process registers itself (before upsertWorker)', () => {
  const checkIdx = SYNC_SRC.indexOf('decideWorkerIdentityCap({');
  const registerIdx = SYNC_SRC.indexOf('await upsertWorker();');
  assert.ok(checkIdx !== -1 && registerIdx !== -1);
  assert.ok(checkIdx < registerIdx, 'checking after registering would always see (at least) this process\'s own row');
});

test('a refusal exits non-zero', () => {
  const checkSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('Track AM-10093 (REQ-8/REQ-9)'),
    SYNC_SRC.indexOf('await upsertWorker();')
  );
  assert.ok(checkSection.includes('process.exit(1)'));
});

// TC-5.1 (message content)
test('TC-5.1: the refusal message names the existing identity\'s worker_number, pid, and cwd, not just a bare count', () => {
  const checkSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('Track AM-10093 (REQ-8/REQ-9)'),
    SYNC_SRC.indexOf('await upsertWorker();')
  );
  const refusalIdx = checkSection.indexOf('if (!decision.allow) {');
  const refusalBlock = checkSection.slice(refusalIdx, checkSection.indexOf('process.exit(1);', refusalIdx));
  assert.ok(refusalBlock.includes('describeIdentity'), 'the refusal message must build its text from describeIdentity (worker_number/pid/cwd), not a bare count');
  const describeFn = checkSection.slice(checkSection.indexOf('const describeIdentity ='), checkSection.indexOf('if (decision.warn)'));
  assert.ok(describeFn.includes('worker_number=${w.worker_number}'));
  assert.ok(describeFn.includes('pid=${w.pid'));
  assert.ok(describeFn.includes('cwd=${cwd}'));
});

test('a collector failure during the check fails open (does not exit)', () => {
  const checkSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('Track AM-10093 (REQ-8/REQ-9)'),
    SYNC_SRC.indexOf('await upsertWorker();')
  );
  const catchBlock = checkSection.slice(checkSection.indexOf('} catch (err) {'));
  assert.ok(!catchBlock.includes('process.exit'), 'a collector/network failure while checking must never itself block startup');
});

// TC-5.7: satisfied by construction — GET /api/workers (the only source
// this check reads from) already filters to last_heartbeat within the
// last 60s at the SQL level, so a stale-heartbeat identity is never even
// returned for findLiveBaseIdentities to see. Pinned here rather than
// re-implemented client-side, to catch that filter ever being removed.
test('TC-5.7: GET /api/workers filters to fresh heartbeats at the query level (stale identities never reach findLiveBaseIdentities)', () => {
  const apiSrc = readFileSync(new URL('../../ui/server/index.mjs', import.meta.url), 'utf8');
  const endpointIdx = apiSrc.indexOf("app.get('/api/workers'");
  assert.ok(endpointIdx !== -1, '/api/workers endpoint must exist');
  const endpointSection = apiSrc.slice(endpointIdx, endpointIdx + 2000);
  assert.ok(
    endpointSection.includes("last_heartbeat > NOW() - INTERVAL '60 seconds'"),
    '/api/workers must keep filtering to fresh heartbeats — this track\'s worker-identity cap relies on it to satisfy TC-5.7 without its own staleness check'
  );
});
