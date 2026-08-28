// ui/src/lib/workerSort.test.js
// Track 10037 Phase 2 Task 4 (AC-1): ordering behavior for the strip.

import { describe, it, expect } from 'vitest';
import { sortWorkersForStrip } from './workerSort.js';

function w(overrides = {}) {
  return {
    id: 1, hostname: 'host-a', worker_number: 1, status: 'idle',
    current_task: null, type: 'project', ...overrides,
  };
}

describe('sortWorkersForStrip', () => {
  it('returns [] for non-array input', () => {
    expect(sortWorkersForStrip(null)).toEqual([]);
    expect(sortWorkersForStrip(undefined)).toEqual([]);
  });

  it('AC-1: a busy worker sorts before N idle workers', () => {
    const idle1 = w({ id: 1, hostname: 'idle-1' });
    const idle2 = w({ id: 2, hostname: 'idle-2' });
    const busy = w({ id: 3, hostname: 'busy-1', status: 'busy', current_task: 'implement track 42' });
    const sorted = sortWorkersForStrip([idle1, idle2, busy]);
    expect(sorted[0].id).toBe(3);
  });

  it('treats a non-null current_task as active even if status has not flipped to busy yet', () => {
    const idle = w({ id: 1, hostname: 'idle-1' });
    const pending = w({ id: 2, hostname: 'pending-1', status: 'idle', current_task: 'implement track 42' });
    const sorted = sortWorkersForStrip([idle, pending]);
    expect(sorted[0].id).toBe(2);
  });

  it('within the same activity class, project workers sort before managers', () => {
    const manager = w({ id: 1, hostname: 'a-manager', type: 'manager' });
    const project = w({ id: 2, hostname: 'z-project', type: 'project' });
    const sorted = sortWorkersForStrip([manager, project]);
    expect(sorted[0].id).toBe(2);
  });

  it('stable tiebreak: hostname then worker_number', () => {
    const b2 = w({ id: 1, hostname: 'host-b', worker_number: 2 });
    const a1 = w({ id: 2, hostname: 'host-a', worker_number: 1 });
    const b1 = w({ id: 3, hostname: 'host-b', worker_number: 1 });
    const sorted = sortWorkersForStrip([b2, a1, b1]);
    expect(sorted.map(x => x.id)).toEqual([2, 3, 1]);
  });

  it('does not mutate the input array', () => {
    const list = [w({ id: 1, hostname: 'z' }), w({ id: 2, hostname: 'a' })];
    const copy = [...list];
    sortWorkersForStrip(list);
    expect(list).toEqual(copy);
  });
});
