// Found live on track 1118: the header row (`flex items-start justify-between`)
// has a left block (badges + title) and a right block (lane badge, Unmerged
// badge, Merge button) with `shrink-0` — neither side can shrink below its
// content size, so a track with a long title plus several badges pushes the
// right block's content past the visible edge of the (narrow) Kanban card.
// Confirmed via getBoundingClientRect() in a real browser: the Unmerged badge
// and Merge button were `display:block; visibility:visible; opacity:1` —
// correctly rendered, just positioned off-screen. jsdom doesn't implement
// real layout, so this can't be asserted via bounding rects here; asserting
// the Tailwind classes that produce the fix (the left block can shrink,
// its badge row wraps instead of forcing width) is the meaningful check
// available in this environment.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function longDoneTrack(overrides = {}) {
  return {
    track_number: '1118',
    title: 'A genuinely long track title that, combined with several badges, is exactly what pushed the merge button off-screen',
    project_name: 'laneconductor',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    workspace_mode: 'branch',
    worktree_branch: 'track-1118',
    worktree_class: 'mergeable',
    human_needs_reply: true,
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — header overflow (track 1118 shape)', () => {
  it('lets the left title/badges block shrink (flex-1) instead of forcing the right-hand badges off the card', () => {
    render(<TrackCard track={longDoneTrack()} />);
    const left = screen.getByTestId('track-card-header-left');
    expect(left.className).toMatch(/\bflex-1\b/);
  });

  it('wraps the left badge row instead of holding it to one non-shrinking line', () => {
    render(<TrackCard track={longDoneTrack()} />);
    const badgeRow = screen.getByTestId('track-card-badges-row');
    expect(badgeRow.className).toMatch(/\bflex-wrap\b/);
  });
});
