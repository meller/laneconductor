// ui/src/components/TrackDetailPanel.test.jsx
// Track 10024: arriving at TrackDetailPanel via the Worktrees panel's running-row
// link should auto-open Phase 4's Live Transcript drawer, without ever force-
// closing a drawer the user opened/collapsed themselves. `initialTranscriptOpen`
// only ever sets the drawer open — every other entry point (Kanban, Inbox,
// Workers, WorkerActivityLatch) omits the prop and keeps today's closed default.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackDetailPanel } from './TrackDetailPanel.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function mockAllEndpoints({ trackNumber = '10024' } = {}) {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((url) => {
    if (url.endsWith(`/tracks/${trackNumber}`)) {
      return jsonResponse({ id: 1, track_number: trackNumber, title: 'Test track', lane_status: 'implement', progress_percent: 10 });
    }
    if (url.includes('/transcript')) return jsonResponse({ events: [] });
    if (url.includes('/members')) return jsonResponse([]);
    if (url.includes('/workers')) return jsonResponse([]);
    if (url.includes('/comments')) return jsonResponse([]);
    if (url.includes('/worktrees')) return jsonResponse([]);
    return jsonResponse({});
  });
}

describe('TrackDetailPanel — initialTranscriptOpen (Track 10024)', () => {
  it('TC-12: renders with the Live Transcript drawer open when initialTranscriptOpen is set', async () => {
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="10024" initialTranscriptOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Live Transcript')).toBeInTheDocument());
  });

  it('TC-13: renders with the drawer closed by default (existing entry points unaffected)', async () => {
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="10024" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    expect(screen.queryByText('Live Transcript')).toBeNull();
  });

  it('TC-14: manually collapsing the drawer after auto-open keeps it collapsed on re-render', async () => {
    mockAllEndpoints();
    const { rerender } = render(<TrackDetailPanel projectId={1} trackNumber="10024" initialTranscriptOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Live Transcript')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Collapse transcript'));
    expect(screen.queryByText('Live Transcript')).toBeNull();

    // Re-render with the exact same props (as a parent re-render would do) —
    // the drawer must not reopen itself.
    rerender(<TrackDetailPanel projectId={1} trackNumber="10024" initialTranscriptOpen onClose={() => {}} />);
    expect(screen.queryByText('Live Transcript')).toBeNull();
  });
});
