// Track AM-10152: KPI focus. A KPI is active, future, done or dropped; a track serves a list of them; nothing is ranked and nothing depends on anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKpis, servesList, kpiFocus } from '../src/kpis.mjs';

const WITH_FOCUS = `# Project KPIs

## North-Star Metrics

| ID | Metric | Target | Time Horizon | Focus | Notes |
|----|--------|--------|--------------|-------|-------|
| KPI-1 | GitHub Stars | 500 | Q2 | active | |
| KPI-2 | Directory installs | | | future | after listing |
| KPI-3 | Show HN Score | 100 | per launch | dropped | |
| KPI-4 | Weekly actives | | | | no focus given |

## Contributing Tracks

| Track | Title | Maps To |
|-------|-------|---------|
| 1052 | Show HN | Show HN Score |
`;
const OLD = `# Project KPIs\n\n| Metric | Target | Time Horizon | Status | Notes |\n|--------|--------|--------------|--------|-------|\n| GitHub Stars | 500 | Q2 | tracking | |\n| Reddit Upvotes | 50 | per post | tracking | |\n`;

test('parseKpis: ids and focus are read from their columns; an empty focus is active; other tables and placeholder rows are ignored', () => {
  assert.deepEqual(parseKpis(WITH_FOCUS), [
    { id: 'KPI-1', metric: 'GitHub Stars', focus: 'active' },
    { id: 'KPI-2', metric: 'Directory installs', focus: 'future' },
    { id: 'KPI-3', metric: 'Show HN Score', focus: 'dropped' },
    { id: 'KPI-4', metric: 'Weekly actives', focus: 'active' },
  ]);
  assert.deepEqual(parseKpis('| Metric | Target |\n|---|---|\n| (none set yet) | |\n'), []);
  assert.deepEqual(parseKpis(''), []); assert.deepEqual(parseKpis(undefined), []);
});

test('parseKpis: an old file with no Focus or ID column keeps working, every KPI active, named by its metric', () => {
  assert.deepEqual(parseKpis(OLD), [{ id: null, metric: 'GitHub Stars', focus: 'active' }, { id: null, metric: 'Reddit Upvotes', focus: 'active' }]);
});

test('servesList: comma or semicolon separated, trimmed, backticks dropped, first line only, capped', () => {
  assert.deepEqual(servesList('KPI-1, `KPI-3`; GitHub Stars'), ['KPI-1', 'KPI-3', 'GitHub Stars']);
  assert.deepEqual(servesList('KPI-1\n**Summary**: x, y'), ['KPI-1']);
  assert.deepEqual(servesList(''), []); assert.deepEqual(servesList(undefined), []);
  assert.equal(servesList(Array.from({ length: 30 }, (_, i) => `K${i}`).join(',')).length, 12);
  assert.equal(servesList('x'.repeat(200))[0].length, 60);
});

test('kpiFocus: active when any served KPI is active, future when every found one is not, unmapped when none is named or found; ids and metric names both resolve', () => {
  const k = parseKpis(WITH_FOCUS);
  assert.equal(kpiFocus(['KPI-1'], k), 'active');
  assert.equal(kpiFocus(['kpi-2', 'KPI-1'], k), 'active', 'one active KPI among several: not off-focus');
  assert.equal(kpiFocus(['KPI-2'], k), 'future');
  assert.equal(kpiFocus(['Directory installs', 'Show HN Score'], k), 'future', 'future and dropped: not active');
  assert.equal(kpiFocus(['github stars'], k), 'active', 'by metric name, any case');
  assert.equal(kpiFocus([], k), 'unmapped');
  assert.equal(kpiFocus(['KPI-9'], k), 'unmapped', 'a name that is not in kpis.md cannot be judged');
  assert.equal(kpiFocus(['KPI-1'], []), 'unmapped', 'no kpis.md');
  assert.equal(kpiFocus(['GitHub Stars'], parseKpis(OLD)), 'active');
});

// ---- rows and list_tracks
import { rowOf } from '../src/summary.mjs';
import { INDEX } from './helpers/repo.mjs';
test('rowOf: serves is the Serves list, present only when named', () => {
  const idx = (extra) => ({ content: INDEX(7, 'Seven', { extra }) });
  assert.deepEqual(rowOf('AM-7-seven', idx('**Serves**: KPI-1, GitHub Stars\n')).serves, ['KPI-1', 'GitHub Stars']);
  assert.ok(!('serves' in rowOf('AM-7-seven', idx(''))));
});

import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';
test('list_tracks: serves filters by an id or a metric name, any case; the rows show their serves list', async () => {
  const mk = (n, extra) => [`conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, `T${n}`, { extra })];
  const dir = makeRepo({ files: Object.fromEntries([mk(41, '**Serves**: KPI-1, GitHub Stars\n'), mk(42, '**Serves**: KPI-2\n'), mk(43, '')]) });
  const s = await connect(dir);
  try {
    const all = (await s.call('list_tracks')).env.data.tracks;
    assert.deepEqual(all.find((t) => t.number === 41).serves, ['KPI-1', 'GitHub Stars']);
    assert.ok(!('serves' in all.find((t) => t.number === 43)));
    const by = async (serves) => (await s.call('list_tracks', { serves })).env.data.tracks.map((t) => t.number).sort();
    assert.deepEqual(await by('kpi-1'), [41]);
    assert.deepEqual(await by('GITHUB STARS'), [41]);
    assert.deepEqual(await by('KPI-2'), [42]);
    assert.deepEqual(await by('KPI-9'), []);
  } finally { await s.close().catch(() => {}); rm(dir); }
});
