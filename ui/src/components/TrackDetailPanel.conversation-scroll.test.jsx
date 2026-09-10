// ui/src/components/TrackDetailPanel.conversation-scroll.test.jsx
// Track 1094: the Conversation tab polls comments every 2s. Before this fix,
// the auto-scroll-to-bottom effect fired on every poll tick — even when the
// comment count hadn't changed — because a fresh fetch().json() always
// produces a new array reference, and the effect depended on that reference
// alone. That yanked a user reading history back to the bottom on a ~2s
// cycle. The fix (TrackDetailPanel.jsx, the effect around `comments`/`tab`)
// gates the scroll on the comment count actually growing (or the tab having
// just been opened), and additionally only auto-scrolls on new content when
// the user was already near the bottom.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TrackDetailPanel } from './TrackDetailPanel.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function makeComments(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    author: 'human',
    body: `Comment ${i + 1}`,
    created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }));
}

// jsdom doesn't implement scrollIntoView.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function mockEndpoints({ trackNumber = '1094', commentsRef }) {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((url) => {
    if (url.endsWith(`/tracks/${trackNumber}`)) {
      return jsonResponse({ id: 1, track_number: trackNumber, title: 'Test track', lane_status: 'implement', progress_percent: 10 });
    }
    if (url.includes('/transcript')) return jsonResponse({ events: [] });
    if (url.includes('/members')) return jsonResponse([]);
    if (url.includes('/workers')) return jsonResponse([]);
    if (url.includes('/comments')) return jsonResponse(commentsRef.current);
    if (url.includes('/worktrees')) return jsonResponse([]);
    return jsonResponse({});
  });
}

describe('TrackDetailPanel — Conversation tab auto-scroll (Track 1094)', () => {
  it('TC-1: auto-scrolls to bottom on first opening the Conversation tab', async () => {
    const commentsRef = { current: makeComments(3) };
    mockEndpoints({ commentsRef });

    render(<TrackDetailPanel projectId={1} trackNumber="1094" onClose={() => {}} />);

    // Comments exist, so the panel auto-switches to the Conversation tab.
    await waitFor(() => expect(screen.getByText('Comment 3')).toBeInTheDocument());
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('TC-2: does not re-scroll on a poll tick where the comment count is unchanged', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const commentsRef = { current: makeComments(3) };
    mockEndpoints({ commentsRef });

    render(<TrackDetailPanel projectId={1} trackNumber="1094" onClose={() => {}} />);

    await vi.waitFor(() => expect(screen.getByText('Comment 3')).toBeInTheDocument());
    const callsAfterOpen = Element.prototype.scrollIntoView.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(0);

    // Same comment count is returned every 2s. A fresh array reference is
    // still a new object identity, which is exactly what broke this before.
    commentsRef.current = makeComments(3);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(Element.prototype.scrollIntoView.mock.calls.length).toBe(callsAfterOpen);
  });

  it('TC-3: auto-scrolls when a genuinely new comment arrives and the user is near the bottom', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const commentsRef = { current: makeComments(3) };
    mockEndpoints({ commentsRef });

    render(<TrackDetailPanel projectId={1} trackNumber="1094" onClose={() => {}} />);
    await vi.waitFor(() => expect(screen.getByText('Comment 3')).toBeInTheDocument());
    const callsAfterOpen = Element.prototype.scrollIntoView.mock.calls.length;

    commentsRef.current = makeComments(4);
    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => expect(screen.getByText('Comment 4')).toBeInTheDocument());
    expect(Element.prototype.scrollIntoView.mock.calls.length).toBeGreaterThan(callsAfterOpen);
  });

  it('TC-4: does not steal scroll position when a new comment arrives while the user has scrolled up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const commentsRef = { current: makeComments(3) };
    mockEndpoints({ commentsRef });

    const { container } = render(<TrackDetailPanel projectId={1} trackNumber="1094" onClose={() => {}} />);
    await vi.waitFor(() => expect(screen.getByText('Comment 3')).toBeInTheDocument());
    const callsAfterOpen = Element.prototype.scrollIntoView.mock.calls.length;

    // Simulate the user having scrolled up, away from the bottom.
    const scrollEl = container.querySelector('.overflow-y-auto');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollEl, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(scrollEl);

    commentsRef.current = makeComments(4);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(screen.getByText('Comment 4')).toBeInTheDocument());

    expect(Element.prototype.scrollIntoView.mock.calls.length).toBe(callsAfterOpen);
  });
});
