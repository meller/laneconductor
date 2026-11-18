// Track AM-10147 (owner steps), Phases 2: the three markers (`Owner Action`, `Owner Action Due`, `Result`), the date rules, the computed flags
// (`overdue`, `ready_to_measure`) and the advisory lints (`date_malformed`, `outcome_missing`). TC-1 to TC-7 of test.md. The clock is always passed in.
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LocalGitStore } from '../src/store-local.mjs';
import { createContext } from '../src/server.mjs';
import { runTool, MAX_TEXT_CHARS } from '../src/envelope.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { listTracks } from '../src/tools/list-tracks.mjs';
import { getTrack } from '../src/tools/get-track.mjs';
import { updateTrack } from '../src/tools/update-track.mjs';
import { dependencyState } from '../src/dependencies.mjs';
import { getMarker, parseMarkers, removeMarker, setMarker, repairIndex } from '../src/markers.mjs';
import { blobSha } from '../src/blob.mjs';
import { SUMMARY_PATH, checkSummary, generateSummary, lintTracks, rowOf } from '../src/summary.mjs';
import { dateProblems, hasKpiBlock, ownerFlags, parseCheckAfter, parseDay, todayOf } from '../src/owner-steps.mjs';
import { makeRepo, git, readFile, rm } from './helpers/repo.mjs';

const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const NOW = Date.parse('2026-11-18T12:00:00Z');
const cleanup = [];
after(() => rm(...cleanup));

const idx = (n, markers, body = '') => `# Track AM-${n}: Track ${n}\n\n${Object.entries({ Lane: 'plan', 'Lane Status': 'queue', Progress: '0%', ...markers }).map(([k, v]) => `**${k}**: ${v}`).join('\n')}\n${body}`;
const entry = (n, markers, spec) => {
  const content = idx(n, markers);
  return { folder: `AM-${n}-t${n}`, index: { content, sha: blobSha(content) }, ...(spec === undefined ? {} : { spec: { content: spec, sha: blobSha(spec) } }) };
};
const row = (markers) => rowOf('AM-1-t', { content: idx(1, markers) });
const KPI = '# Spec\n\n## KPI\n\n- Target: 10\n';

async function open(files, now = NOW) {
  const dir = makeRepo({ files });
  cleanup.push(dir);
  const store = new LocalGitStore({ repo: dir });
  const ctx = createContext({ stores: [store], version: 'test', now: () => now });
  const call = async (def, args) => { const r = await runTool(def, ctx, args); return { r, env: r.structuredContent, data: r.structuredContent.data, warnings: r.structuredContent.warnings }; };
  return { dir, store, ctx, call };
}
const folderOf = (n) => `conductor/tracks/AM-${n}-t${n}`;
const trackFiles = (n, markers, spec) => ({ [`${folderOf(n)}/index.md`]: idx(n, markers), ...(spec === undefined ? {} : { [`${folderOf(n)}/spec.md`]: spec }) });

// ---- TC-1, TC-2: the markers are read like the others ----

test('TC-1: a track with none of the new markers has none of the new fields', () => {
  const r = row({ 'Lane Status': 'waiting', 'Waiting Reason': 'a question' });
  for (const k of ['owner_action', 'owner_action_due', 'result', 'kpi_check_after']) assert.ok(!(k in r), k);
  assert.deepEqual(ownerFlags(r, NOW), {});
  assert.deepEqual(dateProblems(r), []);
});

