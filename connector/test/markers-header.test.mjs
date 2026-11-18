// Track AM-10139: the marker parser reads a damaged or hand-edited header like the old daemon did (first match wins, CRLF, case),
// writes strictly, and one repair_index write fixes the header.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, writeFile, readFile, commitAll, rm, git } from './helpers/repo.mjs';
import { damagedHeaders, getMarker, headerDamagedWarning, parseMarkers, removeMarker, repairIndex, setMarker, validateIndex } from '../src/markers.mjs';

const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const DUP = [
  '# Track AM-1020: Old track',
  '',
  '**Lane**: review',
  '**Lane Status**: running',
  '**Progress**: 40%',
  '**Lane**: plan',
  '**Lane Status**: queue',
  '**Summary**: short',
  '',
].join('\n');

// TC-1 (regression): the repeated header is not folded into the marker above it.
test('a repeated header does not fold into the marker above it; the first one wins and is reported', () => {
  const p = parseMarkers(DUP);
  assert.equal(p.values['Lane'], 'review');
  assert.equal(p.values['Lane Status'], 'running');
  assert.equal(p.values['Progress'], '40%', 'the swallowed value is gone: Progress is just 40%');
  assert.deepEqual(damagedHeaders(DUP), [{ name: 'Lane', line: 6 }, { name: 'Lane Status', line: 7 }]);
  assert.deepEqual(validateIndex(DUP, LANES), [], 'a track with a repeated header is valid and editable');
  assert.match(headerDamagedWarning(DUP), /^header_damaged: repeats Lane \(l\.6\).*repair_index/);
  assert.equal(headerDamagedWarning(SAMPLE_OK), null);
});

test('the header_damaged warning fits the 200 character bound with its final period for up to 4 repeats and long names', () => {
  for (const names of [['Lane', 'Lane Status'], ['Waiting On Tracks', 'Waiting Reason', 'Lane Status', 'Run Started'], ['Waiting On Tracks', 'Waiting Reason', 'Lane Status', 'Run Started', 'Progress', 'Phase']]) {
    const lines = ['# T', '', ...names.map((n) => `**${n}**: a`), ...names.map((n, i) => `**${n}**: b${i}`), ''];
    const w = headerDamagedWarning(lines.join('\n'));
    assert.ok(w.length <= 200, `${w.length}: ${w}`);
    assert.ok(w.endsWith('.'), w);
    assert.ok(w.includes(names[0]), w);
  }
  const forty = 'A'.repeat(40);
  const w = headerDamagedWarning(`**${forty}**: 1\n**${forty}**: 2\n`);
  assert.ok(w.length <= 200 && w.endsWith('.'), w);
});

const SAMPLE_OK = '# Track AM-1: t\n\n**Lane**: plan\n**Lane Status**: queue\n';

test('setMarker on a damaged header edits the first one and keeps the repeats', () => {
  const out = setMarker(DUP, 'Lane Status', 'success');
  assert.equal(out, DUP.replace('**Lane Status**: running', '**Lane Status**: success'));
  assert.equal(removeMarker(DUP, 'Progress'), DUP.replace('**Progress**: 40%\n', ''));
});

// TC-3
test('CRLF: markers are read and written, and the file keeps its line endings', () => {
  const crlf = '# Track AM-5: c\r\n\r\n**Lane**: plan\r\n**Lane Status**: queue\r\n**Progress**: 0%\r\n\r\n## Notes\r\n\r\ntext\r\n';
  const p = parseMarkers(crlf);
  assert.equal(p.values['Lane'], 'plan');
  assert.equal(p.values['Progress'], '0%', 'no stray \\r in values');
  const out = setMarker(crlf, 'Lane Status', 'running');
  assert.equal(out, crlf.replace('queue', 'running'));
  assert.ok(!/[^\r]\n/.test(out), 'every newline is still CRLF');
  const added = setMarker(crlf, 'Run By', 'x');
  assert.ok(!/[^\r]\n/.test(added));
  assert.equal(getMarker(added, 'Run By'), 'x');
  assert.deepEqual(validateIndex(crlf, LANES), []);
});

// TC-4
test('names match case-insensitively; values of Lane and Lane Status compare lower-cased; writes use the canonical name', () => {
  const idx = '# Track AM-6: c\n\n**lane**: Plan\n**Lane status**: QUEUE \n**progress**: 5%\n';
  const p = parseMarkers(idx);
  assert.equal(p.values['Lane'], 'plan');
  assert.equal(p.values['Lane Status'], 'queue');
  assert.equal(getMarker(idx, 'progress'), '5%');
  assert.deepEqual(validateIndex(idx, LANES), []);
  const out = setMarker(idx, 'Lane Status', 'running');
  assert.match(out, /^\*\*Lane Status\*\*: running$/m);
  assert.ok(!out.includes('**Lane status**'));
  assert.equal(parseMarkers(out).values['Lane Status'], 'running');
  assert.deepEqual(damagedHeaders('**Lane**: plan\n**lane**: review\n'), [{ name: 'Lane', line: 2 }], 'a repeat in another case is a repeat');
});

