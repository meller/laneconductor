import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LaneFocusView } from './LaneFocusView.jsx';
import { LANES } from './KanbanBoard.jsx';

function track(overrides = {}) {
  return {
    id: 1,
    track_number: '001',
    title: 'Some track',
    lane_status: 'implement',
    lane_action_status: 'waiting',
    track_type: 'dev',
    progress_percent: 10,
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    projectId: 1,
    tracks: [],
    focusedLane: 'implement',
    onFocusLane: vi.fn(),
    onBackToBoard: vi.fn(),
    onTrackClick: vi.fn(),
    onLaneChange: vi.fn(),
    ...overrides,
  };
}

describe('LaneFocusView', () => {
  it('TC-2.3: renders all six lanes with correct counts', () => {
    const tracks = [
      track({ track_number: '1', lane_status: 'backlog' }),
      track({ track_number: '2', lane_status: 'backlog' }),
      track({ track_number: '3', lane_status: 'implement' }),
    ];
    render(<LaneFocusView {...baseProps({ tracks })} />);
    for (const lane of LANES) {
      const expected = tracks.filter(t => t.lane_status === lane.id).length;
      const btn = screen.getByRole('button', { name: new RegExp(`${lane.label} \\(${expected}\\)`) });
      expect(btn).toBeInTheDocument();
    }
  });

  it('TC-2.9: "All lanes" carries hidden md:inline-flex (hidden below md, present at md+)', () => {
    render(<LaneFocusView {...baseProps()} />);
    const btn = screen.getByText('← All lanes');
    expect(btn.className).toMatch(/hidden/);
    expect(btn.className).toMatch(/md:inline-flex/);
  });

  it('TC-2.10: the pinned lane indicator reflects the focused lane position', () => {
    render(<LaneFocusView {...baseProps({ focusedLane: 'review' })} />);
    const indicator = screen.getByTestId('lane-position-indicator');
    const reviewIndex = LANES.findIndex(l => l.id === 'review') + 1;
    expect(indicator).toHaveTextContent(`${reviewIndex} / ${LANES.length}`);
  });

  it('swiping left on the card area advances to the next lane', () => {
    const onFocusLane = vi.fn();
    const tracks = [track({ lane_status: 'implement' })];
    render(<LaneFocusView {...baseProps({ tracks, focusedLane: 'implement', onFocusLane })} />);
    const cardArea = screen.getByTestId('lane-card-area');
    fireEvent.touchStart(cardArea, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(cardArea, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(onFocusLane).toHaveBeenCalledWith('review');
  });

  it('TC-2.7: swiping left on the last lane (done) does not wrap to backlog', () => {
    const onFocusLane = vi.fn();
    render(<LaneFocusView {...baseProps({ focusedLane: 'done', onFocusLane })} />);
    const cardArea = screen.getByTestId('lane-card-area');
    fireEvent.touchStart(cardArea, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(cardArea, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(onFocusLane).not.toHaveBeenCalled();
  });

  it('TC-2.8: swiping right on the first lane (backlog) does not wrap to done', () => {
    const onFocusLane = vi.fn();
    render(<LaneFocusView {...baseProps({ focusedLane: 'backlog', onFocusLane })} />);
    const cardArea = screen.getByTestId('lane-card-area');
    fireEvent.touchStart(cardArea, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(cardArea, { changedTouches: [{ clientX: 300, clientY: 105 }] });
    expect(onFocusLane).not.toHaveBeenCalled();
  });

  it('TC-2.1 (grid columns): single column below sm, matching the mobile-legible-cards requirement', () => {
    const tracks = [track()];
    render(<LaneFocusView {...baseProps({ tracks })} />);
    const cardArea = screen.getByTestId('lane-card-area');
    expect(cardArea.className).toMatch(/grid-cols-1/);
    expect(cardArea.className).toMatch(/sm:grid-cols-2/);
    expect(cardArea.className).toMatch(/md:grid-cols-3/);
  });
});
