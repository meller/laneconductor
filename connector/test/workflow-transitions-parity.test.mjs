// Track AM-10131 (TC-16, TC-17): ONE LOGIC, TWO CALLERS. The sync daemon's transition sites now call the shared module
// (conductor/services/workflow-transitions.mjs). This is the PARITY test: the same table of workflow configs and outcomes runs through
// (a) the daemon's behavior BEFORE this track, kept below as frozen baselines copied verbatim from the code that was replaced, and
// (b) the patched daemon helpers. They must give identical lane and status, except for the DIFFERENCES list: every case where the old
// daemon differed from track 1020's grammar or from the shared module is named there, asserted, and left for the owner to decide.
//
// PURE: nothing here imports laneconductor.sync.mjs or starts a worker (the sites' logic lives in conductor/services/daemon-transition.mjs,
// which imports only the shared module and conductor/constants.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lanes } from '../../conductor/constants.mjs';
import { resolveTransition, runtimeTargetLane } from '../../conductor/services/daemon-transition.mjs';
import { classifyOrphanedDispatch, matchForwardTransition } from '../../conductor/services/orphaned-dispatch.mjs';
import { deriveValidRestingStates } from '../../conductor/services/resting-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'workflow', n), 'utf8'));
const FIXTURES = { A: fixture('a-otralingo-legacy.json'), B: fixture('b-current-default.json'), C: fixture('c-custom.json') };

// ---- FROZEN BASELINES: the daemon before track AM-10131, verbatim ----

// conductor/laneconductor.sync.mjs resolveTransition()
function legacyResolveTransition(configValue, currentLane, isSuccess, isMaxRetries) {
  if (!configValue || configValue === 'stay' || configValue === 'stop') {
    return {
      lane: currentLane || Lanes.PLAN,
      status: isSuccess ? 'success' : (isMaxRetries ? 'failure' : 'queue'),
    };
  }
  const [lane, status] = configValue.split(':');
  if (!status) {
    const movingToNewLane = lane !== currentLane;
    const defaultStatus = movingToNewLane ? 'queue' : (isSuccess ? 'success' : (isMaxRetries ? 'failure' : 'queue'));
    return { lane: lane || currentLane || Lanes.PLAN, status: defaultStatus };
  }
  return { lane: lane || currentLane || Lanes.PLAN, status };
}

// conductor/agent-runtime.mjs spawnCli exit handler: the lane it writes
function legacyRuntimeTargetLane(laneConfig, isSuccess, laneStatus) {
  let targetLane = laneStatus;
  if (isSuccess && laneConfig.on_success && laneConfig.on_success !== 'stay') targetLane = laneConfig.on_success;
  else if (!isSuccess && laneConfig.on_failure && laneConfig.on_failure !== 'stay') targetLane = laneConfig.on_failure;
  return targetLane;
}

// conductor/services/orphaned-dispatch.mjs matchForwardTransition()
function legacyMatchForwardTransition(action, lane, workflowConfig) {
  const laneConfig = workflowConfig?.lanes?.[action?.trim()];
  if (!laneConfig || !lane) return null;
  const targetLaneOf = (transition) => transition?.split(':')[0]?.trim().toLowerCase();
  const normalizedLane = lane.trim().toLowerCase();
  if (targetLaneOf(laneConfig.on_success) === normalizedLane) return 'on_success';
  if (targetLaneOf(laneConfig.on_failure) === normalizedLane) return 'on_failure';
  return null;
}

// conductor/services/resting-state.mjs deriveValidRestingStates(): whether a lane's on_success names the lane itself
function legacyRestingSelfParks(onSuccess, lane) {
  const [targetLane] = onSuccess.split(':');
  return targetLane === lane;
}

// ---- the table ----

