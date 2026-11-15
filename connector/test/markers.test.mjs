import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkers, getMarker, setMarker, removeMarker, markerFingerprint, validateIndex, trackTitle,
} from '../src/markers.mjs';

const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const SAMPLE = [
  '# Track AM-1: A title',
  '',
  '**Lane**: plan',
  '**Lane Status**: queue',
  '**Progress**: 5%',
  '**Problem**: first line of the problem',
  '',
  'second paragraph of the problem',
  '**Summary**: short',
  '',
  '## Notes',
  '',
  '**Lane**: not-a-marker-in-the-body',
  '',
].join('\n');

test('parseMarkers reads the header block only, with multi-line values', () => {
  const m = parseMarkers(SAMPLE);
  assert.deepEqual(m.order, ['Lane', 'Lane Status', 'Progress', 'Problem', 'Summary']);
  assert.equal(m.values['Lane'], 'plan');
  assert.equal(m.values['Problem'], 'first line of the problem\n\nsecond paragraph of the problem');
  assert.equal(m.values['Summary'], 'short');
  assert.equal(getMarker(SAMPLE, 'Lane'), 'plan');
});

// TC-2.2
test('setMarker replaces one line and leaves every other byte alone', () => {
  const out = setMarker(SAMPLE, 'Lane Status', 'success');
  assert.equal(out, SAMPLE.replace('**Lane Status**: queue', '**Lane Status**: success'));
  assert.equal(setMarker(out, 'Lane Status', 'queue'), SAMPLE, 'round trip is byte-for-byte');
});

test('setMarker on a multi-line marker replaces the whole extent', () => {
  const out = setMarker(SAMPLE, 'Problem', 'new problem');
  assert.equal(getMarker(out, 'Problem'), 'new problem');
  assert.equal(getMarker(out, 'Summary'), 'short');
  assert.ok(!out.includes('second paragraph'));
});

test('setting an absent marker inserts it after the last marker of the header block', () => {
  const out = setMarker(SAMPLE, 'Verdict', 'pass');
  const lines = out.split('\n');
  const i = lines.indexOf('**Verdict**: pass');
  assert.equal(lines[i - 1], '**Summary**: short');
  assert.equal(lines[i + 1], '');
  assert.equal(lines[i + 2], '## Notes');
});

test('setting an absent marker with no markers present goes after the title', () => {
  const out = setMarker('# Track X: t\n\nbody\n', 'Lane', 'plan');
  assert.equal(out, '# Track X: t\n\n**Lane**: plan\n\nbody\n'.replace('\n\n\nbody', '\n\nbody'));
});

test('removeMarker deletes the whole extent', () => {
  const out = removeMarker(SAMPLE, 'Problem');
  assert.ok(!out.includes('**Problem**') && !out.includes('second paragraph'));
  assert.equal(getMarker(out, 'Summary'), 'short');
  assert.equal(removeMarker(SAMPLE, 'Nope'), SAMPLE);
});

test('setMarker rejects names and values that would corrupt the header block', () => {
  assert.throws(() => setMarker(SAMPLE, 'Bad:Name', 'x'), /VALIDATION|marker name/i);
  assert.throws(() => setMarker(SAMPLE, 'Lane', 'two\nlines'), /single line/i);
});

test('markerFingerprint keeps short values and hashes long ones', () => {
  assert.equal(markerFingerprint('plan'), 'plan');
  const long = 'x'.repeat(500);
  const fp = markerFingerprint(long);
  assert.match(fp, /^sha:[0-9a-f]{40}$/);
  assert.equal(markerFingerprint(long), fp);
});

// TC-2.3
test('validateIndex: lane and status rules (REQ-14)', () => {
  const ok = (lane, status) => validateIndex(`# T\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n`, LANES);
  assert.deepEqual(ok('implement', 'queue'), []);
  assert.deepEqual(ok('backlog', 'waiting'), []);
  assert.match(ok('impl', 'queue')[0], /Lane/);
  assert.match(ok('plan', 'done')[0], /Lane Status/);
  assert.equal(validateIndex('# T\n\n**Lane**: plan\n', LANES).length, 1, 'missing Lane Status');
  assert.equal(validateIndex('# T\n', LANES).length, 2);
});

test('trackTitle reads the heading', () => {
  assert.equal(trackTitle('# Track AM-10106: The title: with colon\n'), 'The title: with colon');
  assert.equal(trackTitle('# Track 10106: Legacy\n'), 'Legacy');
  assert.equal(trackTitle('no heading'), null);
});
