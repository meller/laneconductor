// Track 10040 Phase 1 (REQ-13): lane-name lists were duplicated as inline
// SQL/JS literals across the worker and the API. Adding `done` as a
// claimable lane (track 10035) updated some sites and silently missed
// others. These tests pin the single shared definition so a future lane
// addition can't half-land the same way again.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Lanes, CLAIMABLE_LANES, MOVABLE_LANES } from '../constants.mjs';

test('TC-52: CLAIMABLE_LANES is exactly plan/implement/review/quality-gate/done, not backlog', () => {
  const expected = [Lanes.PLAN, Lanes.IMPLEMENT, Lanes.REVIEW, Lanes.QUALITY_GATE, Lanes.DONE];
  assert.deepEqual([...CLAIMABLE_LANES].sort(), [...expected].sort());
  assert.ok(!CLAIMABLE_LANES.includes(Lanes.BACKLOG), 'backlog must never be auto-claimable');
});

test('TC-53: MOVABLE_LANES is CLAIMABLE_LANES plus backlog, derived not independently listed', () => {
  assert.deepEqual([...MOVABLE_LANES].sort(), [...CLAIMABLE_LANES, Lanes.BACKLOG].sort());
  for (const lane of CLAIMABLE_LANES) assert.ok(MOVABLE_LANES.includes(lane));
});

test('TC-54 (AC-13): no hardcoded lane-list literal remains in a SQL or claim path', () => {
  const files = [
    'ui/server/index.mjs',
    'conductor/laneconductor.sync.mjs',
  ];
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Matches the exact duplicated literals this track found live:
    //   lane_status IN ('plan','implement','review','quality-gate'[,'done'])
    //   ['plan','implement','review','quality-gate'[,'done']].includes(...)
    const sqlLiteral = /lane_status\s+IN\s*\(\s*'plan'\s*,\s*'implement'\s*,\s*'review'\s*,\s*'quality-gate'/gi;
    const jsLiteral = /\[\s*'plan'\s*,\s*'implement'\s*,\s*'review'\s*,\s*'quality-gate'/gi;
    for (const re of [sqlLiteral, jsLiteral]) {
      const matches = src.match(re) || [];
      if (matches.length) offenders.push(`${f}: ${matches.length} match(es) of ${re}`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded lane-list literal(s) found:\n${offenders.join('\n')}`);
});
