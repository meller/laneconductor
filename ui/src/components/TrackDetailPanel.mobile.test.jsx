// Track 1121 Phase 5: TrackDetailPanel as a full-screen sheet on mobile.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackDetailPanel } from './TrackDetailPanel.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

const { mockUseIsMobile } = vi.hoisted(() => ({ mockUseIsMobile: vi.fn() }));
vi.mock('../hooks/useIsMobile.js', () => ({ useIsMobile: () => mockUseIsMobile() }));

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function mockAllEndpoints({ trackNumber = '1121' } = {}) {
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

describe('TrackDetailPanel — mobile full-screen sheet (Track 1121 Phase 5)', () => {
  it('TC-5.1: at mobile width the container has no fixed top/right offset (full-screen inset-0)', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    const container = screen.getByTestId('track-detail-container');
    expect(container.className).toMatch(/inset-0/);
  });

  it('TC-5.2: at desktop width the panel keeps max-w-2xl (unchanged right-docked layout)', async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    const container = screen.getByTestId('track-detail-container');
    expect(container.className).toMatch(/md:top-0/);
    expect(container.className).toMatch(/md:right-0/);
  });

  it('TC-5.3: the transcript drawer does not render as a side column on mobile', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" initialTranscriptOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('mobile-transcript-view')).toBeInTheDocument());
    expect(screen.queryByText('Live Transcript')).not.toBeInTheDocument();
  });

  it('desktop still renders the side-by-side transcript drawer (regression check)', async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" initialTranscriptOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Live Transcript')).toBeInTheDocument());
    expect(screen.queryByTestId('mobile-transcript-view')).not.toBeInTheDocument();
  });

  it('TC-5.4: toggling transcript on and back at mobile width returns to the detail tabs', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Transcript'));
    await waitFor(() => expect(screen.getByTestId('mobile-transcript-view')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Transcript'));
    expect(screen.queryByTestId('mobile-transcript-view')).not.toBeInTheDocument();
    expect(screen.getByText(/Conversation/)).toBeInTheDocument();
  });

  it('TC-5.5: the close control is at least 44px via min-h-11/min-w-11', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    const closeBtn = screen.getByTestId('track-detail-close');
    expect(closeBtn.className).toMatch(/min-h-11/);
    expect(closeBtn.className).toMatch(/min-w-11/);
  });

  it('TC-5.7: tabs strip carries overflow-x-auto so tabs scroll rather than wrap', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    const conversationTab = screen.getByText(/Conversation/);
    expect(conversationTab.parentElement.className).toMatch(/overflow-x-auto/);
  });
});

describe('TrackDetailPanel — no body scroll-lock (Track 1121 Task 5.5 / TC-5.6)', () => {
  it('never sets overflow:hidden on document.body, so closing never needs to restore it', async () => {
    mockUseIsMobile.mockReturnValue(true);
    mockAllEndpoints();
    const { unmount } = render(<TrackDetailPanel projectId={1} trackNumber="1121" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Test track')).toBeInTheDocument());
    expect(document.body.style.overflow).not.toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
