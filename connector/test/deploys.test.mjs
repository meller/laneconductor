// Track AM-10156: deployment in the plugin. The logic behind the base `deploy` text (records, status, history, rollback, release notes),
// worked out from synthetic records and the values a session reads (local build version, the live version, the commit count). The base plugin
// has no script, so the text describes this same algorithm; the board's Deployment tab uses this module too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordFileName, parseRecord, lintRecord, secretHits, parseRecords, liveRecord, historyOf, envConfig,
  compareStatus, rollbackPlan, finishedAt, shippedSince, REQUIRED_KEYS,
} from '../src/deploys.mjs';

const T = (day, hm = '10:00') => `2026-11-${day}T${hm}:00Z`;
/** One record as the base `deploy` text tells Claude to write it. */
function rec(o) {
  const lines = [`# Deploy ${o.env} ${o.time}`, '',
    `environment: ${o.env}`, `time: ${o.time}`, `commit: ${o.commit}`, `build version: ${o.version}`,
    `command: ${o.command ?? 'firebase deploy --only hosting --project demo-site'}`, `result: ${o.result ?? 'success'}`,
    `log: conductor/logs/deploy-${o.env}-${o.time.replace(/[-:]/g, '')}.log`, `approved by: ${o.by ?? 'the owner'}`,
    `previous good record: ${o.prev ?? 'none'}`];
  if (o.kind) lines.push(`kind: ${o.kind}`);
  if (o.restored) lines.push(`restored record: ${o.restored}`);
  if (o.production) lines.push('production: yes');
  return { name: recordFileName(o.env, o.time), text: `${lines.join('\n')}\n` };
}
const R1 = { env: 'prod', time: T('20'), commit: 'aaaaaaa', version: '1.0.0', production: true, by: 'ana' };
const R2 = { env: 'prod', time: T('21'), commit: 'bbbbbbb', version: '1.1.0', prev: recordFileName('prod', R1.time), production: true, by: 'ana' };
const R3 = { env: 'prod', time: T('22'), commit: 'ccccccc', version: '1.2.0', result: 'failed', prev: recordFileName('prod', R2.time), production: true, by: 'ben' };
const S1 = { env: 'staging', time: T('21', '08:00'), commit: 'bbbbbbb', version: '1.1.0', by: 'ana' };
const files = (...os) => os.map(rec);

// ---- TC-1: the record format --------------------------------------------------------------------------------------------------------

test('record: the file name is <env>-<UTC timestamp>.md and the header parses back to every field of REQ-1', () => {
  assert.equal(recordFileName('prod', '2026-11-22T10:15:00Z'), 'prod-20261122T101500Z.md');
  const r = parseRecord(rec(R1).text, 'prod-20261120T100000Z.md');
  assert.deepEqual(REQUIRED_KEYS, ['environment', 'time', 'commit', 'build version', 'command', 'result', 'log', 'approved by', 'previous good record']);
  assert.deepEqual(
    [r.env, r.time, r.commit, r.version, r.command, r.result, r.log, r.approvedBy, r.previous, r.kind, r.production],
    ['prod', T('20'), 'aaaaaaa', '1.0.0', 'firebase deploy --only hosting --project demo-site', 'success', 'conductor/logs/deploy-prod-20261120T100000Z.log', 'ana', 'none', 'deploy', true]);
  assert.equal(r.good, true);
  const failed = parseRecord(rec(R3).text, 'x.md');
  assert.equal(failed.good, false);
  const rb = parseRecord(rec({ ...R1, time: T('23'), kind: 'rollback', restored: 'prod-20261120T100000Z.md' }).text, 'x.md');
  assert.deepEqual([rb.kind, rb.restored], ['rollback', 'prod-20261120T100000Z.md']);
});