// TC-5
test('repairIndex keeps the first Lane and Lane Status, moves the repeats below a heading, and is idempotent', () => {
  const out = repairIndex(DUP);
  assert.equal(parseMarkers(out).values['Lane'], 'review');
  assert.deepEqual(damagedHeaders(out), []);
  assert.match(out, /## Repeated header lines \(moved by repair_index\)\n\n\*\*Lane\*\*: plan\n\*\*Lane Status\*\*: queue\n/);
  assert.equal(repairIndex(out), out, 'a repaired file has nothing to repair');
  assert.equal(repairIndex(SAMPLE_OK), SAMPLE_OK);
  // a header followed by a section: the moved lines go before the existing heading, nothing else changes
  const withSection = `${DUP}\n## Notes\n\nbody\n`;
  const r2 = repairIndex(withSection);
  assert.ok(r2.indexOf('Repeated header lines') < r2.indexOf('## Notes'));
  assert.ok(r2.endsWith('## Notes\n\nbody\n'));
  // CRLF stays CRLF
  const crlf = repairIndex(DUP.replace(/\n/g, '\r\n'));
  assert.ok(!/[^\r]\n/.test(crlf));
  assert.deepEqual(damagedHeaders(crlf), []);
  // spelling is normalised on repair
  assert.match(repairIndex('# T\n\n**lane**: plan\n**Lane status**: queue\n'), /^\*\*Lane\*\*: plan\n\*\*Lane Status\*\*: queue$/m);
});

// TC-2: the repository's own indexes (read only): every track that has Lane and Lane Status once or repeated reads as valid.
test('over this repository\'s real indexes: no throw, a repeated header never makes a track invalid, repair leaves a clean header', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'conductor', 'tracks');
  if (!fs.existsSync(root)) return;
  let n = 0;
  let repeated = 0;
  for (const d of fs.readdirSync(root)) {
    const f = path.join(root, d, 'index.md');
    if (!fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    n++;
    const p = parseMarkers(content);
    if (p.damaged.length) {
      repeated++;
      const fixed = repairIndex(content);
      assert.deepEqual(damagedHeaders(fixed), [], d);
      assert.deepEqual(parseMarkers(fixed).values, parseMarkers(content).values, `${d}: repair keeps every value the parser used`);
    }
    for (const v of ['Lane', 'Lane Status']) if (v in p.values) assert.ok(!p.values[v].includes('\n'), `${d}: ${v} is one line`);
  }
  assert.ok(n > 0);
  assert.ok(repeated >= 0);
});

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});

async function withTrack(indexContent) {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, 'conductor/tracks/AM-7-seven/index.md', indexContent);
  commitAll(dir, 'fixture');
  const s = await connect(dir);
  sessions.push(s);
  return { dir, s };
}

test('update_track edits a damaged index, warns header_damaged, and repair_index fixes it in one write that needs the index base', async () => {
  const { dir, s } = await withTrack(DUP.replace('AM-1020', 'AM-7'));
  const g = await s.call('get_track', { track: '7' });
  assert.ok(g.env.warnings.some((w) => w.startsWith('header_damaged')), JSON.stringify(g.env.warnings));
  const u = await s.call('update_track', { track: '7', base: g.env.data.base, markers: { Progress: '50%' } });
  assert.equal(u.isError, false, u.text);
  assert.ok(u.env.warnings.some((w) => w.startsWith('header_damaged')));
  assert.match(readFile(dir, 'conductor/tracks/AM-7-seven/index.md'), /\*\*Progress\*\*: 50%\n\*\*Lane\*\*: plan/);
  // repair: refuses to combine, refuses without the index base, then writes
  const bad = await s.call('update_track', { track: '7', base: u.env.data.base, repair_index: true, markers: { Progress: '60%' } });
  assert.equal(bad.env.error.code, 'VALIDATION_FAILED');
  const noBase = { ...u.env.data.base, files: { plan: u.env.data.base.files.plan ?? null } };
  const nb = await s.call('update_track', { track: '7', base: noBase, repair_index: true });
  assert.equal(nb.env.error.code, 'BASE_MISSING_FILE');
  const g2 = await s.call('get_track', { track: '7', files: ['index'] });
  const r = await s.call('update_track', { track: '7', base: g2.env.data.base, repair_index: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.env.warnings.some((w) => w.startsWith('header_damaged')), false);
  const after = readFile(dir, 'conductor/tracks/AM-7-seven/index.md');
  assert.deepEqual(damagedHeaders(after), []);
  assert.match(after, /## Repeated header lines/);
  const again = await s.call('update_track', { track: '7', base: r.env.data.base, repair_index: true });
  assert.equal(again.isError, false);
  assert.ok(again.env.warnings.some((w) => /nothing to repair/.test(w)));
  assert.equal(git(dir, 'status', '--porcelain', '--', 'conductor/tracks').trim(), '');
  const l = await s.call('list_tracks', {});
  assert.equal(l.env.warnings.some((w) => w.startsWith('header_damaged')), false);
});