test('TC-2: names are read case-insensitively (a hand-typed name too), CRLF files read like LF files, the first match wins', () => {
  const body = '**owner action**: Post the video\n**OWNER ACTION DUE**: 2026-11-20\n**result**: killed: no replies\n**kpi check after**: 2026-11-25\n';
  for (const eol of ['\n', '\r\n']) {
    const content = `# Track AM-1: T${eol}${eol}**Lane**: plan${eol}**Lane Status**: waiting${eol}${body.replace(/\n/g, eol)}`;
    const r = rowOf('AM-1-t', { content });
    assert.equal(r.owner_action, 'Post the video');
    assert.equal(r.owner_action_due, '2026-11-20', `no stray CR in the date (${JSON.stringify(eol)})`);
    assert.equal(r.result, 'killed: no replies');
    assert.equal(r.kpi_check_after, '2026-11-25');
    assert.equal(getMarker(content, 'Owner Action'), 'Post the video');
  }
  const twice = row({ 'Owner Action': 'first', 'Lane Status': 'waiting' }).owner_action;
  assert.equal(twice, 'first');
  const dup = `${idx(1, { 'Owner Action': 'first' })}**owner action**: second\n`;
  assert.equal(rowOf('AM-1-t', { content: dup }).owner_action, 'first', 'first match wins');
  // Writes put the canonical spelling back; the repair respells a hand-typed name.
  assert.match(setMarker('# Track AM-1: T\n\n**Lane**: plan\n**owner action due**: 2026-11-20\n', 'Owner Action Due', '2026-12-01'), /^\*\*Owner Action Due\*\*: 2026-12-01$/m);
  assert.match(repairIndex('# Track AM-1: T\n\n**Lane**: plan\n**owner action**: x\n**result**: y\n'), /\*\*Owner Action\*\*: x\n\*\*Result\*\*: y/);
});

test('TC-2: update_track sets and removes the three markers; a value over 200 characters is shortened in listings, the full text is in get_track', async () => {
  const { call, dir } = await open(trackFiles(5, { 'Lane Status': 'waiting', 'Waiting Reason': 'x' }));
  const long = `Record the demo video and ${'post it in the group '.repeat(14)}`.trim();
  assert.ok(long.length > 250);
  const t0 = await call(getTrack, { track: 5 });
  const set = await call(updateTrack, { track: 5, base: t0.data.base, markers: { 'Owner Action': long, 'Owner Action Due': '2026-11-20', Result: 'in progress' } });
  assert.equal(set.env.ok, true, JSON.stringify(set.env.error));
  const content = readFile(dir, `${folderOf(5)}/index.md`);
  assert.match(content, /^\*\*Owner Action\*\*: Record the demo/m);
  const l = (await call(listTracks, {})).data.tracks.find((t) => t.number === 5);
  assert.equal(l.owner_action.length, 201, 'shortened to 200 characters and an ellipsis');
  assert.ok(l.owner_action.endsWith('…'));
  assert.equal(l.owner_action_due, '2026-11-20');
  assert.equal(l.result, 'in progress');
  assert.ok(!('kpi_check_after' in l), 'the run-window helper field is not part of the listing');
  const g = (await call(getTrack, { track: 5 })).data.track;
  assert.equal(g.owner_action, long, 'get_track has the full text');
  assert.equal(g.owner_action_due, '2026-11-20');
  const t1 = await call(getTrack, { track: 5 });
  const cleared = await call(updateTrack, { track: 5, base: t1.data.base, markers: { 'Owner Action': null, 'Owner Action Due': null, Result: null } });
  assert.equal(cleared.env.ok, true);
  assert.ok(!/Owner Action|Result/.test(readFile(dir, `${folderOf(5)}/index.md`)));
  const after = (await call(listTracks, {})).data.tracks.find((t) => t.number === 5);
  for (const k of ['owner_action', 'owner_action_due', 'result', 'overdue']) assert.ok(!(k in after), `${k} is omitted when unset`);
  // A multi-line value is refused on write (the existing rule).
  const t2 = await call(getTrack, { track: 5 });
  assert.equal((await call(updateTrack, { track: 5, base: t2.data.base, markers: { 'Owner Action': 'a\nb' } })).env.ok, false);
});

// ---- TC-3, TC-4: the dates ----

test('TC-4: strict days: a real YYYY-MM-DD and nothing else', () => {
  assert.equal(parseDay('2026-11-20'), '2026-11-20');
  assert.equal(parseDay('2028-02-29'), '2028-02-29', 'a leap day');
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '', '2026-1-5', '2026-11-20T09:00:00Z', '2026-11-20 ', ' 2026-11-20', '2026-11-20\r', '20261120', '0000-01-01', 'tomorrow', undefined, null]) {
    assert.equal(parseDay(bad), null, JSON.stringify(bad));
  }
});

