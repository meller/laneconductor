// Track 10012 dogfood incident (2026-08-14): found live — dragging a
// UI-created track's card to a new lane on the Kanban board reverted it
// back to its previous lane within a few hundred ms. Root cause: UI-created
// tracks' index.md carries a `**Status**: <lane>` marker baked in at
// creation (never updated again) alongside `**Lane**:` (updated on every
// lane change). parseStatus() checked `**Status**` before `**Lane**`, so
// once the two diverged, every file-triggered re-sync reverted the DB back
// to the stale `**Status**` value. Extracted so this is testable without
// spinning up the whole sync-worker process (chokidar watchers, intervals).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../services/parse-status.mjs';

const Lanes = {
  BACKLOG: 'backlog', PLAN: 'plan', IMPLEMENT: 'implement',
  REVIEW: 'review', QUALITY_GATE: 'quality-gate', DONE: 'done',
};
const LaneAliases = {};

describe('parseStatus', () => {
  it('prefers **Lane** over a stale, diverged **Status** marker (track 10012 regression)', () => {
    const content = '# Track 10012: inbox functionality fix\n\n**Status**: plan\n**Progress**: 100%\n\n## Phases\n- [ ] Phase 1: Implementation\n**Lane**: implement\n**Lane Status**: queue\n';
    assert.equal(parseStatus(content, Lanes, LaneAliases), 'implement');
  });

  it('still reads **Lane** as authoritative when both markers agree', () => {
    const content = '**Status**: review\n**Lane**: review\n';
    assert.equal(parseStatus(content, Lanes, LaneAliases), 'review');
  });

  it('falls back to **Status** when no **Lane** marker exists (freshly-created track)', () => {
    const content = '# Track 999: New\n\n**Status**: plan\n**Progress**: 0%\n';
    assert.equal(parseStatus(content, Lanes, LaneAliases), 'plan');
  });

  it('falls back to heuristic matching when neither marker exists', () => {
    const content = 'This track is now in the implement phase.';
    assert.equal(parseStatus(content, Lanes, LaneAliases), 'implement');
  });
});