const STATUS_LIST = ['queue', 'running', 'success', 'failure', 'waiting'];
const REAL_VALUES = new Set([null, undefined, 'stay', 'stop']);
for (const wf of Object.values(FIXTURES)) {
  for (const cfg of Object.values(wf.lanes)) for (const v of [cfg.on_success, cfg.on_failure]) REAL_VALUES.add(v);
  for (const lane of Object.keys(wf.lanes)) { REAL_VALUES.add(lane); for (const s of STATUS_LIST) REAL_VALUES.add(`${lane}:${s}`); }
}
REAL_VALUES.add('backlog');
REAL_VALUES.add('done');
const ODD_VALUES = ['', 'Review', ' review ', 'review: queue', 'review:queue:x', ':queue', ':', 'a:'];
const LANES = [...new Set(Object.values(FIXTURES).flatMap((wf) => Object.keys(wf.lanes))), undefined, 'backlog', 'Review'];
const FLAGS = [[true, false], [false, false], [false, true], [true, true]]; // [isSuccess, isMaxRetries]

const fmt = (r) => `${r.lane}:${r.status}`;

test('TC-17: resolveTransition (lane results and verdicts in laneconductor.sync.mjs): identical to the old daemon for every real value, lane and outcome', () => {
  let n = 0;
  for (const value of REAL_VALUES) {
    for (const lane of LANES) {
      for (const [isSuccess, isMaxRetries] of FLAGS) {
        const old = legacyResolveTransition(value, lane, isSuccess, isMaxRetries);
        const now = resolveTransition(value, lane, isSuccess, isMaxRetries);
        // Documented difference D1: case/whitespace-insensitive "same lane" ('Review' as the current lane against a 'review' target).
        if (lane === 'Review' && typeof value === 'string' && /^review(:|$)/i.test(value)) continue;
        assert.equal(fmt(now), fmt(old), `value ${JSON.stringify(value)} lane ${lane} success=${isSuccess} maxRetries=${isMaxRetries}`);
        n += 1;
      }
    }
  }
  assert.ok(n > 1000, `the table is big enough (${n} rows)`);
});

test('TC-17: the old daemon\'s retry behavior is kept by a named shim: a bare same-lane failure target that has not hit max_retries re-queues, 1020 says failure', () => {
  // The verdict override path passes a failing verdict's target with isMaxRetries false.
  assert.equal(fmt(legacyResolveTransition('implement', 'implement', false, false)), 'implement:queue');
  assert.equal(fmt(resolveTransition('implement', 'implement', false, false)), 'implement:queue', 'shim keeps the daemon\'s re-queue');
  assert.equal(fmt(resolveTransition('implement', 'implement', false, true)), 'implement:failure', 'at max retries it is the grammar\'s failure');
  assert.equal(fmt(resolveTransition('implement:failure', 'implement', false, false)), 'implement:failure', 'explicit stays as written');
});

test('TC-17: DIFFERENCES between the old daemon and the shared module, for odd or malformed targets (named, asserted, left to the owner)', () => {
  const d = (value, lane, isSuccess = true, isMaxRetries = false) => ({ old: fmt(legacyResolveTransition(value, lane, isSuccess, isMaxRetries)), now: fmt(resolveTransition(value, lane, isSuccess, isMaxRetries)) });
  // D1: same-lane is compared ignoring case and surrounding spaces (old: exact string).
  assert.deepEqual(d('review', 'Review'), { old: 'review:queue', now: 'review:success' });
  assert.deepEqual(d(' review ', 'review'), { old: ' review :queue', now: 'review:success' });
  // D2: a status is trimmed, and only the first colon splits (old: split(':') kept the second piece only and did not trim).
  assert.deepEqual(d('review: queue', 'implement'), { old: 'review: queue', now: 'review:queue' });
  assert.deepEqual(d('review:queue:x', 'implement'), { old: 'review:queue', now: 'review:queue:x' });
  // D3: an empty lane with a status (':queue') and a lone colon: old looked at '' !== currentLane (a "move"); the shared module reads an
  // empty lane as the current lane (what `lane || currentLane` in the old code already returned as the lane).
  assert.deepEqual(d(':', 'implement'), { old: 'implement:queue', now: 'implement:success' });
  assert.deepEqual(d('a:', 'implement'), { old: 'a:queue', now: 'a:queue' });
  assert.deepEqual(d(':queue', 'implement'), { old: 'implement:queue', now: 'implement:queue' });
  assert.deepEqual(d('', 'implement'), { old: 'implement:success', now: 'implement:success' }, 'an empty target is "no target" in both');
});

