// Phase 4: advice log, report_outcome, health_report, kill criteria.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, readFile, commitAll, addRemote, rm, INDEX } from './helpers/repo.mjs';
import { KINDS, lineProblems, parseBeta, parseLog } from '../src/advice-log.mjs';
import { KILL_CRITERIA, THRESHOLDS, evaluateKillCriteria } from '../src/kill-criteria.mjs';
import { computeHealth } from '../src/health.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const fixture = (opts) => {
  const dir = makeRepo(opts);
  cleanup.push(dir);
  return dir;
};
const open = async (dir, opts) => {
  const s = await connect(dir, opts);
  sessions.push(s);
  return s;
};
const T = (n, slug) => `conductor/tracks/AM-${n}-${slug}`;
const month = () => new Date().toISOString().slice(0, 7);
const LOG = () => `conductor/advice-log/${month()}.jsonl`;
const logLines = (dir) => parseLog(readFile(dir, LOG())).lines;
const verdicts = (r) => Object.fromEntries(r.env.data.kill_criteria.map((k) => [k.id, k]));

const NOW = Date.parse('2026-11-16T12:00:00Z');
const ts = (i) => new Date(Date.parse('2026-11-10T00:00:00Z') + i * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const L = (i, kind, fields) => ({ v: 1, ts: ts(i), kind, session: 'c_a', surface: 'claude-code', ...fields });
const seedLog = (dir, lines, file = '2026-11.jsonl') => writeFile(dir, `conductor/advice-log/${file}`, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

// TC-4.1
test('every call appends a call line, get_context lane appends a serve line, and all lines are valid v1 lines', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  commitAll(dir);
  const s = await open(dir, { clientName: 'claude-code-test' });
  await s.call('list_tracks');
  await s.call('get_track', { track: '1' });
  const g = await s.call('get_context', { lane: 'plan' });
  const lines = logLines(dir);
  assert.deepEqual(lines.filter((l) => l.kind === 'call').map((l) => l.tool), ['list_tracks', 'get_track', 'get_context']);
  const serves = lines.filter((l) => l.kind === 'serve');
  assert.equal(serves.length, 1);
  assert.equal(serves[0].id, g.env.data.lane_guide.serve_id);
  assert.equal(serves[0].item, 'lane:plan');
  assert.match(serves[0].source, /^bundled@|^repo:/);
  assert.match(serves[0].commit, /^[0-9a-f]{40}$/);
  for (const l of lines) {
    assert.deepEqual(lineProblems(l), [], JSON.stringify(l));
    assert.ok(KINDS.includes(l.kind));
    assert.equal(l.surface, 'claude-code-test');
    assert.match(l.session, /^c_[0-9a-f]{12}$/);
  }
  const call = lines.find((l) => l.kind === 'call');
  assert.equal(call.ok, true);
  assert.equal(call.backend, 'local');
  assert.ok(Number.isFinite(call.latency_ms) && call.chars > 0);
});

test('failures: CONFLICT is a conflict line (not a tool_error), other errors are tool_error with the code only; stale reads and empty results are logged', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  writeFile(dir, `${T(1, 'one')}/plan.md`, '# p\n');
  commitAll(dir);
  addRemote(dir);
  const s = await open(dir);
  const g = await s.call('get_track', { track: '1' });
  await s.call('update_track', { track: '1', base: g.env.data.base, files: { plan: '# p2\n' } }); // local commit ahead of origin
  await s.call('update_track', { track: '1', base: g.env.data.base, files: { plan: '# p3\n' } }); // stale base
  await s.call('get_track', { track: '4242' });
  await s.call('list_tracks', { query: 'no-such-thing' });
  const lines = logLines(dir);
  const conflict = lines.filter((l) => l.kind === 'conflict');
  assert.deepEqual(conflict.map((l) => [l.tool, l.code]), [['update_track', 'CONFLICT']]);
  assert.deepEqual(lines.filter((l) => l.kind === 'tool_error').map((l) => [l.tool, l.code]), [['get_track', 'TRACK_NOT_FOUND']]);
  assert.ok(lines.every((l) => l.kind !== 'tool_error' || !('message' in l)), 'error messages are not logged');
  const stale = lines.filter((l) => l.kind === 'stale_read');
  assert.ok(stale.some((l) => l.reasons.includes('unpushed_local_commits')), JSON.stringify(stale));
  assert.deepEqual(lines.filter((l) => l.kind === 'empty_result').map((l) => l.tool), ['list_tracks']);
});