test('TC-4: KPI Check After is a day or a full UTC timestamp (what the quality gate has written), nothing looser', () => {
  assert.deepEqual(parseCheckAfter('2026-11-25'), { day: '2026-11-25' });
  assert.equal(parseCheckAfter('2026-11-25T09:30:00Z').at, Date.parse('2026-11-25T09:30:00Z'));
  assert.equal(parseCheckAfter('2026-11-25T09:30:00.123Z').at, Date.parse('2026-11-25T09:30:00.123Z'), 'what Date.toISOString writes');
  assert.equal(parseCheckAfter('2026-11-25T09:30Z').at, Date.parse('2026-11-25T09:30:00Z'));
  for (const bad of ['2026-11-25T24:00:00Z', '2026-11-25T09:60:00Z', '2026-02-30T09:00:00Z', '2026-11-25T09:30:00+02:00', '2026-11-25 09:30', '2026-11-25T09:30:00', '2026-11-25T09:30:00Z ', '', 'next week']) {
    assert.equal(parseCheckAfter(bad), null, JSON.stringify(bad));
  }
});

test('TC-3, TC-4: date_malformed names the marker and the value as written, never a guess, and sets no flag', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '', '2026-1-5', '2026-11-20T09:00:00Z', '2026-11-20 ']) {
    const r = row({ 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': bad });
    assert.deepEqual(dateProblems(r), [{ marker: 'Owner Action Due', value: bad }], JSON.stringify(bad));
    assert.deepEqual(ownerFlags(r, NOW), {}, `no flag for ${JSON.stringify(bad)}`);
    const [problem] = lintTracks([entry(1, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': bad })], [r], LANES)[0].problems;
    assert.match(problem, /^date_malformed: Owner Action Due /);
    assert.ok(problem.includes(JSON.stringify(bad)), `the value as written is in the warning: ${problem}`);
  }
  const k = row({ 'Lane Status': 'waiting', 'Waiting Reason': 'x', 'KPI Check After': '25/11/2026' });
  assert.deepEqual(dateProblems(k), [{ marker: 'KPI Check After', value: '25/11/2026' }]);
  assert.deepEqual(ownerFlags(k, NOW), {});
});

test('TC-3, TC-4: overdue and ready_to_measure with a fixed clock: the boundaries', () => {
  const w = (extra, status = 'waiting') => row({ 'Lane Status': status, ...extra });
  const due = (d, more = {}, status) => ownerFlags(w({ 'Owner Action': 'Post it', 'Owner Action Due': d, ...more }, status), NOW);
  assert.deepEqual(due('2026-11-17'), { overdue: true });
  assert.deepEqual(due('2026-11-18'), {}, 'due today is not overdue');
  assert.deepEqual(due('2026-11-19'), {});
  assert.deepEqual(due('2026-11-17', {}, 'queue'), {}, 'a due date on a track that is not waiting sets neither flag');
  assert.deepEqual(due('2026-11-17', {}, 'running'), {});
  assert.deepEqual(ownerFlags(w({ 'Owner Action Due': '2026-11-01' }), NOW), {}, 'a due date without an Owner Action is reported (the field is there), not flagged');
  assert.equal(w({ 'Owner Action Due': '2026-11-01' }).owner_action_due, '2026-11-01');
  const check = (v, status) => ownerFlags(w({ 'KPI Check After': v }, status), NOW);
  assert.deepEqual(check('2026-11-18'), { ready_to_measure: true }, 'today is ready');
  assert.deepEqual(check('2026-11-17'), { ready_to_measure: true });
  assert.deepEqual(check('2026-11-19'), {});
  assert.deepEqual(check('2026-11-18T11:59:59Z'), { ready_to_measure: true });
  assert.deepEqual(check('2026-11-18T12:00:00Z'), { ready_to_measure: true }, 'a timestamp that is now is ready');
  assert.deepEqual(check('2026-11-18T12:00:01Z'), {}, 'a timestamp later today is not ready yet');
  assert.deepEqual(check('2026-11-17', 'queue'), {}, 'not waiting: no flag');
  assert.deepEqual(check('2026-11-17', 'success'), {});
  // UTC midnight: the same due day flips at 00:00:00.000Z, not at local midnight.
  const r = w({ 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-18' });
  assert.deepEqual(ownerFlags(r, Date.parse('2026-11-18T23:59:59.999Z')), {});
  assert.deepEqual(ownerFlags(r, Date.parse('2026-11-19T00:00:00.000Z')), { overdue: true });
  assert.equal(todayOf(Date.parse('2026-11-18T23:59:59.999Z')), '2026-11-18');
  assert.equal(todayOf(Date.parse('2026-11-19T00:00:00.000Z')), '2026-11-19');
});

test('TC-3: list_tracks and get_track carry the flags (UTC, ctx.now) and omit them when unset', async () => {
  const files = {
    ...trackFiles(1, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-10' }),
    ...trackFiles(2, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-18' }),
    ...trackFiles(3, { Lane: 'quality-gate', 'Lane Status': 'waiting', 'Waiting Reason': 'window', 'KPI Check After': '2026-11-18' }),
    ...trackFiles(4, { 'Lane Status': 'queue', 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-10' }),
    ...trackFiles(5, {}),
  };
  const { call } = await open(files);
  const by = Object.fromEntries((await call(listTracks, {})).data.tracks.map((t) => [t.number, t]));
  assert.equal(by[1].overdue, true);
  assert.ok(!('overdue' in by[2]), 'due today is not overdue');
  assert.equal(by[3].ready_to_measure, true);
  assert.ok(!('overdue' in by[4]) && !('ready_to_measure' in by[4]), 'not waiting: neither');
  assert.equal(by[4].owner_action_due, '2026-11-10');
  assert.ok(!('overdue' in by[5]) && !('ready_to_measure' in by[5]) && !('owner_action' in by[5]));
  assert.equal((await call(getTrack, { track: 1 })).data.track.overdue, true);
  assert.equal((await call(getTrack, { track: 3 })).data.track.ready_to_measure, true);
  const later = await open(files, Date.parse('2026-11-19T00:00:00Z'));
  assert.equal((await later.call(getTrack, { track: 2 })).data.track.overdue, true, 'a day later it is overdue');
  assert.ok(!('overdue' in (await call(getTrack, { track: 5 })).data.track));
});

// ---- TC-5: outcome_missing ----

test('TC-5: outcome_missing: marketing or sales at done:success with a KPI block and neither KPI Actual nor Result', () => {
  const done = { Lane: 'done', 'Lane Status': 'success' };
  const problems = (markers, spec = KPI) => {
    const e = entry(1, markers, spec);
    return lintTracks([e], [rowOf(e.folder, e.index)], LANES).flatMap((x) => x.problems).filter((p) => p.startsWith('outcome_missing'));
  };
  assert.equal(problems({ ...done, Type: 'marketing' }).length, 1);
  assert.equal(problems({ ...done, Type: 'sales' }).length, 1);
  assert.equal(problems({ ...done, Type: 'Marketing' }).length, 1, 'the Type value is case-insensitive');
  assert.equal(problems({ ...done, Type: ' SALES ' }).length, 1);
  assert.equal(problems({ ...done, Type: 'marketing', Result: '' }).length, 1, 'a blank Result line is no result');
  assert.equal(problems({ ...done, Type: 'marketing', 'KPI Actual': '  ' }).length, 1);
  assert.equal(problems({ ...done, Type: 'marketing', 'KPI Actual': '42' }).length, 0);
  assert.equal(problems({ ...done, Type: 'marketing', Result: 'killed: no replies after 14 days' }).length, 0);
  assert.equal(problems({ ...done, Type: 'dev' }).length, 0, 'not for a dev track');
  assert.equal(problems({ ...done, Type: 'support' }).length, 0);
  assert.equal(problems({ Lane: 'done', 'Lane Status': 'queue', Type: 'marketing' }).length, 0, 'done:queue is not flagged');
  assert.equal(problems({ Lane: 'quality-gate', 'Lane Status': 'success', Type: 'marketing' }).length, 0);
  assert.equal(problems({ ...done, Type: 'marketing' }, '# Spec\n\nno kpi here\n').length, 0, 'an older track without a KPI block is exempt');
  assert.equal(problems({ ...done, Type: 'marketing' }, '# Spec\r\n\r\n## KPI\r\n\r\n- Target: 1\r\n').length, 1, 'CRLF spec');
  assert.equal(hasKpiBlock('## KPI MISS\n'), false);
  assert.equal(hasKpiBlock('### KPI\n'), false);
  // The spec was not read (the caller attaches it only for candidates): no verdict, no warning.
  const e = entry(1, { ...done, Type: 'marketing' });
  assert.deepEqual(lintTracks([e], [rowOf(e.folder, e.index)], LANES), []);
});

test('TC-5: outcome_missing reaches list_tracks and the generated summary as a warning, and never blocks a write', async () => {
  const files = {
    ...trackFiles(1, { Lane: 'done', 'Lane Status': 'success', Type: 'marketing' }, KPI),
    ...trackFiles(2, { Lane: 'done', 'Lane Status': 'success', Type: 'marketing', Result: 'killed: x' }, KPI),
    ...trackFiles(3, { Lane: 'done', 'Lane Status': 'success', Type: 'dev' }, KPI),
  };
  const { call, dir } = await open(files);
  const l = await call(listTracks, { include_done: true });
  assert.ok(l.warnings.some((w) => /^outcome_missing .*: 1\b/.test(w) || (w.startsWith('outcome_missing') && w.includes('AM-1') && !w.includes('AM-2'))), l.warnings.join('|'));
  // A write to another track regenerates the summary, which lists the warning under Needs attention.
  const t = await call(getTrack, { track: 3 });
  const w = await call(updateTrack, { track: 3, base: t.data.base, markers: { Phase: 'Done' } });
  assert.equal(w.env.ok, true, 'an advisory lint never blocks a write');
  const summary = readFile(dir, SUMMARY_PATH);
  assert.match(summary, /AM-1-t1: outcome_missing/);
  assert.ok(!/AM-2-t2: outcome_missing/.test(summary) && !/AM-3-t3: outcome_missing/.test(summary));
  // update_track that closes a track as done:success is judged on the NEW index.md, in the same commit.
  const files2 = trackFiles(7, { Lane: 'quality-gate', 'Lane Status': 'running', Type: 'sales' }, KPI);
  const b = await open(files2);
  const t7 = await b.call(getTrack, { track: 7 });
  const closed = await b.call(updateTrack, { track: 7, base: t7.data.base, markers: { Lane: 'done', 'Lane Status': 'success' } });
  assert.equal(closed.env.ok, true);
  assert.match(readFile(b.dir, SUMMARY_PATH), /AM-7-t7: outcome_missing/);
  assert.equal((await b.call(listTracks, {})).env.warnings.some((x) => /track_summary_regenerated|does not match/.test(x)), false, 'no churn: the summary written equals the one regenerated');
});

test('TC-5: get_track warns date_malformed and outcome_missing for the track it reads', async () => {
  const { call } = await open({
    ...trackFiles(1, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': '2026-02-30' }),
    ...trackFiles(2, { Lane: 'done', 'Lane Status': 'success', Type: 'marketing' }, KPI),
  });
  const a = await call(getTrack, { track: 1 });
  assert.ok(a.warnings.some((w) => w.startsWith('date_malformed: Owner Action Due "2026-02-30"')), a.warnings.join('|'));
  assert.ok(!('overdue' in a.data.track));
  assert.ok((await call(getTrack, { track: 2 })).warnings.some((w) => w.startsWith('outcome_missing')));
  const l = await call(listTracks, {});
  assert.ok(l.warnings.some((w) => w.startsWith('date_malformed') && w.includes('AM-1') && w.includes('"2026-02-30"')), l.warnings.join('|'));
});

// ---- TC-6: the waiting lint ----

test('TC-6: an Owner Action satisfies the waiting lint; a blank one does not; the dependency state does not call it ready to resume', () => {
  const lint = (markers) => { const e = entry(1, markers); return lintTracks([e], [rowOf(e.folder, e.index)], LANES).flatMap((x) => x.problems); };
  assert.deepEqual(lint({ 'Lane Status': 'waiting', 'Owner Action': 'Post it in the group' }), []);
  assert.equal(lint({ 'Lane Status': 'waiting' }).length, 1, 'the existing lint still fires');
  assert.equal(lint({ 'Lane Status': 'waiting', 'Owner Action': '  ' }).length, 1, 'a blank Owner Action is not a reason');
  const rows = [row({ Lane: 'done', 'Lane Status': 'success' }), { ...row({ 'Lane Status': 'waiting', 'Depends On': '1', 'Owner Action': 'Post it' }), number: 2 }].map((r, i) => ({ ...r, number: i + 1, depends_on: i ? ['1'] : [] }));
  assert.equal(dependencyState(rows).get(2).ready_to_resume, false, 'an owner step with its dependency met is not "resume"');
});

// ---- TC-7: no new tool, no new description text, no clock in the summary ----

test('TC-7: no new tool and no description mentions the owner markers; the context estimate is the one of the shipped tool list', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['list_tracks', 'get_track', 'get_context', 'health_report', 'create_track', 'update_track', 'append_conversation', 'report_outcome', 'help']);
  for (const t of TOOLS) assert.ok(!/owner|overdue|ready_to_measure/i.test(t.description), `${t.name}: description`);
});

test('TC-7: ten tracks whose three markers are 200 characters long: list_tracks and get_track stay inside the response budget', async () => {
  const two = (c) => c.repeat(200).slice(0, 200);
  const files = {};
  for (let n = 1; n <= 10; n += 1) Object.assign(files, trackFiles(n, { 'Lane Status': 'waiting', 'Owner Action': two('a'), 'Owner Action Due': '2026-11-10', Result: two('r'), Summary: two('s') }));
  const { call } = await open(files);
  const l = await call(listTracks, {});
  assert.equal(l.data.tracks.length, 10);
  assert.ok(l.data.tracks.every((t) => t.owner_action.length === 200 && t.result.length === 200 && t.overdue === true));
  const size = (v) => JSON.stringify(v).length;
  assert.ok(size(l.data) < MAX_TEXT_CHARS / 2, `list_tracks data is ${size(l.data)} characters`);
  assert.ok(l.r.content[0].text.length < MAX_TEXT_CHARS);
  const g = await call(getTrack, { track: 1 });
  assert.ok(g.r.content[0].text.length < MAX_TEXT_CHARS / 2, `get_track text is ${g.r.content[0].text.length} characters`);
  assert.equal(g.data.track.owner_action.length, 200);
});

test('TC-7: rowOf and generateSummary hold no clock: the same entries give the same text on any day, and checkSummary does not churn from one day to the next', () => {
  const entries = [
    entry(1, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-10', 'KPI Check After': '2026-11-12' }),
    entry(2, { 'Lane Status': 'waiting', 'Owner Action': 'Post it', 'Owner Action Due': '2026-02-30' }),
  ];
  const stamp = '2026-11-18T12:00:00Z';
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T12:00:00Z') });
  let a;
  let b;
  let ok;
  try {
    a = generateSummary(entries, { lanes: LANES, generatedAt: stamp }).text;
    mock.timers.setTime(Date.parse('2031-05-01T03:00:00Z'));
    b = generateSummary(entries, { lanes: LANES, generatedAt: stamp }).text;
    ok = checkSummary(a, entries, LANES);
  } finally { mock.timers.reset(); }
  assert.equal(a, b);
  assert.deepEqual(ok, { status: 'ok' });
  assert.match(a, /date_malformed: Owner Action Due "2026-02-30"/);
  assert.ok(!/overdue|ready_to_measure/.test(a), 'the summary says nothing that depends on today');
  for (const r of generateSummary(entries, { lanes: LANES, generatedAt: stamp }).rows) assert.ok(!('overdue' in r) && !('ready_to_measure' in r));
});
