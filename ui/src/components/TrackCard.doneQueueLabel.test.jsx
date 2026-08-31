// TrackCard — done-lane "queued for merge" indicator must stay a short,
// single-line badge, matching every other status badge on this card
// (short visible label + a title tooltip for the full explanation).
//
// Found live: the full sentence "Unmerged — queued for the merge action"
// (39 chars) was rendered as the badge's own visible text with no width
// constraint or truncation. In a narrow Kanban card the span wraps across
// 4-5 lines, making the badge look like an oversized, broken block instead
// of the compact one-line indicator every other badge on this card is.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function queuedDoneTrack(overrides = {}) {
  return {
    track_number: '10040',
    title: 'Manager Stuck Track Healing',
    lane_status: 'done',
    lane_action_status: 'queue',
    track_type: 'dev',
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — done-lane queued indicator stays compact', () => {
  it('shows a short "Unmerged" label, not the full sentence, as the visible badge text', () => {
    render(<TrackCard track={queuedDoneTrack()} />);
    expect(screen.queryByText('Unmerged — queued for the merge action')).toBeNull();
    expect(screen.getByText('Unmerged')).toBeTruthy();
  });

  it('keeps the full explanation available as a tooltip', () => {
    render(<TrackCard track={queuedDoneTrack()} />);
    const badge = screen.getByText('Unmerged').closest('div');
    expect(badge.title).toMatch(/queued for the merge action/i);
  });

  it('still shows the original short label for a non-done lane', () => {
    render(<TrackCard track={queuedDoneTrack({ lane_status: 'plan' })} />);
    expect(screen.getByText('Queued for automation')).toBeTruthy();
  });
});