// TC-4.2
test('log lines contain no file contents or error text: a sentinel in spec.md and in a bad argument never reaches the log', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  writeFile(dir, `${T(1, 'one')}/spec.md`, '# Spec\n\nSECRET_SENTINEL_123\n');
  commitAll(dir);
  const s = await open(dir);
  const g = await s.call('get_track', { track: '1' });
  assert.match(g.text, /SECRET_SENTINEL_123/, 'the sentinel is served to the caller');
  await s.call('get_track', { track: 'SECRET_SENTINEL_123' });
  await s.call('append_conversation', { track: '1', author: 'claude', body: '> **claude**: SECRET_SENTINEL_123' });
  await s.call('get_context', { lane: 'plan' });
  const raw = readFile(dir, LOG());
  assert.ok(raw.length > 100);
  assert.doesNotMatch(raw, /SECRET_SENTINEL_123/);
});

// TC-4.3
test('report_outcome: deviated and failed need a reason, followed does not; an unknown serve_id is recorded as an orphan with a warning', async () => {
  const dir = fixture();
  const s = await open(dir);
  const serve = (await s.call('get_context', { lane: 'plan' })).env.data.lane_guide.serve_id;
  const noReason = await s.call('report_outcome', { serve_id: serve, outcome: 'deviated' });
  assert.equal(noReason.env.error.code, 'VALIDATION_FAILED');
  assert.equal((await s.call('report_outcome', { serve_id: serve, outcome: 'failed', reason: '   ' })).env.error.code, 'VALIDATION_FAILED');
  assert.equal((await s.call('report_outcome', { serve_id: serve, outcome: 'deviated', reason: 'x'.repeat(501) })).env.error.code, 'VALIDATION_FAILED');
  assert.equal((await s.call('report_outcome', { serve_id: serve, outcome: 'followed', track: 'not a track' })).env.error.code, 'VALIDATION_FAILED');
  assert.equal(logLines(dir).filter((l) => l.kind === 'outcome').length, 0, 'rejected calls record nothing');

  const ok = await s.call('report_outcome', { serve_id: serve, outcome: 'deviated', reason: 'spec already\nexisted; refined it', track: 10110 });
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual(ok.env.data, { recorded: true });
  assert.deepEqual(ok.env.warnings, []);
  assert.equal((await s.call('report_outcome', { serve_id: serve, outcome: 'followed' })).isError, false);
  const orphan = await s.call('report_outcome', { serve_id: 's_nope', outcome: 'failed', reason: 'it broke' });
  assert.equal(orphan.isError, false);
  assert.equal(orphan.env.data.orphan, true);
  assert.ok(orphan.env.warnings.some((w) => /s_nope.*orphan/.test(w)));
  const out = logLines(dir).filter((l) => l.kind === 'outcome');
  assert.equal(out.length, 3);
  assert.deepEqual({ ...out[0], ts: 0, session: 0, surface: 0 }, { v: 1, ts: 0, kind: 'outcome', session: 0, surface: 0, serve_id: serve, outcome: 'deviated', reason: 'spec already existed; refined it', track: '10110' });
  assert.equal(out[1].reason, undefined);
  assert.equal(out[2].orphan, true);
});

// TC-4.4
test('local batching (D3-a): log lines appear in the working tree at once, no commit is made for them alone, and the next connector commit carries them', async () => {
  const dir = fixture();
  const s = await open(dir);
  const before = git(dir, 'rev-parse', 'HEAD');
  await s.call('list_tracks');
  await s.call('get_context');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), before, 'no commit for log lines alone');
  assert.equal(logLines(dir).filter((l) => l.kind === 'call').length, 2, 'lines are in the working tree immediately');
  assert.match(git(dir, 'status', '--porcelain'), /advice-log/);
  const r = await s.call('list_tracks');
  assert.deepEqual(r.env.provenance.dirty_paths, [], 'the log is not reported as uncommitted plan state');
  assert.ok(!r.env.provenance.stale_reasons.includes('dirty_state_files'));

  const c = await s.call('create_track', { title: 'Carry', problem: 'carry the log' });
  assert.equal(c.isError, false, c.text);
  const committed = git(dir, 'show', `HEAD:${LOG()}`);
  assert.equal(parseLog(committed).lines.filter((l) => l.kind === 'call').length, 3, 'the earlier lines rode along with the track commit');
  assert.ok(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').includes(LOG()));
  assert.equal(git(dir, 'rev-list', '--count', `${before}..HEAD`), '1');
});

