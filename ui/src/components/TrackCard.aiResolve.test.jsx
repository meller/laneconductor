// TrackCard — AI Resolve action for conflicted done-lane tracks.
//
// A `conflicted` card used to render a permanently disabled "Merge to
// main" placeholder pointing at `lc worktrees merge` — a CLI command —
// even though the exact same AI-assisted conflict resolution
// (`ai-resolve-conflict` dispatch) already exists and works from the
// Worktrees panel. Mirrors that action here instead of inventing a new
// pattern, same as the existing merge/create-pr/merge-pr actions do.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function conflictedDoneTrack(overrides = {}) {
  return {
    track_number: '1118',
    title: 'Manager Worker Credential Storage',
    lane_status: 'done',
    lane_action_status: 'success',
    track_type: 'dev',
    worktree_class: 'conflicted',
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — AI Resolve for conflicted tracks', () => {
  it('renders an AI Resolve button instead of a disabled placeholder', () => {
    render(<TrackCard track={conflictedDoneTrack()} />);
    expect(screen.getByRole('button', { name: /AI Resolve/i })).toBeTruthy();
    expect(screen.queryByText('Merge to main')).toBeNull();
  });

  it('dispatches ai-resolve-conflict with the track number when clicked', () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<TrackCard track={conflictedDoneTrack()} projectId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /AI Resolve/i }));
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/dispatch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'ai-resolve-conflict', payload: { track_number: '1118' } }),
      })
    );
  });

  it('does not show AI Resolve for a plain mergeable track', () => {
    render(<TrackCard track={conflictedDoneTrack({ worktree_class: 'mergeable' })} />);
    expect(screen.queryByRole('button', { name: /AI Resolve/i })).toBeNull();
  });
});
