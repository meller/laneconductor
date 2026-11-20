// Track AM-10152: the text the base plugin carries about KPI focus. It is advice: nothing locks, and a project with no KPI markers behaves as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL } from '../../scripts/build-plugin.mjs';

const base = (rel) => fs.readFileSync(path.join(REPO, PLUGIN_REL, rel), 'utf8');

test('the Serves marker is in the marker table: a list of KPIs, Focus values named, advice and never a lock', () => {
  const t = base('skills/laneconductor/SKILL.md');
  const row = t.split('\n').find((l) => l.startsWith('| `**Serves**'));
  assert.ok(row, 'a Serves row');
  for (const w of ['active', 'future', 'done', 'dropped', 'backlog', 'never a lock', 'conductor/kpis.md']) assert.ok(row.includes(w), w);
});

test('the plan lane asks which KPIs a track serves, writes Serves, warns on none or only non-active, and offers to promote backlog tracks when a KPI turns active', () => {
  const t = base('skills/laneconductor/lanes/plan.md');
  const step = t.split('\n').find((l) => l.startsWith('5c. **KPI.**'));
  assert.ok(step);
  for (const w of ['conductor/kpis.md', 'which this track serves', '**Serves**', 'none', '`Focus` is not `active`', 'backlog', 'offer to move', '`list_tracks` with `serves`']) assert.ok(step.includes(w), w);
  assert.ok(/If `conductor\/kpis.md` lists KPIs/.test(step), 'only when the project has KPIs: a project without any is untouched');
});

test('the quality gate notes a missing Serves and never fails a track for it', () => {
  assert.match(base('skills/laneconductor/lanes/quality-gate.md'), /a missing `\*\*Serves\*\*` is a note, never a failure/);
});

test('next prefers tracks that serve an active KPI, then tracks that name none, then tracks that serve only non-active ones', () => {
  assert.match(base('skills/laneconductor/ops/next.md'), /3b\. \*\*KPI focus\.\*\* Active-KPI tracks \(`Serves`, `Focus` in `kpis\.md`\) first, then those naming none, then those serving only non-active KPIs\./);
});

test('setup writes kpis.md with an ID and a Focus column; the scaffold and the template agree', () => {
  assert.match(base('skills/laneconductor/setup/scaffold.md'), /`kpis\.md` \(`ID`, `Focus`: `active` or `future`/);
  assert.match(base('skills/laneconductor/setup/templates.md'), /\| ID \| Metric \| Target \| Time Horizon \| Focus \| Notes \|/);
  assert.match(fs.readFileSync(path.join(REPO, 'connector/src/newproject/scaffold.mjs'), 'utf8'), /\| ID \| Metric \| Target \| Time Horizon \| Focus \| Notes \|/);
});