test('a repo without conductor/tracks gets no advice-log directory', async () => {
  const dir = fixture({ files: {} });
  rm(path.join(dir, 'conductor'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'drop conductor');
  const s = await open(dir);
  assert.equal((await s.call('list_tracks')).env.error.code, 'NOT_A_LANECONDUCTOR_REPO');
  assert.equal(fs.existsSync(path.join(dir, 'conductor')), false);
});

// TC-4.5
test('health_report on a synthetic log: KC-2 6% breach with conflicts excluded, KC-3 75% insufficient (n=8) with the item flagged, KC-4 80%', async () => {
  const dir = fixture();
  const lines = [];
  let i = 0;
  const sessionOf = (n) => `c_${n % 3}`; // errors spread over sessions: no session has more than 3
  for (let n = 0; n < 100; n++) lines.push(L(i++, 'call', { tool: 'get_track', ok: true, latency_ms: n + 1, chars: 400, backend: 'local', session: sessionOf(n) }));
  for (let n = 0; n < 6; n++) lines.push(L(i++, 'tool_error', { tool: 'update_track', code: 'WRITE_FAILED', session: sessionOf(n) }));
  for (let n = 0; n < 2; n++) lines.push(L(i++, 'conflict', { tool: 'update_track', code: 'CONFLICT', session: sessionOf(n) }));
  for (let n = 0; n < 10; n++) lines.push(L(i++, 'serve', { id: `s_${n}`, tool: 'get_context', item: 'lane:plan', source: 'bundled@0.1.0', chars: 100 }));
  const reasons = ['spec already existed', 'spec already existed', 'Spec already existed ', 'too long', 'too long', 'no time'];
  reasons.forEach((r, n) => lines.push(L(i++, 'outcome', { serve_id: `s_${n}`, outcome: 'deviated', reason: r })));
  lines.push(L(i++, 'outcome', { serve_id: 's_6', outcome: 'followed' }), L(i++, 'outcome', { serve_id: 's_7', outcome: 'followed' }));
  seedLog(dir, lines);
  commitAll(dir);
  const s = await open(dir);
  const r = await s.call('health_report', { since: '2026-11-01' });
  assert.equal(r.isError, false, r.text);
  const kc = verdicts(r);
  assert.equal(kc['KC-2'].value, 6);
  assert.equal(kc['KC-2'].n, 100);
  assert.equal(kc['KC-2'].verdict, 'breach');
  assert.equal(r.env.data.connector.conflicts, 2);
  assert.equal(r.env.data.connector.counted_errors, 6);
  assert.equal(kc['KC-3'].value, 75);
  assert.equal(kc['KC-3'].n, 8);
  assert.equal(kc['KC-3'].verdict, 'insufficient_data');
  assert.match(kc['KC-3'].note, /lane:plan/);
  assert.equal(kc['KC-4'].value, 80);
  assert.equal(kc['KC-4'].verdict, 'ok');
  const item = r.env.data.items.find((x) => x.item === 'lane:plan');
  assert.deepEqual({ served: item.served, followed: item.followed, deviated: item.deviated, unreported: item.unreported, rate: item.override_rate, flagged: item.flagged }, { served: 10, followed: 2, deviated: 6, unreported: 2, rate: 0.75, flagged: true });
  assert.deepEqual(item.top_deviation_reasons, [{ reason: 'spec already existed', count: 3 }, { reason: 'too long', count: 2 }, { reason: 'no time', count: 1 }]);
  assert.deepEqual(r.env.data.connector.latency_ms, { p50: 50, p95: 95 });
  assert.match(r.text, /FLAGGED/);
  assert.match(r.text, /KC-2 BREACH/);
});

// TC-4.6
test('health_report with an empty log: nothing fails, every log-based criterion is insufficient_data, KC-8 is measured from the static tool list', async () => {
  const dir = fixture();
  const s = await open(dir);
  const r = await s.call('health_report');
  assert.equal(r.isError, false, r.text);
  assert.equal(r.env.data.connector.calls, 0);
  assert.deepEqual(r.env.data.items, []);
  const kc = verdicts(r);
  assert.deepEqual(Object.keys(kc), KILL_CRITERIA.map((k) => k.id));
  for (const id of ['KC-1', 'KC-2', 'KC-3', 'KC-4', 'KC-5', 'KC-6', 'KC-7']) assert.equal(kc[id].verdict, 'insufficient_data', id);
  assert.equal(r.env.data.window.source, 'default: last 30 days (no beta_start recorded)');
  assert.ok(Number.isInteger(kc['KC-8'].value) && kc['KC-8'].value > 0);
  assert.equal(kc['KC-8'].verdict, kc['KC-8'].value > THRESHOLDS.contextTokensMax ? 'breach' : 'ok');
  const j = await s.call('health_report', { format: 'json' });
  assert.doesNotMatch(j.text, /Kill criteria:/, 'json format carries no rendered report');
});

test('health_report: the window starts at beta_start, errors above 3 in one session breach KC-2 regardless of volume, a closed window with no remote sessions breaches KC-6', async () => {
  const dir = fixture();
  writeFile(dir, 'conductor/advice-log/beta.json', JSON.stringify({ beta_start: '2026-11-05T00:00:00Z', beta_end: '2026-11-12T00:00:00Z' }));
  const lines = [L(-500000, 'call', { tool: 'list_tracks', ok: true, latency_ms: 1, chars: 1, backend: 'local' })]; // before the window
  for (let n = 0; n < 4; n++) lines.push(L(n, 'tool_error', { tool: 'create_track', code: 'WRITE_FAILED', session: 'c_bad' }));
  for (let n = 4; n < 8; n++) lines.push(L(n, 'call', { tool: 'create_track', ok: false, latency_ms: 1, chars: 1, backend: 'local', session: 'c_bad' }));
  seedLog(dir, lines);
  const s = await open(dir);
  const r = await s.call('health_report');
  assert.equal(r.env.data.window.source, 'beta_start');
  assert.equal(r.env.data.window.since, '2026-11-05T00:00:00.000Z');
  assert.equal(r.env.data.window.until, '2026-11-12T00:00:00.000Z');
  assert.equal(r.env.data.window.closed, true);
  assert.equal(r.env.data.connector.calls, 4, 'the call before beta_start is outside the window');
  const kc = verdicts(r);
  assert.equal(kc['KC-2'].verdict, 'breach');
  assert.match(kc['KC-2'].note, /4 errors in one session/);
  assert.equal(kc['KC-6'].verdict, 'breach');
});

test('health_report: a malformed beta.json and log lines are reported as warnings, not failures', async () => {
  const dir = fixture();
  writeFile(dir, 'conductor/advice-log/beta.json', '{not json');
  seedLog(dir, [L(1, 'call', { tool: 'get_track', ok: true, latency_ms: 1, chars: 1, backend: 'local' })]);
  fs.appendFileSync(path.join(dir, 'conductor/advice-log/2026-11.jsonl'), 'garbage\n{"v":2}\n');
  const s = await open(dir);
  const r = await s.call('health_report', { since: '2026-11-01' });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.env.warnings.some((w) => /beta\.json.*not valid JSON/.test(w)));
  assert.ok(r.env.warnings.some((w) => /2 malformed/.test(w)));
  assert.equal((await s.call('health_report', { since: 'yesterday-ish' })).env.error.code, 'VALIDATION_FAILED');
});