test('record: lint accepts a good record and refuses a missing field, an unknown result, a token-shaped value and a secret in the command', () => {
  assert.deepEqual(lintRecord(rec(R1).text).problems, []);
  assert.equal(lintRecord(rec(R1).text).ok, true);
  const bad = (text, re) => { const l = lintRecord(text); assert.equal(l.ok, false); assert.match(l.problems.join(' | '), re); };
  bad(rec(R1).text.replace(/^commit: .*\n/m, ''), /missing commit/);
  bad(rec(R1).text.replace('result: success', 'result: maybe'), /result/);
  bad(rec(R1).text.replace('build version: 1.0.0', 'build version: ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789'), /secret/);
  bad(rec({ ...R1, command: 'FIREBASE_TOKEN=1//0gAbCdEfGhIjKlMnOpQr firebase deploy' }).text, /secret/);
  bad(rec({ ...R1, command: 'firebase deploy --token abcdefghijklmnop1234' }).text, /secret/);
  assert.ok(secretHits('command: sk_' + 'live_' + 'abcdefghijklmnop1234567890').length >= 1);
  assert.deepEqual(secretHits(rec(R1).text), [], 'a full commit sha, a timestamp and a command are not secrets');
  assert.deepEqual(secretHits(`${rec(R1).text}commit: 3f5a9c1d7e2b4a6f8c0d1e2f3a4b5c6d7e8f9a0b\n`), []);
});

// ---- TC-8: deploy.json keys -----------------------------------------------------------------------------------------------------------

test('deploy.json: the optional keys rollback, service, version and liveVersionUrl are read; without them the defaults apply', () => {
  const cfg = JSON.stringify({ defaultEnvironment: 'prod', environments: {
    prod: { command: 'bash infra/deploy.sh prod', rollback: 'gcloud run services update-traffic {service} --to-revisions={version}=100', service: 'demo-prod', version: 'node -p "require(\'./package.json\').version"', liveVersionUrl: 'https://example.com/version.json' },
    staging: { command: 'bash infra/deploy.sh staging' },
  } });
  const p = envConfig(cfg, 'prod');
  assert.deepEqual([p.command, p.rollback, p.service, p.liveVersionUrl, p.production], ['bash infra/deploy.sh prod', 'gcloud run services update-traffic {service} --to-revisions={version}=100', 'demo-prod', 'https://example.com/version.json', true]);
  assert.match(p.version, /package\.json/);
  const s = envConfig(cfg, 'staging');
  assert.deepEqual([s.rollback, s.service, s.version, s.liveVersionUrl, s.production], [null, null, null, null, false]);
  assert.equal(envConfig(cfg, undefined).env, 'prod', 'the default environment');
  assert.equal(envConfig(cfg, 'nope'), null);
  assert.equal(envConfig('not json', 'prod'), null);
  assert.equal(envConfig(JSON.stringify({ environments: { prod: { command: 'x' } } }), undefined).env, 'prod', 'with no default environment, prod');
});

test('rollback strategy: with a rollback command it is shown (placeholders filled); without it the default is the chosen commit from a clean checkout', () => {
  const records = parseRecords(files(R1, R2));
  const base = { command: 'bash deploy.sh', env: 'prod', production: true, rollback: null, service: null, version: null, liveVersionUrl: null };
  const dflt = rollbackPlan({ records, config: base, env: 'prod', version: '1.0.0' });
  assert.equal(dflt.action, 'plan');
  assert.equal(dflt.strategy, 'redeploy');
  assert.equal(dflt.target.commit, 'aaaaaaa');
  assert.match(dflt.steps[0], /git worktree add --detach \S+ aaaaaaa/);
  assert.ok(dflt.steps.some((s) => s.includes('bash deploy.sh')), 'the deploy command runs in the clean checkout');
  assert.match(dflt.steps.at(-1), /git worktree remove/);
  const custom = rollbackPlan({ records, config: { ...base, rollback: 'tool back {service} {version} {commit}', service: 'svc' }, env: 'prod', version: '1.0.0' });
  assert.equal(custom.strategy, 'command');
  assert.deepEqual(custom.steps, ['tool back svc 1.0.0 aaaaaaa']);
  const noService = rollbackPlan({ records, config: { ...base, rollback: 'tool back {service}' }, env: 'prod', version: '1.0.0' });
  assert.equal(noService.action, 'refused');
  assert.match(noService.reason, /service/);
  for (const p of [dflt, custom]) for (const s of p.steps) assert.ok(!/git reset|push (-f|--force)|--hard/.test(s), `no reset or force push in ${s}`);
});

