// Track 10069 Phase 6 (REQ-9..REQ-11): Queued intervention semantics
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ChatView } from './ChatView.jsx';

let wsCallbacks = [];
vi.mock('../hooks/useWebSocket.js', () => ({
  useWebSocket: (cb) => {
    wsCallbacks.push(cb);
  },
}));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function busyWorker(overrides = {}) {
  return {
    id: 2,
    hostname: 'host-a',
    type: 'project',
    project_id: 1,
    status: 'busy',
    current_task: 'implement track 42',
    last_track_number: null,
    last_track_project_id: null,
    ...overrides,
  };
}

function idleWorker(overrides = {}) {
  return {
    id: 3,
    hostname: 'host-b',
    type: 'project',
    project_id: 1,
    status: 'idle',
    current_task: null,
    last_track_number: '42',
    last_track_project_id: 1,
    ...overrides,
  };
}

beforeEach(() => {
  wsCallbacks = [];
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path) => {
    if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
    return jsonResponse([]);
  });
});

describe('ChatView queued intervention semantics (Phase 6, REQ-9..REQ-11)', () => {
  it('TC-6.1: sending while the target has a live run renders a queued state naming what it is waiting on', async () => {
    render(<ChatView projectId={1} workers={[busyWorker()]} tracks={[{ track_number: '42', title: 'Test Track' }]} />);

    await waitFor(() => screen.getByPlaceholderText(/Message host-a/));

    // Live hint indicates running task before send
    const liveHint = screen.getByTestId('composer-live-hint');
    expect(liveHint.textContent).toContain('implement');

    // Type and send
    fireEvent.change(screen.getByPlaceholderText(/Message host-a/), { target: { value: 'please tweak the style' } });
    mockApiFetch.mockImplementationOnce(() => jsonResponse({ id: 101, author: 'human', body: 'please tweak the style' }));

    fireEvent.click(screen.getByTestId('worker-chat-send'));

    // REQ-9: Queued state renders and names what it is waiting on
    await waitFor(() => {
      const notice = screen.getByTestId('composer-queued-notice');
      expect(notice).toBeTruthy();
      expect(notice.textContent).toContain('Queued');
      expect(notice.textContent).toContain('implement');
    });
  });

  it('TC-6.2: the queued state clears when the WS event stream reports the turn ended / reply started', async () => {
    render(<ChatView projectId={1} workers={[busyWorker()]} tracks={[{ track_number: '42', title: 'Test Track' }]} />);

    await waitFor(() => screen.getByPlaceholderText(/Message host-a/));
    fireEvent.change(screen.getByPlaceholderText(/Message host-a/), { target: { value: 'check this' } });
    mockApiFetch.mockImplementationOnce(() => jsonResponse({ id: 102, author: 'human', body: 'check this' }));

    fireEvent.click(screen.getByTestId('worker-chat-send'));

    await waitFor(() => {
      expect(screen.getByTestId('composer-queued-notice')).toBeTruthy();
    });

    // Simulate WS session:event for track 42 (reply turn starts)
    act(() => {
      for (const cb of wsCallbacks) {
        cb({
          event: 'session:event',
          data: {
            trackNumber: '42',
            projectId: 1,
            event: { type: 'system', subtype: 'init' },
          },
        });
      }
    });

    // REQ-10: Queued notice clears without user action or new poll
    await waitFor(() => {
      expect(screen.queryByTestId('composer-queued-notice')).toBeNull();
    });
  });

  it('TC-6.3: sending to an idle target never shows the queued state', async () => {
    render(<ChatView projectId={1} workers={[idleWorker()]} tracks={[{ track_number: '42', title: 'Test Track' }]} />);

    await waitFor(() => screen.getByPlaceholderText(/Message host-b/));

    // Idle target has no live hint
    expect(screen.queryByTestId('composer-live-hint')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Message host-b/), { target: { value: 'hello idle worker' } });
    mockApiFetch.mockImplementationOnce(() => jsonResponse({ id: 103, author: 'human', body: 'hello idle worker' }));

    fireEvent.click(screen.getByTestId('worker-chat-send'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/projects/1/tracks/42/comments',
        expect.objectContaining({ method: 'POST' })
      );
    });

    // No queued notice rendered
    expect(screen.queryByTestId('composer-queued-notice')).toBeNull();
  });

  it('TC-6.4: no string rendered claims the running turn is interrupted, stopped or cancelled', async () => {
    render(<ChatView projectId={1} workers={[busyWorker()]} tracks={[{ track_number: '42', title: 'Test Track' }]} />);

    await waitFor(() => screen.getByPlaceholderText(/Message host-a/));

    fireEvent.change(screen.getByPlaceholderText(/Message host-a/), { target: { value: 'update' } });
    mockApiFetch.mockImplementationOnce(() => jsonResponse({ id: 104, author: 'human', body: 'update' }));
    fireEvent.click(screen.getByTestId('worker-chat-send'));

    await waitFor(() => {
      expect(screen.getByTestId('composer-queued-notice')).toBeTruthy();
    });

    const containerText = screen.getByTestId('chat-view').textContent;

    // REQ-11: Explicitly assert text does not imply interruption
    expect(containerText).not.toMatch(/\binterrupting\b/i);
    expect(containerText).not.toMatch(/\bstopping active turn\b/i);
    expect(containerText).not.toMatch(/\bcancelled active turn\b/i);

    // Verify it positively states non-interruption
    expect(containerText).toMatch(/will not interrupt/i);
  });
});