test('TC-17: DIFFERENCES daemon resolver vs shared resolver: stay / stop, defaults.on_*, null targets, legacy bare targets (owner decides each)', async () => {
  const { resolveNext, resolveTarget } = await import('../../conductor/services/workflow-transitions.mjs');
  // D7: `stay` and `stop` are daemon-era words for "no target". The daemon keeps them (shim NO_TARGET_STAYS: the track stays in its lane
  // with status success / failure / queue); the shared grammar (1020) does not know them and would read a lane named `stay`.
  for (const w of ['stay', 'stop']) {
    assert.equal(fmt(resolveTransition(w, 'implement', true, false)), 'implement:success');
    assert.deepEqual(resolveTarget(w, 'implement', 'success'), { lane: w, status: 'queue' });
  }
  // D8: a missing / null target. The daemon still STAYS in the lane with a status (implement:success on success, implement:failure at max
  // retries, implement:queue otherwise); the shared resolver says "no automatic move" (null), which the connector refuses for `outcome`.
  assert.equal(fmt(resolveTransition(null, 'done', true, false)), 'done:success');
  assert.equal(resolveTarget(null, 'done', 'success'), null);
  assert.equal(fmt(resolveTransition(undefined, 'implement', false, false)), 'implement:queue');
  // D9: `defaults.on_success` / `defaults.on_failure` of the daemon-era file. The daemon site reads them (laneconductor.sync.mjs:
  // `currentLaneConfig?.on_success || workflowConfig?.defaults?.on_success`, left as it was) when the lane has no target; the shared
  // resolver ignores `defaults` (1020 knows only the lane's own fields). Same file, two answers for a lane without a target.
  const wf = { defaults: { on_success: 'review' }, lanes: { build: {} } };
  const daemonValue = wf.lanes.build.on_success || wf.defaults.on_success;
  assert.equal(fmt(resolveTransition(daemonValue, 'build', true, false)), 'review:queue');
  assert.equal(resolveNext(wf, 'build', 'success').next, null);
  // D10: legacy bare targets agree: bare other lane -> queue, bare same lane -> success / failure (failure only at max retries in the daemon).
  assert.equal(fmt(resolveTransition('review', 'in-progress', true, false)), 'review:queue');
  assert.deepEqual(resolveNext(FIXTURES.A, 'in-progress', 'success').next, { lane: 'review', status: 'queue' });
  assert.equal(fmt(resolveTransition('in-progress', 'in-progress', false, true)), 'in-progress:failure');
  assert.deepEqual(resolveNext(FIXTURES.A, 'in-progress', 'failure').next, { lane: 'in-progress', status: 'failure' });
  // D11: the daemon re-queues a bare same-lane failure that has not used max_retries (shim RETRY_REQUEUE); the shared resolver gives `failure`.
  assert.equal(fmt(resolveTransition('in-progress', 'in-progress', false, false)), 'in-progress:queue');
  assert.deepEqual(resolveNext(FIXTURES.A, 'in-progress', 'failure').next, { lane: 'in-progress', status: 'failure' });
});

