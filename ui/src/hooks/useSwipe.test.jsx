import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSwipe } from './useSwipe.js';

function touch(x, y) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] };
}

function fire(handlers, startX, startY, endX, endY) {
  handlers.onTouchStart({ touches: [{ clientX: startX, clientY: startY }] });
  handlers.onTouchEnd({ changedTouches: [{ clientX: endX, clientY: endY }] });
}

describe('useSwipe', () => {
  it('TC-2.4: fires onSwipeLeft for dx=-80, dy=10', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeLeft, onSwipeRight }));
    fire(result.current, 200, 100, 120, 110);
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('TC-2.5: does not fire for dx=-30 (below the 50px minimum)', () => {
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeLeft }));
    fire(result.current, 200, 100, 170, 100);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('TC-2.6: does not fire for dx=-60, dy=90 (vertical dominates)', () => {
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeLeft }));
    fire(result.current, 200, 100, 140, 190);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('fires onSwipeRight for a positive dx', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipe({ onSwipeRight }));
    fire(result.current, 100, 100, 200, 105);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('survives a re-render between touchstart and touchend (start coords in a ref, not a closure var)', () => {
    const onSwipeLeft = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useSwipe({ onSwipeLeft: cb }),
      { initialProps: { cb: onSwipeLeft } }
    );
    result.current.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] });
    // Simulate an unrelated re-render (e.g. props identity change) between
    // touchstart and touchend — a closure-variable implementation would
    // reset start coordinates to (0,0) here and misfire.
    const secondCb = vi.fn();
    rerender({ cb: secondCb });
    result.current.onTouchEnd({ changedTouches: [{ clientX: 120, clientY: 105 }] });
    expect(secondCb).toHaveBeenCalledTimes(1);
  });
});