// ---- TC-2: live version, age and commits ahead from the records alone -----------------------------------------------------------------------

test('records: two environments each give their own live (newest good) record; a failed run is not live', () => {
  const records = parseRecords(files(R2, S1, R1, R3)); // out of order on purpose
  assert.deepEqual(records.map((r) => r.file), [R1, S1, R2, R3].sort((a, b) => a.time.localeCompare(b.time)).map((r) => recordFileName(r.env, r.time)));
  assert.equal(liveRecord(records, 'prod').version, '1.1.0', 'the failed 1.2.0 run is newer but not live');
  assert.equal(liveRecord(records, 'staging').version, '1.1.0');
  assert.equal(liveRecord(records, 'qa'), null);
});

test('status from records alone: last record, its age, and commits ahead as given', () => {
  const records = parseRecords(files(R1, R2, S1));
  const s = compareStatus({ env: 'prod', records, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: null, ahead: 0, now: T('24', '10:00') });
  assert.equal(s.last.version, '1.1.0');
  assert.equal(s.last.ageDays, 3);
  assert.equal(s.state, 'in-sync');
  const none = compareStatus({ env: 'qa', records, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: null, ahead: null, now: T('24') });
  assert.equal(none.state, 'no-record');
  assert.match(none.lines.join('\n'), /no deploy recorded for qa/i);
});

// ---- TC-11: in sync, ahead, drift, not checked ---------------------------------------------------------------------------------------------

test('status: in sync, local ahead by N commits, drift, and live not checked', () => {
  const records = parseRecords(files(R1, R2));
  const base = { env: 'prod', records, now: T('22') };
  const sync = compareStatus({ ...base, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: { version: '1.1.0' }, ahead: 0 });
  assert.equal(sync.state, 'in-sync');
  assert.match(sync.lines.join('\n'), /in sync/i);
  assert.equal(sync.live.checked, true);
  const ahead = compareStatus({ ...base, local: { version: '1.2.0', commit: 'ddddddd' }, live: { version: '1.1.0' }, ahead: 3 });
  assert.equal(ahead.state, 'ahead');
  assert.match(ahead.lines.join('\n'), /local copy is ahead of the last deploy by 3 commits/);
  const one = compareStatus({ ...base, local: { version: '1.1.1', commit: 'ddddddd' }, live: { version: '1.1.0' }, ahead: 1 });
  assert.match(one.lines.join('\n'), /by 1 commit\b/);
  const drift = compareStatus({ ...base, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: { version: '0.9.0' }, ahead: 0 });
  assert.equal(drift.state, 'drift');
  assert.match(drift.lines.join('\n'), /drift: the live version 0\.9\.0 differs from the recorded 1\.1\.0/i);
  assert.match(drift.lines.join('\n'), /outside the records/);
  const driftWinsOverAhead = compareStatus({ ...base, local: { version: '1.2.0', commit: 'ddddddd' }, live: { version: '0.9.0' }, ahead: 2 });
  assert.equal(driftWinsOverAhead.state, 'drift');
  // no liveVersionUrl: never "in sync" by the live server; it says so
  const unchecked = compareStatus({ ...base, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: null, ahead: 0 });
  assert.equal(unchecked.live.checked, false);
  assert.match(unchecked.lines.join('\n'), /live version is not checked/);
  assert.match(unchecked.lines.join('\n'), /matches the last record/, 'the verdict says what it compared, not that the live server agrees');
  assert.ok(!/in sync with the live/.test(unchecked.lines.join('\n')));
  // the live read failed
  const failedRead = compareStatus({ ...base, local: { version: '1.1.0', commit: 'bbbbbbb' }, live: { error: 'could not be reached' }, ahead: 0 });
  assert.equal(failedRead.live.checked, false);
  assert.match(failedRead.lines.join('\n'), /live version is not checked: could not be reached/);
  // the local version differs with no new commit (a version bump not committed): named, not silently in sync
  const dirty = compareStatus({ ...base, local: { version: '1.1.1', commit: 'bbbbbbb' }, live: null, ahead: 0 });
  assert.equal(dirty.state, 'ahead');
  assert.match(dirty.lines.join('\n'), /local build version 1\.1\.1 differs from the recorded 1\.1\.0/);
  // the newest run failed after the last good one
  const failedNewest = compareStatus({ ...base, records: parseRecords(files(R1, R2, R3)), local: { version: '1.2.0', commit: 'ccccccc' }, live: null, ahead: 1 });
  assert.match(failedNewest.lines.join('\n'), /newest run \(1\.2\.0\) failed/);
});

