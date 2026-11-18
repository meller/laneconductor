import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrackRef, trackNumberOfFolder, isTrackFolder, resolveTrack, nextNumber, slugify, defaultInitials, buildTrackFiles,
} from '../src/tracks.mjs';
import { parseMarkers, validateIndex } from '../src/markers.mjs';
import { parseEntries } from '../src/conversation.mjs';

// TC-2.6
test('resolveTrack finds both naming conventions by number', () => {
  const dirs = ['AM-10106-x', '999-canary', 'AM-10105-other', '_archive'];
  assert.equal(resolveTrack(dirs, '10106'), 'AM-10106-x');
  assert.equal(resolveTrack(dirs, 'AM-10106'), 'AM-10106-x');
  assert.equal(resolveTrack(dirs, 'am-10106'), 'AM-10106-x');
  assert.equal(resolveTrack(dirs, '999'), '999-canary');
});

test('resolveTrack: unknown number is TRACK_NOT_FOUND, two folders for one number is AMBIGUOUS_TRACK', () => {
  assert.throws(() => resolveTrack(['AM-1-a'], '2'), { code: 'TRACK_NOT_FOUND' });
  assert.throws(() => resolveTrack(['AM-10040-a', '10040-a'], '10040'), (e) => e.code === 'AMBIGUOUS_TRACK' && e.details.folders.length === 2);
  assert.throws(() => resolveTrack([], 'not-a-track'), { code: 'VALIDATION_FAILED' });
});

test('a longer number never matches a shorter prefix', () => {
  assert.throws(() => resolveTrack(['AM-10106-x'], '1010'), { code: 'TRACK_NOT_FOUND' });
});

test('folder name helpers', () => {
  assert.equal(trackNumberOfFolder('AM-10106-x'), 10106);
  assert.equal(trackNumberOfFolder('999-canary'), 999);
  assert.equal(trackNumberOfFolder('_archive'), null);
  assert.equal(isTrackFolder('AM-1-a'), true);
  assert.equal(isTrackFolder('file_sync_queue.md'), false);
  assert.deepEqual(parseTrackRef('AM-10106'), { number: 10106 });
});

// TC-2.7
test('nextNumber is max(local both conventions, upstream) + 1', () => {
  assert.equal(nextNumber(['AM-10106-x', '999-canary']), 10107);
  assert.equal(nextNumber(['AM-5-a'], ['AM-12-b', 'XX-7-c']), 13);
  assert.equal(nextNumber([]), 1);
});

test('slugify', () => {
  assert.equal(slugify('CSV export: for the "report" page!'), 'csv-export-for-the-report-page');
  assert.equal(slugify('  ---  '), 'track');
  assert.ok(slugify('x'.repeat(200)).length <= 60);
});

test('defaultInitials: argument, else the most common prefix, else XX', () => {
  assert.equal(defaultInitials(['AM-1-a', 'AM-2-b', 'JD-3-c'], 'zz'), 'ZZ');
  assert.equal(defaultInitials(['AM-1-a', 'AM-2-b', 'JD-3-c']), 'AM');
  assert.equal(defaultInitials(['999-x']), 'XX');
});

test('buildTrackFiles makes six files whose index.md satisfies the format rules', () => {
  const t = buildTrackFiles({
    number: 7, initials: 'XX', title: 'Add CSV export', problem: 'Users want CSV.\n\nThey also want it fast.',
    type: 'dev', trackKind: 'feature', autoRun: 'no', mergeMode: 'direct', dependsOn: [3, 4],
  });
  assert.equal(t.folder, 'XX-7-add-csv-export');
  assert.deepEqual(Object.keys(t.files).sort(), ['conversation', 'history', 'index', 'plan', 'spec', 'test']);
  const m = parseMarkers(t.files.index).values;
  assert.equal(m['Lane'], 'plan');
  assert.equal(m['Lane Status'], 'queue');
  assert.equal(m['Progress'], '0%');
  assert.equal(m['Phase'], 'New');
  assert.equal(m['Track Kind'], 'feature');
  assert.equal(m['Depends On'], '3, 4');
  assert.equal(m['Author'], 'XX');
  assert.equal(m['Problem'], 'Users want CSV.\n\nThey also want it fast.');
  assert.ok(m['Summary'].length <= 200);
  assert.deepEqual(validateIndex(t.files.index, ['plan', 'implement', 'review', 'quality-gate', 'done']), []);
  assert.match(t.files.index, /^# Track XX-7: Add CSV export\n/);
  assert.deepEqual(parseEntries(t.files.conversation), []);
});

test('buildTrackFiles rejects a problem that would corrupt the header block', () => {
  const base = { number: 1, initials: 'XX', title: 't', type: 'dev', autoRun: 'no', mergeMode: 'direct' };
  assert.throws(() => buildTrackFiles({ ...base, problem: 'ok\n## Heading' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => buildTrackFiles({ ...base, problem: 'ok\n**Lane**: done' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => buildTrackFiles({ ...base, title: 'two\nlines', problem: 'p' }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => buildTrackFiles({ ...base, title: '', problem: 'p' }), { code: 'VALIDATION_FAILED' });
});

// Track 10116, TC-1 and TC-2: the bug and feature forms.
const headings = (spec) => [...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const formBase = { number: 7, initials: 'XX', title: 'Form', type: 'dev', autoRun: 'no', mergeMode: 'direct' };

test('buildTrackFiles bug: problem text unchanged, then the six bug sections in order, regression test first', () => {
  const problem = 'The export button does nothing.\n\nIt worked last week.';
  const t = buildTrackFiles({ ...formBase, problem, trackKind: 'bug' });
  assert.deepEqual(headings(t.files.spec), ['Problem Statement', 'Symptom', 'Steps to reproduce', 'Expected result', 'Actual result', 'Suspected area', 'Environment']);
  assert.ok(t.files.spec.includes(`## Problem Statement\n\n${problem}\n\n## Symptom`));
  const first = t.files.test.split('\n').find((l) => l.startsWith('- [ ]'));
  assert.match(first, /^- \[ \] TC-1 \(regression\): .*reproduces the bug.*FAILS before the fix/);
  assert.equal(parseMarkers(t.files.index).values['Track Kind'], 'bug');
});

test('buildTrackFiles feature: problem text unchanged, then the five feature sections', () => {
  const t = buildTrackFiles({ ...formBase, problem: 'Users want CSV.', trackKind: 'feature' });
  assert.deepEqual(headings(t.files.spec), ['Problem Statement', 'The need', 'Who it is for', 'Wanted outcome', 'Acceptance criteria', 'Out of scope']);
  assert.ok(t.files.spec.includes('## Problem Statement\n\nUsers want CSV.\n\n## The need'));
  assert.equal(t.files.test, '# Tests: Track 7 - Form\n\n(Test cases to be added)\n');
});

test('buildTrackFiles with no kind keeps the generic skeleton byte for byte', () => {
  const t = buildTrackFiles({ ...formBase, problem: 'p' });
  assert.equal(t.files.spec, '# Spec: Form\n\n## Problem Statement\n\np\n\n## Requirements\n\n(To be written in the plan lane.)\n');
  assert.equal(t.files.test, '# Tests: Track 7 - Form\n\n(Test cases to be added)\n');
});
