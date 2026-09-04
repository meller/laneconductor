import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MobileFocusView } from './MobileFocusView.jsx';

vi.mock('../hooks/useApi.js', () => ({
  useApi: () => ({ apiFetch: mockApiFetch }),
}));

let mockApiFetch;

const TRACKS = [
  { id: 1, project_id: 1, track_number: '001', title: 'Alpha', lane_status: 'implement', lane_action_status: 'running' },
  { id: 2, project_id: 1, track_number: '002', title: 'Beta', lane_status: 'review', lane_action_status: 'queue' },
  { id: 3, project_id: 1, track_number: '003', title: 'Gamma', lane_status: 'done', lane_action_status: 'success' },
];

function inboxResponse(items) {
  return { ok: true, json: async () => items };
}

beforeEach(() => {
  mockApiFetch = vi.fn();
});

describe('MobileFocusView', () => {
  it('TC-4.1 / TC-4.2: lists rows whose bucket is needs_input or awaiting_ai under Needs your input', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([
      { project_id: 1, track_number: '010', title: 'Needs review', bucket: 'needs_input' },
      { project_id: 1, track_number: '011', title: 'Waiting on AI', bucket: 'awaiting_ai' },
      { project_id: 1, track_number: '012', title: 'FYI only', bucket: 'recent_activity' },
    ]));
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={() => {}} onGoToLane={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('focus-needs-input-010')).toBeInTheDocument());
    expect(screen.getByTestId('focus-needs-input-011')).toBeInTheDocument();
    expect(screen.queryByTestId('focus-needs-input-012')).not.toBeInTheDocument();
  });

  it('TC-4.4: does not re-derive severity from comment text — a recent_activity-bucketed row with a ⚠️ body stays out of Needs your input', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([
      { project_id: 1, track_number: '020', title: 'Looks alarming but is not', bucket: 'recent_activity', last_comment_body: '⚠️ this looks urgent' },
    ]));
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={() => {}} onGoToLane={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('focus-needs-input-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('focus-needs-input-020')).not.toBeInTheDocument();
  });

  it('TC-4.5: Running now lists exactly the tracks with lane_action_status running', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([]));
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={() => {}} onGoToLane={() => {}} />);

    expect(screen.getByTestId('focus-running-001')).toBeInTheDocument();
    expect(screen.queryByTestId('focus-running-002')).not.toBeInTheDocument();
    expect(screen.queryByTestId('focus-running-003')).not.toBeInTheDocument();
  });

  it('TC-4.6: pipeline summary shows one row per lane with the correct count', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([]));
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={() => {}} onGoToLane={() => {}} />);

    const implementRow = screen.getByTestId('focus-pipeline-implement');
    expect(implementRow).toHaveTextContent('1');
    const backlogRow = screen.getByTestId('focus-pipeline-backlog');
    expect(backlogRow).toHaveTextContent('0');
  });

  it('TC-4.7: tapping a pipeline lane row calls onGoToLane with that lane id', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([]));
    const onGoToLane = vi.fn();
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={() => {}} onGoToLane={onGoToLane} />);

    fireEvent.click(screen.getByTestId('focus-pipeline-review'));
    expect(onGoToLane).toHaveBeenCalledWith('review');
  });

  it('TC-4.8: tapping a Needs your input row calls onSelectTrack with project/track and conversation intent', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([
      { project_id: 1, track_number: '030', title: 'Pick me', bucket: 'needs_input' },
    ]));
    const onSelectTrack = vi.fn();
    render(<MobileFocusView projectId={1} tracks={TRACKS} onSelectTrack={onSelectTrack} onGoToLane={() => {}} />);

    await waitFor(() => screen.getByTestId('focus-needs-input-030'));
    fireEvent.click(screen.getByTestId('focus-needs-input-030'));
    expect(onSelectTrack).toHaveBeenCalledWith(1, '030', expect.objectContaining({ conversation: true }));
  });

  it('TC-4.9: empty needs-input and running sections read as reassurance, not error', async () => {
    mockApiFetch.mockResolvedValue(inboxResponse([]));
    render(<MobileFocusView projectId={1} tracks={[]} onSelectTrack={() => {}} onGoToLane={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('focus-needs-input-empty')).toHaveTextContent(/nothing needs you/i));
    expect(screen.getByTestId('focus-running-empty')).toHaveTextContent(/no lane actions running/i);
  });
});
