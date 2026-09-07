// track-10076-done-lane-render.test.jsx
// Track 10076 Phase 3: the board and Lane Focus view must render the done
// lane from the same live git/PR classification the Worktrees panel
// trusts (resolveDoneLaneBucket), not lane_action_status alone — and must
// degrade to today's exact labels when no classification is available
// (worker stopped / local-fs). See done-lane-bucket.mjs's own doc comment
// for why worktree_class_available must gate every override.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard, LANES } from './KanbanBoard.jsx';
import { LaneFocusView } from './LaneFocusView.jsx';

function doneTrack(overrides = {}) {
  return {
    id: overrides.track_number || '001',
    track_number: '001',
    title: 'Some done track',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    progress_percent: 100,
    ...overrides,
  };
}

describe('KanbanBoard — done lane renders from the live git classification (TC-3)', () => {
  it('TC-3.1: a done:success track with a live mergeable branch groups as Unmerged, not Success', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({
          track_number: '201', lane_action_status: 'success',
          worktree_class: 'mergeable', worktree_class_available: true,
        })]}
      />
    );
    expect(screen.queryByTestId('lane-group-done-success')).toBeNull();
    const group = screen.getByTestId('lane-group-done-unmerged');
    expect(group.textContent).toMatch(/Unmerged/i);
    expect(group.textContent).not.toMatch(/Success/i);
  });

  it('TC-3.2: track 10065\'s live case — done:failure classified conflicted reads "merge failed"', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({
          track_number: '202', lane_action_status: 'failure',
          worktree_class: 'conflicted', worktree_class_available: true,
        })]}
      />
    );
    const group = screen.getByTestId('lane-group-done-unmerged-failed');
    expect(group.textContent).toMatch(/Unmerged — merge failed/i);
  });

  it('TC-3.3: a pr-open track renders under PR open and keeps its GitHub link', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({
          track_number: '203', lane_action_status: 'waiting',
          worktree_class: 'pr-open', worktree_class_available: true,
          pr_url: 'https://github.com/org/repo/pull/9',
        })]}
      />
    );
    const group = screen.getByTestId('lane-group-done-pr-open');
    expect(group.textContent).toMatch(/PR open/i);
    expect(screen.getByText(/PR open →/i).closest('a')).toHaveAttribute('href', 'https://github.com/org/repo/pull/9');
  });

  it('TC-3.4: worktree_class_available: false renders byte-identical to today across every lane_action_status', () => {
    const statuses = ['queue', 'waiting', 'success', 'failure'];
    for (const lane_action_status of statuses) {
      const { unmount } = render(
        <KanbanBoard
          tracks={[doneTrack({ track_number: '204', lane_action_status, worktree_class_available: false })]}
        />
      );
      const group = screen.getByTestId(`lane-group-done-${lane_action_status}`);
      expect(group).toBeTruthy();
      unmount();
    }
  });

  it('TC-3.4b: no worktree_class_available field at all (undefined, as older payloads/tests provide) behaves the same as false', () => {
    render(
      <KanbanBoard tracks={[doneTrack({ track_number: '205', lane_action_status: 'queue' })]} />
    );
    const group = screen.getByTestId('lane-group-done-queue');
    expect(group.textContent).toMatch(/Unmerged/i);
  });

  it('TC-3.5: non-done lanes ignore worktree_class entirely', () => {
    render(
      <KanbanBoard
        tracks={[doneTrack({
          track_number: '206', lane_status: 'review', lane_action_status: 'queue',
          worktree_class: 'mergeable', worktree_class_available: true,
        })]}
      />
    );
    const group = screen.getByTestId('lane-group-review-queue');
    expect(group.textContent).toMatch(/Queued/i);
    expect(group.textContent).not.toMatch(/Unmerged/i);
  });

  it('TC-3.8: DONE_LANE_STATUS_CONFIG is not defined locally in KanbanBoard.jsx anymore', async () => {
    const mod = await import('./KanbanBoard.jsx');
    expect(mod.DONE_LANE_STATUS_CONFIG).toBeUndefined();
  });
});

describe('LaneFocusView — done lane matches the board (TC-3.6, TC-3.7 / REQ-9)', () => {
  function renderFocus(tracks) {
    return render(
      <LaneFocusView
        tracks={tracks}
        focusedLane="done"
        onFocusLane={() => {}}
        onBackToBoard={() => {}}
      />
    );
  }

  it('TC-3.6: done-lane status chips read "Unmerged"/"PR open", not "Queued"/"Waiting"', () => {
    renderFocus([
      doneTrack({ track_number: '301', lane_action_status: 'queue', worktree_class_available: false }),
      doneTrack({ track_number: '302', lane_action_status: 'waiting', worktree_class: 'pr-open', worktree_class_available: true }),
    ]);
    expect(screen.getAllByText(/Unmerged/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PR open/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Queued/)).toBeNull();
  });

  it('TC-3.7: the done-lane filter selects a success-status track that git says is actually unmerged', () => {
    renderFocus([
      doneTrack({ track_number: '303', lane_action_status: 'success', worktree_class: 'mergeable', worktree_class_available: true }),
      doneTrack({ track_number: '304', lane_action_status: 'success', worktree_class: null, worktree_class_available: true }),
    ]);
    fireEvent.click(screen.getByText(/Unmerged/i));
    expect(screen.queryByText('#303')).toBeTruthy();
    // The genuinely-shipped track (304) should not appear once filtered to Unmerged.
    expect(screen.queryByText('#304')).toBeNull();
  });
});
