// ui/src/lib/worktreeStats.test.js
// Track 1114: stats/recommendations header for the Worktrees panel,
// requested after a session of finding real problems in this exact data
// (stranded branches nobody merged, orphaned scratch worktrees, a whole
// backlog of open worktrees). Pure function so the recommendation
// thresholds/wording are testable without rendering anything.
import { describe, it, expect } from 'vitest';
import { computeWorktreeStats, OPEN_WORKTREE_WARNING_THRESHOLD } from './worktreeStats.js';

describe('computeWorktreeStats', () => {
  it('counts rows per classification and total dirty files', () => {
    const rows = [
      { class: 'open', dirty: 3 },
      { class: 'open', dirty: 2 },
      { class: 'stranded', dirty: null },
      { class: 'detached', dirty: 0 },
    ];
    const stats = computeWorktreeStats(rows);
    expect(stats.total).toBe(4);
    expect(stats.counts.open).toBe(2);
    expect(stats.counts.stranded).toBe(1);
    expect(stats.counts.detached).toBe(1);
    expect(stats.counts.mergeable).toBe(0);
    expect(stats.totalDirty).toBe(5);
  });

  it('recommends reviewing when open count exceeds the threshold', () => {
    const rows = Array.from({ length: OPEN_WORKTREE_WARNING_THRESHOLD + 1 }, () => ({ class: 'open', dirty: 0 }));
    const stats = computeWorktreeStats(rows);
    expect(stats.recommendations.some(r => /more than/i.test(r.text) && r.level === 'warning')).toBe(true);
  });

  it('does not recommend reviewing when open count is at or below the threshold', () => {
    const rows = Array.from({ length: OPEN_WORKTREE_WARNING_THRESHOLD }, () => ({ class: 'open', dirty: 0 }));
    const stats = computeWorktreeStats(rows);
    expect(stats.recommendations.some(r => /more than/i.test(r.text))).toBe(false);
  });

  it('recommends merging when stranded rows exist, singular wording for exactly one', () => {
    const stats = computeWorktreeStats([{ class: 'stranded', dirty: 0 }]);
    const rec = stats.recommendations.find(r => /stranded/i.test(r.text));
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('action');
    expect(rec.text).toMatch(/is done and ready to merge/i);
  });

  it('uses plural wording for multiple stranded rows', () => {
    const stats = computeWorktreeStats([{ class: 'stranded', dirty: 0 }, { class: 'stranded', dirty: 0 }]);
    const rec = stats.recommendations.find(r => /stranded/i.test(r.text));
    expect(rec.text).toMatch(/are done and ready to merge/i);
  });

  it('recommends manual resolution when conflicted rows exist', () => {
    const stats = computeWorktreeStats([{ class: 'conflicted', dirty: 0 }]);
    expect(stats.recommendations.some(r => /conflict/i.test(r.text) && r.level === 'action')).toBe(true);
  });

  it('flags detached rows as informational, not urgent', () => {
    const stats = computeWorktreeStats([{ class: 'detached', dirty: 0 }]);
    const rec = stats.recommendations.find(r => /orphaned scratch/i.test(r.text));
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('info');
  });

  it('produces no recommendations for a small, healthy set of open rows', () => {
    const rows = [{ class: 'open', dirty: 0 }, { class: 'mergeable', dirty: 0 }];
    const stats = computeWorktreeStats(rows);
    expect(stats.recommendations).toEqual([]);
  });

  it('handles an empty list', () => {
    const stats = computeWorktreeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.recommendations).toEqual([]);
  });
});
