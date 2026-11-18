// Track AM-10133 Phase 2: the lane guides and operations were rewritten in the plugin way (no lc command, no lock scripts, no measure script).
// The replacements are in, the markers the connector handles are unchanged, and the implement steps are still consecutive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';

const SKILL = path.join(REPO, '.claude/skills/laneconductor');
const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');

test('TC-7 merge: plain git and gh steps, each push asked about; no worktrees command, no reconciler, no global lock', () => {
  const merge = read('lanes/merge.md');
  assert.match(merge, /git merge --no-ff track-NNN/);
  assert.match(merge, /gh pr create/);
  assert.match(merge, /gh auth status/);
  assert.match(merge, /git push -u origin track-NNN/);
  assert.match(merge, /Ask the human\s+before any push/);
  assert.match(merge, /gh pr list --head track-NNN/);
  assert.doesNotMatch(merge, /reconciler|main-mode lock|merge_mode. column|mergeWorktreeBranch|createTrackPr/);
});

test('TC-7 SKILL.md finds a track with the Glob form and the add-on tool; quality-gate reads the KPI by hand; implement makes the worktree itself', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /conductor\/tracks\/\*-<N>-\*\//);
  assert.match(skill, /conductor\/tracks\/<N>-\*\//);
  assert.match(skill, /get_track/);
  assert.match(read('lanes/quality-gate.md'), /by hand from the source the `## KPI` block names/);
  const impl = read('lanes/implement.md');
  assert.match(impl, /git worktree add \.worktrees\/NNN -b track-NNN/);
  assert.doesNotMatch(impl, /\block\b/i);
  assert.match(read('lanes/plan.md'), /Glob\s+`conductor\/tracks\/\*-<N>-\*\/`/);
  assert.match(read('ops/tracks.md'), /create_track/);
  assert.match(read('lanes/brainstorm.md'), /Write the first question to `conversation\.md`/);
  assert.match(read('deploy/setup-deploy.md'), /chat procedure/);
});

test('TC-8b every marker the lane guides use is still written in the file that used it', () => {
  const where = {
    '**Lane**': 'lanes/implement.md', '**Lane Status**': 'lanes/implement.md', '**Progress**': 'lanes/implement.md', '**Phase**': 'ops/tracks.md',
    '**Verdict**': 'lanes/quality-gate.md', '**KPI Actual**': 'lanes/quality-gate.md', '**KPI Snapshot**': 'lanes/quality-gate.md',
    '**PR URL**': 'lanes/merge.md', '**Waiting for reply**': 'lanes/brainstorm.md',
  };
  for (const [marker, file] of Object.entries(where)) assert.ok(read(file).includes(marker), `${file} names ${marker}`);
});

test('TC-8c the implement lane steps are consecutive after the lock steps were removed', () => {
  const nums = [...read('lanes/implement.md').matchAll(/^(\d+)([a-z]?)\. \*\*/gm)].map((m) => [Number(m[1]), m[2]]);
  const majors = [...new Set(nums.map(([n]) => n))];
  assert.deepEqual(majors, [0, 1, 2, 3, 4, 5, 6]);
});