test('TC-17: spawnCli (agent-runtime.mjs): the lane written after a run is the same for legacy bare targets', () => {
  for (const wf of [FIXTURES.A, FIXTURES.C]) {
    for (const [lane, cfg] of Object.entries(wf.lanes)) {
      for (const isSuccess of [true, false]) {
        const old = legacyRuntimeTargetLane(cfg, isSuccess, lane);
        const now = runtimeTargetLane(cfg, isSuccess, lane);
        const value = isSuccess ? cfg.on_success : cfg.on_failure;
        if (typeof value === 'string' && value.includes(':')) {
          // D4: the old code wrote the whole target, status included, into **Lane** (`**Lane**: build:queue`), which is not a lane.
          assert.equal(old, value, `${lane}: old wrote the raw target`);
          assert.equal(now, value.split(':')[0], `${lane}: the lane part only`);
        } else {
          assert.equal(now, old, `${lane} ${isSuccess ? 'success' : 'failure'}`);
        }
      }
    }
  }
  // The lane part for the current format: a documented difference (D4), the old output was an invalid lane.
  for (const [lane, cfg] of Object.entries(FIXTURES.B.lanes)) {
    for (const isSuccess of [true, false]) {
      const value = isSuccess ? cfg.on_success : cfg.on_failure;
      const now = runtimeTargetLane(cfg, isSuccess, lane);
      if (!value || value === 'stay') assert.equal(now, lane);
      else assert.equal(now, value.split(':')[0], `${lane}`);
    }
  }
  assert.equal(runtimeTargetLane({ on_success: 'stay' }, true, 'implement'), 'implement');
  assert.equal(runtimeTargetLane({}, false, 'implement'), 'implement');
});

test('TC-17: orphaned-dispatch matchForwardTransition: identical for every fixture lane, target and outcome', () => {
  for (const wf of Object.values(FIXTURES)) {
    const lanes = [...Object.keys(wf.lanes), 'backlog', 'Done', ' review '];
    for (const action of Object.keys(wf.lanes)) {
      for (const lane of lanes) {
        assert.equal(matchForwardTransition(action, lane, wf), legacyMatchForwardTransition(action, lane, wf), `${action} -> ${lane}`);
      }
    }
  }
  // And through the public function, with the 1117 bug-2 case (a clean forward advance is not an inconsistency).
  const r = classifyOrphanedDispatch({ laneStatus: 'queue', lane: 'review', action: 'in-progress', workflowConfig: FIXTURES.A });
  assert.equal(r.orphaned, true);
  assert.equal(r.status, 'done');
  const back = classifyOrphanedDispatch({ laneStatus: 'queue', lane: 'in-progress', action: 'review', workflowConfig: FIXTURES.A });
  assert.equal(back.status, 'failed', 'review failure goes back to in-progress: a handled failure');
  const odd = classifyOrphanedDispatch({ laneStatus: 'queue', lane: 'planning', action: 'review', workflowConfig: FIXTURES.A });
  assert.equal(odd.flagForHuman, true, 'not a legal destination: still flagged');
});

test('TC-17: resting-state: which lanes park at their own success is the same for every fixture', () => {
  for (const wf of Object.values(FIXTURES)) {
    const valid = deriveValidRestingStates(wf);
    for (const [lane, cfg] of Object.entries(wf.lanes)) {
      const expected = !cfg.on_success ? true : legacyRestingSelfParks(cfg.on_success, lane);
      assert.equal(valid.has(`${lane}:success`), expected, `${lane}:success`);
    }
  }
  const parks = (onSuccess, lane) => deriveValidRestingStates({ lanes: { [lane]: { on_success: onSuccess } } }).has(`${lane}:success`);
  // D5: an empty-lane target (':success') is read as the lane itself (the old `split(':')[0]` was '' and never matched).
  assert.equal(legacyRestingSelfParks(':success', 'plan'), false);
  assert.equal(parks(':success', 'plan'), true);
  // D6: case and spaces are ignored in the comparison.
  assert.equal(legacyRestingSelfParks('Plan:success', 'plan'), false);
  assert.equal(parks('Plan:success', 'plan'), true);
});

test('TC-17: daemon sites that were NOT patched are listed, so the owner can decide (they pass a raw target string as a lane)', () => {
  const sync = fs.readFileSync(path.join(HERE, '..', '..', 'conductor', 'laneconductor.sync.mjs'), 'utf8');
  // These two read `lanes.X.on_success` / `on_failure` and use the WHOLE string as a lane name; with `review:queue` that is not a lane.
  assert.match(sync, /intendedLane: workflowConfig\?\.lanes\?\.implement\?\.on_success \|\| 'quality-gate'/);
  assert.match(sync, /intendedLane: \(onFailure && onFailure !== 'stay'\) \? onFailure : lane_status/);
});
