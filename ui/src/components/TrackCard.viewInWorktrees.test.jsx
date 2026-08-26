// TrackCard — "View in Worktrees" deep link (companion to the existing
// inline Merge-to-main/Create-PR actions, kept per explicit direction: the
// inline action stays for the fast path, this link is an additional way to
// jump straight to the same track's row in the Worktrees panel).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function unmergedDoneTrack(overrides = {}) {
  return {
    track_number: '1118',
    title: 'Manager Worker Credential Storage',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    worktree_class: 'mergeable',
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — View in Worktrees link', () => {
  it('shows a "View in Worktrees" link for an unmerged done track when the callback is provided', () => {
    render(<TrackCard track={unmergedDoneTrack()} onViewInWorktrees={() => {}} />);
    expect(screen.getByText(/View in Worktrees/i)).toBeTruthy();
  });

  it('calls onViewInWorktrees with the track number, without also triggering the card click, when clicked', () => {
    const onViewInWorktrees = vi.fn();
    const onClick = vi.fn();
    render(<TrackCard track={unmergedDoneTrack()} onViewInWorktrees={onViewInWorktrees} onClick={onClick} />);
    fireEvent.click(screen.getByText(/View in Worktrees/i));
    expect(onViewInWorktrees).toHaveBeenCalledWith('1118');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not show the link when no onViewInWorktrees callback is passed', () => {
    render(<TrackCard track={unmergedDoneTrack()} />);
    expect(screen.queryByText(/View in Worktrees/i)).toBeNull();
  });

  it('does not show the link for a done track with no live unmerged branch', () => {
    render(<TrackCard track={unmergedDoneTrack({ worktree_class: null })} onViewInWorktrees={() => {}} />);
    expect(screen.queryByText(/View in Worktrees/i)).toBeNull();
  });

  it('still renders the existing inline merge action alongside the new link', () => {
    render(<TrackCard track={unmergedDoneTrack()} onViewInWorktrees={() => {}} />);
    expect(screen.getByText('Merge to main')).toBeTruthy();
    expect(screen.getByText(/View in Worktrees/i)).toBeTruthy();
  });
});
