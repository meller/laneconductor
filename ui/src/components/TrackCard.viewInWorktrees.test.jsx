// TrackCard — "View in Worktrees" deep link, shown on every done-lane card
// so a human can jump straight to that track's row in the Worktrees panel.
//
// Track 10035: no longer gated by `worktree_class` — that field drove the
// old worktree_class-based UnmergedBadge/DoneLaneMergeActions split this
// track removed (REQ-9: lane_action_status is now the truth). The link is
// simple navigation, not a merge affordance, so it shows for every
// done-lane card regardless of whether a live unmerged branch exists.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function doneTrack(overrides = {}) {
  return {
    track_number: '1118',
    title: 'Manager Worker Credential Storage',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — View in Worktrees link', () => {
  it('shows a "View in Worktrees" link for a done track when the callback is provided', () => {
    render(<TrackCard track={doneTrack()} onViewInWorktrees={() => {}} />);
    expect(screen.getByText(/View in Worktrees/i)).toBeTruthy();
  });

  it('calls onViewInWorktrees with the track number, without also triggering the card click, when clicked', () => {
    const onViewInWorktrees = vi.fn();
    const onClick = vi.fn();
    render(<TrackCard track={doneTrack()} onViewInWorktrees={onViewInWorktrees} onClick={onClick} />);
    fireEvent.click(screen.getByText(/View in Worktrees/i));
    expect(onViewInWorktrees).toHaveBeenCalledWith('1118');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not show the link when no onViewInWorktrees callback is passed', () => {
    render(<TrackCard track={doneTrack()} />);
    expect(screen.queryByText(/View in Worktrees/i)).toBeNull();
  });

  it('does not show the link outside the done lane', () => {
    render(<TrackCard track={doneTrack({ lane_status: 'review', lane_action_status: 'queue' })} onViewInWorktrees={() => {}} />);
    expect(screen.queryByText(/View in Worktrees/i)).toBeNull();
  });

  it('shows the PR link alongside it for a done:waiting (pr-mode) track', () => {
    render(<TrackCard track={doneTrack({ lane_action_status: 'waiting', pr_url: 'https://github.com/org/repo/pull/42' })} onViewInWorktrees={() => {}} />);
    expect(screen.getByText(/PR open/i)).toBeTruthy();
    expect(screen.getByText(/View in Worktrees/i)).toBeTruthy();
  });
});
