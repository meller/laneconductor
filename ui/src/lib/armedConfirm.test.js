// ui/src/lib/armedConfirm.test.js
// Track 1114 Phase 7: previously untested armed-confirm behavior — the
// two-step in-DOM confirm that replaced window.confirm() (found live: a
// real click on Remove Worktree produced zero dispatch and zero feedback).
import { describe, it, expect } from 'vitest';
import { nextArmedState } from './armedConfirm.js';

describe('nextArmedState', () => {
  it('arms the key on a first click — does not fire', () => {
    const { armedKey, shouldFire } = nextArmedState(null, 'remove:1065');
    expect(armedKey).toBe('remove:1065');
    expect(shouldFire).toBe(false);
  });

  it('fires and disarms on a second click of the same armed key', () => {
    const { armedKey, shouldFire } = nextArmedState('remove:1065', 'remove:1065');
    expect(armedKey).toBe(null);
    expect(shouldFire).toBe(true);
  });

  it('re-arms to a different key instead of firing, when another key is already armed', () => {
    const { armedKey, shouldFire } = nextArmedState('remove:1065', 'force:1067');
    expect(armedKey).toBe('force:1067');
    expect(shouldFire).toBe(false);
  });

  it('re-arming a different row does not accidentally fire the previously armed row\'s action', () => {
    // Regression guard: two rows' keys must never be treated as equal just
    // because both actions are of the "destructive, needs confirm" kind.
    const first = nextArmedState(null, 'remove:1065');
    const second = nextArmedState(first.armedKey, 'remove:1067');
    expect(second.shouldFire).toBe(false);
    expect(second.armedKey).toBe('remove:1067');
  });
});
