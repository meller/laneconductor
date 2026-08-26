// Follow-up to TrackCard.overflow.test.jsx: giving the left title block
// `min-w-0 flex-1` against a non-shrinking (`shrink-0`) right-hand badge
// column stopped the badges from being pushed off-screen, but it did so by
// letting the right column keep its full natural width unconditionally —
// on an Unmerged card (lane badge + Unmerged badge + Merge button + View
// in Worktrees link, several elements wide) that squeezes the title down
// to a handful of visible characters instead. The header row itself needs
// to wrap so the right-hand column can drop to its own line when there
// isn't room, rather than stealing width from the title.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function unmergedDoneTrack(overrides = {}) {
  return {
    track_number: '1119',
    title: 'App Creator Wizard',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    worktree_class: 'mergeable',
    worktree_branch: 'track-1119',
    human_needs_reply: true,
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — header row wraps instead of squeezing the title', () => {
  it('the header row allows wrapping so a wide right-hand badge column drops to its own line', () => {
    render(<TrackCard track={unmergedDoneTrack()} />);
    const header = screen.getByTestId('track-card-header-left').parentElement;
    expect(header.className).toMatch(/\bflex-wrap\b/);
  });

  it('gives the title block a real minimum width floor, not min-w-0', () => {
    // flex-wrap alone doesn't force a wrap: with a `flex-1` left item whose
    // flex-basis collapses to 0% and a `shrink-0` right item, the browser's
    // line-fit check only ever sees the right item's width against the
    // container — that "fits" on one line by itself, so it never wraps;
    // flex-grow then just squeezes the title into whatever's left on that
    // single line. Confirmed live: title rendered at 33px wide with
    // min-w-0. A real min-width floor makes the left item's own
    // hypothetical size large enough that the pair genuinely overflows the
    // line, which is what actually triggers the right block to wrap below.
    render(<TrackCard track={unmergedDoneTrack()} />);
    const left = screen.getByTestId('track-card-header-left');
    expect(left.className).not.toMatch(/\bmin-w-0\b/);
    expect(left.className).toMatch(/min-w-\[/);
  });
});