// ---- TC-9: history ----------------------------------------------------------------------------------------------------------------------------

test('history: versions newest first with time, version, commit, result, who and which is live; a rollback is an entry too', () => {
  const rb = { env: 'prod', time: T('23'), commit: 'aaaaaaa', version: '1.0.0', kind: 'rollback', restored: recordFileName('prod', R1.time), by: 'ana', prev: recordFileName('prod', R2.time) };
  const records = parseRecords(files(R1, R2, R3, rb, S1));
  const h = historyOf(records, 'prod');
  assert.deepEqual(h.map((e) => e.version), ['1.0.0', '1.2.0', '1.1.0', '1.0.0']);
  assert.deepEqual(h.map((e) => e.kind), ['rollback', 'deploy', 'deploy', 'deploy']);
  assert.deepEqual(h.map((e) => e.result), ['success', 'failed', 'success', 'success']);
  assert.deepEqual(h.map((e) => e.live), [true, false, false, false], 'only the newest good entry is live');
  assert.deepEqual(h[0], { file: recordFileName('prod', rb.time), time: rb.time, version: '1.0.0', commit: 'aaaaaaa', result: 'success', approvedBy: 'ana', kind: 'rollback', live: true, production: false });
  assert.equal(h.find((e) => e.version === '1.2.0').approvedBy, 'ben');
  assert.deepEqual(historyOf(records, 'staging').map((e) => e.version), ['1.1.0']);
  assert.deepEqual(historyOf(records, 'qa'), []);
  assert.equal(liveRecord(records, 'prod').version, '1.0.0', 'after the rollback the rolled-back-to version is live');
});

// ---- TC-10: rollback chooses the version ------------------------------------------------------------------------------------------------------

test('rollback: with a version it goes to that version\'s record and shows the exact command; the yes names environment, version and command', () => {
  const records = parseRecords(files(R1, R2, R3));
  const config = { env: 'prod', command: 'bash deploy.sh prod', production: true, rollback: null, service: null, version: null, liveVersionUrl: null };
  const plan = rollbackPlan({ records, config, env: 'prod', version: '1.0.0' });
  assert.equal(plan.action, 'plan');
  assert.equal(plan.target.file, recordFileName('prod', R1.time), 'any good record, not only the previous one');
  assert.equal(plan.alreadyLive, false);
  assert.equal(plan.production, true);
  assert.match(plan.yes, /^yes, roll back prod to 1\.0\.0 with /);
  assert.ok(plan.yes.includes(plan.command), 'the yes names the command it covers');
  assert.equal(plan.command, plan.steps.join(' && '));
  // by commit prefix and by record file name
  assert.equal(rollbackPlan({ records, config, env: 'prod', version: 'aaaaaaa' }).target.version, '1.0.0');
  assert.equal(rollbackPlan({ records, config, env: 'prod', version: recordFileName('prod', R2.time) }).target.version, '1.1.0');
  // the live version: nothing to do
  assert.equal(rollbackPlan({ records, config, env: 'prod', version: '1.1.0' }).alreadyLive, true);
  // a failed run is not a version to go back to; an unknown one is refused and the known versions are named
  const failed = rollbackPlan({ records, config, env: 'prod', version: '1.2.0' });
  assert.equal(failed.action, 'refused');
  assert.match(failed.reason, /no good record of version 1\.2\.0/);
  assert.deepEqual(failed.versions.map((v) => v.version), ['1.1.0', '1.0.0']);
  assert.equal(rollbackPlan({ records, config, env: 'prod', version: '9.9.9' }).action, 'refused');
});

