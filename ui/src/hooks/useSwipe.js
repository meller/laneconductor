import { useRef, useCallback } from 'react';

const MIN_DISTANCE = 50;
const DIRECTION_RATIO = 1.5;

// Track 1121 Phase 2: single-axis swipe detection for lane navigation.
// A gesture only counts as a swipe when horizontal travel clearly
// dominates vertical travel and clears a minimum distance — otherwise a
// vertical scroll through a long lane would get hijacked as a lane change.
//
// Start coordinates live in a ref, not a closure variable, because a
// re-render between touchstart and touchend would otherwise hand the DOM
// element a fresh onTouchEnd closure with reset (0,0) start coordinates,
// silently breaking any gesture that spans a re-render.
export function useSwipe({ onSwipeLeft, onSwipeRight }) {
  const start = useRef({ x: 0, y: 0 });

  const onTouchStart = useCallback(e => {
    const touch = e.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onTouchEnd = useCallback(e => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.current.x;
    const dy = touch.clientY - start.current.y;
    if (Math.abs(dx) < MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
    if (dx < 0) onSwipeLeft?.();
    else onSwipeRight?.();
  }, [onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchEnd };
}
