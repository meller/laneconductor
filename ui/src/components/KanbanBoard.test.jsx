// KanbanBoard — Done lane groups.
//
// Track 10035: every lane already sub-groups its cards by
// lane_action_status (waiting/queue/running/success/failure); the done
// lane used to further split its "success" bucket by worktree_class (a
// live-git cross-reference) into "unmerged"/"success", back when
// done:success was set at quality-gate exit before anything actually
// merged. Now done:success means actually shipped (REQ-1/REQ-7), so
// lane_action_status alone carries the truth (REQ-9): done:queue renders
// as "Unmerged" (waiting for the merge action), done:waiting renders as
// "PR open" (waiting for human review on GitHub), done:success is
// genuinely finished.
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

describe('KanbanBoard — Done lane groups', () => {
  it('renders a done:queue track under the "Unmerged" lane-group section, not "Queued"', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '101', lane_action_status: 'queue' })]}
      />
    );
    const group = screen.getByTestId('lane-group-done-queue');
    expect(group).toBeTruthy();
    expect(group.textContent).toMatch(/Unmerged/i);
  });

  it('renders a done:waiting track under the "PR open" lane-group section, not the generic "Waiting"', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '102', lane_action_status: 'waiting', pr_url: 'https://github.com/org/repo/pull/1' })]}
      />
    );
    const group = screen.getByTestId('lane-group-done-waiting');
    expect(group).toBeTruthy();
    expect(group.textContent).toMatch(/PR open/i);
  });

  it('does not relabel queue/waiting on non-done lanes', () => {
    render(
      <KanbanBoard
        tracks={[
          doneTrack({ track_number: '103', lane_status: 'review', lane_action_status: 'queue' }),
        ]}
      />
    );
    const group = screen.getByTestId('lane-group-review-queue');
    expect(group.textContent).toMatch(/Queued/i);
    expect(group.textContent).not.toMatch(/Unmerged/i);
  });

  it('groups a genuinely shipped done:success track under plain "Success", same as any other lane', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '104', lane_action_status: 'success' })]}
      />
    );
    const group = screen.getByTestId('lane-group-done-success');
    expect(group.textContent).toMatch(/Success/i);
  });

  it('forwards onViewInWorktrees down to the card and calls it with the track number', () => {
    const onViewInWorktrees = vi.fn();
    render(
      <KanbanBoard
        tracks={[doneTrack({ track_number: '1118', lane_action_status: 'queue' })]}
        onViewInWorktrees={onViewInWorktrees}
      />
    );
    fireEvent.click(screen.getByText(/View in Worktrees/i));
    expect(onViewInWorktrees).toHaveBeenCalledWith('1118');
  });
});
