// ui/src/lib/worktreeRunState.test.js
// Track 10024: "is this worktree row running" as a pure, testable predicate —
// previously only existed as WorktreesPanel's inline `rowBusy` boolean, which
// covers client-initiated dispatches only and can't represent a run started
// elsewhere (e.g. a plain lane re-dispatch) or one that survives a page reload.
import { describe, it, expect } from 'vitest';
import { isWorktreeRowRunning } from './worktreeRunState.js';

describe('isWorktreeRowRunning', () => {
  it('TC-1: server-reported running (lane_status) with no client-side pending dispatch', () => {
    expect(isWorktreeRowRunning({ row: { track: '10024', lane_status: 'running' }, busy: false })).toBe(true);
  });

  it('TC-2: client-initiated dispatch still pending, server not yet caught up', () => {
    expect(isWorktreeRowRunning({ row: { track: '10024', lane_status: 'queue' }, busy: true })).toBe(true);
  });

  it('TC-3: neither signal set', () => {
    expect(isWorktreeRowRunning({ row: { track: '10024', lane_status: 'queue' }, busy: false })).toBe(false);
  });

  it('TC-4: detached row (no track) is never running, even with both signals set', () => {
    expect(isWorktreeRowRunning({ row: { track: null, lane_status: 'running' }, busy: true })).toBe(false);
  });

  it('TC-5: lane_status match is case-insensitive', () => {
    expect(isWorktreeRowRunning({ row: { track: '10024', lane_status: 'RUNNING' }, busy: false })).toBe(true);
  });

  it('TC-6: missing/empty row does not throw and reports not running', () => {
    expect(isWorktreeRowRunning({ row: undefined, busy: false })).toBe(false);
    expect(isWorktreeRowRunning({ row: {}, busy: false })).toBe(false);
  });
});
