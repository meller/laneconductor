// KanbanBoard — Done lane unmerged/success split.
//
// Every lane already sub-groups its cards by lane_action_status
// (waiting/queue/running/success/failure). The Done lane specifically
// conflates two very different things under "success": a track whose
// branch is still sitting unmerged (worktree_class set) and one that's
// genuinely finished (merged or never had a branch). Splits the done
// lane's "success" bucket into "unmerged" and "success" so the board
// surfaces the difference the same way it already surfaces queue/running.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from './KanbanBoard.jsx';

function doneTrack(overrides = {}) {
  return {
    id: 1,
    track_number: '001',
    title: 'Some done track',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    progress_percent: 100,
    ...overrides,
  };
}

describe('KanbanBoard — Done lane unmerged/success split', () => {
  it('groups a done track with a live unmerged branch under the "unmerged" lane-group section, not "success"', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '101', worktree_class: 'mergeable' })]}
      />
    );
    expect(screen.getByTestId('lane-group-done-unmerged')).toBeTruthy();
    expect(screen.queryByTestId('lane-group-done-success')).toBeNull();
  });

  it('groups a done track with no live branch under the "success" lane-group section, not "unmerged"', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '102', worktree_class: null })]}
      />
    );
    expect(screen.getByTestId('lane-group-done-success')).toBeTruthy();
    expect(screen.queryByTestId('lane-group-done-unmerged')).toBeNull();
  });

  it('does not introduce an "unmerged" lane-group section on non-done lanes', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({
          track_number: '103', lane_status: 'review', worktree_class: 'mergeable',
        })]}
      />
    );
    expect(screen.queryByTestId('lane-group-review-unmerged')).toBeNull();
  });

  it('forwards onViewInWorktrees down to the card and calls it with the track number', () => {
    const onViewInWorktrees = vi.fn();
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '1118', worktree_class: 'mergeable' })]}
        onViewInWorktrees={onViewInWorktrees}
      />
    );
    fireEvent.click(screen.getByText(/View in Worktrees/i));
    expect(onViewInWorktrees).toHaveBeenCalledWith('1118');
  });
});