test('health_report lists tracks needing attention from the summary lint', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'bad')}/index.md`, INDEX(1, 'Bad', { lane: 'nonsense' }));
  commitAll(dir);
  const s = await open(dir);
  const r = await s.call('health_report');
  assert.deepEqual(r.env.data.needs_attention.map((a) => a.folder), ['AM-1-bad']);
  assert.match(r.text, /Tracks needing attention:/);
});

test('kill criteria: thresholds as data, remote sessions and remote stale reads, KC-3 breach and warn, per-item flag boundary', () => {
  assert.deepEqual(KILL_CRITERIA.map((k) => k.id), ['KC-1', 'KC-2', 'KC-3', 'KC-4', 'KC-5', 'KC-6', 'KC-7', 'KC-8']);
  assert.deepEqual(THRESHOLDS, { errorRate: 0.05, errorMinCalls: 50, errorsPerSession: 3, overrideRate: 0.5, overrideMinOutcomes: 20, itemOverrideMinOutcomes: 5, coverageMin: 0.3, remoteSessionsMin: 3, staleReadRate: 0.25, contextTokensMax: 2000 });
  const base = { calls: 0, countedErrors: 0, worstSession: 0, serves: 0, servesReported: 0, followed: 0, deviated: 0, flaggedItems: [], remoteReads: 0, remoteStaleReads: 0, remoteSessions: 0, windowClosed: false, contextTokens: 100 };
  const v = (over) => Object.fromEntries(evaluateKillCriteria({ ...base, ...over }).map((k) => [k.id, k.verdict]));
  assert.equal(v({ calls: 50, countedErrors: 3 })['KC-2'], 'breach', '6% of 50 calls');
  assert.equal(v({ calls: 60, countedErrors: 3 })['KC-2'], 'ok', '5% exactly is not above the threshold');
  assert.equal(v({ calls: 60, countedErrors: 4 })['KC-2'], 'breach');
  assert.equal(v({ calls: 49, countedErrors: 49 })['KC-2'], 'insufficient_data');
  assert.equal(v({ followed: 10, deviated: 10 })['KC-3'], 'ok', '50% is not above 50%');
  assert.equal(v({ followed: 9, deviated: 11 })['KC-3'], 'breach');
  assert.equal(v({ followed: 19, deviated: 0 })['KC-3'], 'insufficient_data');
  assert.equal(v({ followed: 20, deviated: 0, flaggedItems: ['lane:plan'] })['KC-3'], 'warn');
  assert.equal(v({ serves: 10, servesReported: 3 })['KC-4'], 'ok', '30% is not below 30%');
  assert.equal(v({ serves: 10, servesReported: 2 })['KC-4'], 'breach');
  assert.equal(v({ remoteSessions: 3 })['KC-6'], 'ok');
  assert.equal(v({ remoteSessions: 2 })['KC-6'], 'insufficient_data');
  assert.equal(v({ remoteSessions: 2, windowClosed: true })['KC-6'], 'breach');
  assert.equal(v({ remoteReads: 4, remoteStaleReads: 1 })['KC-7'], 'ok', '25% is not above 25%');
  assert.equal(v({ remoteReads: 3, remoteStaleReads: 1 })['KC-7'], 'breach');
  assert.equal(v({ contextTokens: 2000 })['KC-8'], 'ok');
  assert.equal(v({ contextTokens: 2001 })['KC-8'], 'breach');
});

test('computeHealth: remote reads and sessions come from backend=github lines; outcomes for unknown serves land under (orphan)', () => {
  const lines = [
    L(1, 'call', { tool: 'get_track', ok: true, latency_ms: 5, chars: 4, backend: 'github', session: 'r1' }),
    L(2, 'call', { tool: 'list_tracks', ok: true, latency_ms: 5, chars: 4, backend: 'github', session: 'r2' }),
    L(3, 'call', { tool: 'get_track', ok: true, latency_ms: 5, chars: 4, backend: 'local', session: 'l1' }),
    L(4, 'stale_read', { tool: 'get_track', reasons: ['behind_upstream'], backend: 'github' }),
    L(5, 'outcome', { serve_id: 'gone', outcome: 'deviated', reason: 'r', orphan: true }),
  ];
  const h = computeHealth(lines, { sinceMs: Date.parse('2026-11-01'), untilMs: NOW, windowClosed: false, contextTokens: 10 });
  const kc = Object.fromEntries(h.kill_criteria.map((k) => [k.id, k]));
  assert.equal(kc['KC-7'].n, 2);
  assert.equal(kc['KC-7'].value, 50);
  assert.equal(kc['KC-7'].verdict, 'breach');
  assert.equal(kc['KC-6'].value, 2);
  assert.equal(h.items[0].item, '(orphan)');
});

test('parseBeta: valid, absent, bad JSON, bad times and an end before the start', () => {
  assert.deepEqual(parseBeta(null), { start: null, end: null, problems: [] });
  assert.deepEqual(parseBeta('{"beta_start":"2026-11-05T00:00:00Z","beta_end":null}'), { start: Date.parse('2026-11-05T00:00:00Z'), end: null, problems: [] });
  assert.equal(parseBeta('{').problems.length, 1);
  assert.match(parseBeta('{"beta_start":"soon"}').problems[0], /beta_start is not an ISO time/);
  assert.match(parseBeta('{"beta_start":"2026-11-05","beta_end":"2026-11-01"}').problems[0], /before/);
});