test('rollback: with no version it lists the good versions newest first and asks which', () => {
  const records = parseRecords(files(R1, R2, R3));
  const config = { env: 'prod', command: 'bash deploy.sh prod', production: true, rollback: null, service: null, version: null, liveVersionUrl: null };
  const list = rollbackPlan({ records, config, env: 'prod' });
  assert.equal(list.action, 'list');
  assert.deepEqual(list.versions.map((v) => [v.version, v.live]), [['1.1.0', true], ['1.0.0', false]]);
  assert.match(list.question, /which version/i);
  assert.equal(rollbackPlan({ records: [], config, env: 'prod' }).action, 'refused', 'nothing recorded: nothing to go back to');
  assert.equal(rollbackPlan({ records, config: null, env: 'nope', version: '1.0.0' }).action, 'refused', 'an environment deploy.json does not name');
});

test('rollback: a secret-shaped command is refused rather than shown', () => {
  const records = parseRecords(files(R1, R2));
  const config = { env: 'prod', command: 'FIREBASE_TOKEN=1//0gAbCdEfGhIjKlMnOpQr firebase deploy', production: true, rollback: null, service: null, version: null, liveVersionUrl: null };
  const p = rollbackPlan({ records, config, env: 'prod', version: '1.0.0' });
  assert.equal(p.action, 'refused');
  assert.match(p.reason, /secret/);
});

// ---- TC-5: release notes -----------------------------------------------------------------------------------------------------------------------

test('release notes: exactly the tracks finished since the previous good record, from their history', () => {
  assert.equal(finishedAt('# History\n\n- 2026-11-20 ✅ Plan complete\n- 2026-11-22 14:05Z ✅ Merged\n'), Date.parse('2026-11-22T14:05:00Z'));
  assert.equal(finishedAt('- 2026-11-21 ✅ Merged\n'), Date.parse('2026-11-21T23:59:59Z'), 'a date alone counts to the end of that day');
  assert.equal(finishedAt('no dates here'), null);
  const tr = (number, title, lane, history) => ({ number, id: `AM-${number}`, title, lane, history });
  const tracks = [
    tr(1, 'Before', 'done', '- 2026-11-19 ✅ Merged\n'),
    tr(2, 'Shipped A', 'done', '- 2026-11-20 ✅ Plan\n- 2026-11-22 09:00Z ✅ Merged\n'),
    tr(3, 'Shipped B', 'done', '- 2026-11-23 ✅ Merged\n'),
    tr(4, 'Still going', 'implement', '- 2026-11-23 ℹ️ started\n'),
    tr(5, 'Undated', 'done', '# History\n'),
    tr(6, 'Same moment as the deploy', 'done', '- 2026-11-21 10:00Z ✅ Merged\n'),
  ];
  const n = shippedSince({ tracks, since: T('21') });
  assert.deepEqual(n.tracks.map((x) => x.number), [2, 3], 'only done tracks finished after the record, oldest first; the record\'s own minute is not after it');
  assert.deepEqual(n.undated.map((x) => x.number), [5]);
  assert.match(n.markdown, /^## Shipped since the last deploy/);
  assert.match(n.markdown, /- AM-2: Shipped A \(2026-11-22\)/);
  assert.match(n.markdown, /- AM-3: Shipped B \(2026-11-23\)/);
  assert.ok(!/Before|Still going/.test(n.markdown));
  assert.match(n.markdown, /not placed in time \(no dated history line\): AM-5/);
  const first = shippedSince({ tracks, since: null });
  assert.equal(first.tracks.length, 4, 'no earlier good record: every finished track with a date');
  assert.match(shippedSince({ tracks: [], since: T('21') }).markdown, /Nothing finished since/);
});
