import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile.js';

function mockMatchMedia(initialMatches) {
  let matches = initialMatches;
  let listener = null;
  const mql = {
    get matches() { return matches; },
    addEventListener: (_type, cb) => { listener = cb; },
    removeEventListener: (_type, cb) => { if (listener === cb) listener = null; },
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    setMatches(next) {
      matches = next;
      listener?.({ matches: next });
    },
    hasListener: () => listener !== null,
  };
}

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('TC-1.1a: returns true when the media query matches at mount', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('TC-1.1b: returns false when the media query does not match at mount', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('TC-1.2: updates when the media query list fires a change event', () => {
    const control = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => control.setMatches(true));
    expect(result.current).toBe(true);
  });

  it('TC-1.2b: removes its change listener on unmount', () => {
    const control = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(control.hasListener()).toBe(true);
    unmount();
    expect(control.hasListener()).toBe(false);
  });
});
