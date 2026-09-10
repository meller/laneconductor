// ui/src/components/TrackChatComposer.autocomplete.test.jsx
// Track 10080 Phase 3 (TC-35..TC-52): the Chat composer's @file / #track /
// /command autocomplete menu. Mirrors the useApi/useWebSocket mocking
// pattern already established in ChatView.test.jsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackChatComposer } from './TrackChatComposer.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

const TRACKS = [
  { track_number: 100, title: 'Fix login bug' },
  { track_number: 1001, title: 'Composer autocomplete' },
];

const FILES_RESPONSE = {
  files: [
    { path: 'ui/src/components/ChatView.jsx', score: 10 },
    { path: 'ui/src/components/ChatView.test.jsx', score: 8 },
    { path: 'Makefile', score: 1 },
  ],
  source: 'disk',
  total: 3,
  truncated: false,
  age_seconds: 0,
};

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path) => {
    if (typeof path === 'string' && path.includes('/files')) return jsonResponse(FILES_RESPONSE);
    return jsonResponse({ id: 1, author: 'human', body: 'x' });
  });
});

// Safety net: if a test that switches to fake timers throws or times out
// before reaching its own cleanup, real timers must still come back for
// every later test's debounce (setTimeout) to ever fire.
afterEach(() => {
  vi.useRealTimers();
});

function renderComposer(props = {}) {
  return render(
    <TrackChatComposer projectId={1} trackNumber={42} tracks={TRACKS} {...props} />
  );
}

describe('TrackChatComposer autocomplete', () => {
  it('TC-35: typing @Chat shows a menu of matching files', async () => {
    renderComposer();
    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    expect(screen.getAllByTestId('autocomplete-item').length).toBeGreaterThan(0);
  });

  it('TC-36: typing #100 shows matching tracks and issues no files request', async () => {
    renderComposer();
    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: '#100' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    // Both track 100 and 1001 are valid subsequence matches for query "100" —
    // assert the exact track is present rather than a substring match.
    const items = screen.getAllByTestId('autocomplete-item');
    expect(items.some(el => el.textContent.startsWith('#100 '))).toBe(true);
    // Give the debounce window time to have fired if it were (mis)triggered.
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(mockApiFetch.mock.calls.some(([p]) => typeof p === 'string' && p.includes('/files'))).toBe(false);
  });

  it('TC-37: typing / at position 0 shows the /laneconductor commands', async () => {
    renderComposer();
    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: '/mo' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    expect(screen.getByText(/\/laneconductor move/)).toBeInTheDocument();
  });

  it('TC-38: ArrowDown then Enter inserts the second item', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('ui/src/components/ChatView.test.jsx '));
  });

  it('TC-39: ArrowUp from the first item wraps to the last', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('Makefile '));
  });

  it('TC-40: Tab accepts the highlighted item and keeps focus in the input', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    input.focus();
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(input.value).toBe('ui/src/components/ChatView.jsx '));
    expect(document.activeElement).toBe(input);
  });

  it('TC-41: Enter with the menu open inserts the completion and does not POST', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('ui/src/components/ChatView.jsx '));
    expect(mockApiFetch.mock.calls.some(([p]) => typeof p === 'string' && p.includes('/comments'))).toBe(false);
  });

  it('TC-42: Enter with no menu open sends the message', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/tracks/42/comments',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  it('TC-43/TC-44: Escape dismisses the menu until the trigger token changes', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('autocomplete-menu')).not.toBeInTheDocument());
    expect(input.value).toBe('@Chat');

    // Still dismissed with no change to the trigger token.
    fireEvent.click(input);
    expect(screen.queryByTestId('autocomplete-menu')).not.toBeInTheDocument();

    // Typing another character changes the token, so it reopens (TC-44).
    fireEvent.change(input, { target: { value: '@ChatV' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-menu')).toBeInTheDocument());
  });

  it('TC-45: five rapid keystrokes into a file trigger issue one debounced request', async () => {
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: '@C' } });
    fireEvent.change(input, { target: { value: '@Ch' } });
    fireEvent.change(input, { target: { value: '@Cha' } });
    fireEvent.change(input, { target: { value: '@Chat' } });
    fireEvent.change(input, { target: { value: '@ChatV' } });
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    const fileCalls = mockApiFetch.mock.calls.filter(([p]) => typeof p === 'string' && p.includes('/files'));
    expect(fileCalls.length).toBe(1);
  });

  it('TC-46: a stale response arriving after a newer keystroke is ignored', async () => {
    const resolvers = {};
    mockApiFetch.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/files')) {
        return new Promise(resolve => { resolvers[path] = resolve; });
      }
      return jsonResponse({});
    });

    renderComposer();
    const input = screen.getByTestId('worker-chat-input');

    // Fake timers only for the debounce window itself — switched back to
    // real timers before any `waitFor`, since testing-library's own
    // polling uses the (fake, if left active) global timers and would
    // otherwise hang forever.
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: '@Ch' } });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.change(input, { target: { value: '@ChatV' } });
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    const paths = Object.keys(resolvers);
    expect(paths.length).toBe(2);
    const [stalePath, freshPath] = paths;

    // Resolve the newer (second) request first, then the stale one.
    resolvers[freshPath]({ ok: true, json: () => Promise.resolve({ files: [{ path: 'FRESH_RESULT.js', score: 5 }], source: 'disk' }) });
    await waitFor(() => expect(screen.getByText('FRESH_RESULT.js')).toBeInTheDocument());

    resolvers[stalePath]({ ok: true, json: () => Promise.resolve({ files: [{ path: 'STALE_RESULT.js', score: 5 }], source: 'disk' }) });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText('STALE_RESULT.js')).not.toBeInTheDocument();
  });

  it('TC-47: source "none" shows an explicit unavailable empty state, and sending still works', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/files')) return jsonResponse({ files: [], source: 'none', total: 0, truncated: false, age_seconds: 0 });
      return jsonResponse({ id: 1, author: 'human', body: 'x' });
    });
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    fireEvent.change(input, { target: { value: '@Chat' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-empty')).toHaveAttribute('data-empty-reason', 'unavailable'));

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/tracks/42/comments',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  it('TC-48: an empty match set shows a "no matches" empty state, distinct from TC-47', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/files')) return jsonResponse({ files: [], source: 'disk', total: 100, truncated: false, age_seconds: 0 });
      return jsonResponse({});
    });
    renderComposer();
    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: '@zzzznomatch' } });
    await waitFor(() => expect(screen.getByTestId('autocomplete-empty')).toHaveAttribute('data-empty-reason', 'no-matches'));
  });

  it('TC-49: a non-ok files response throws nothing and the composer still sends', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/files')) return jsonResponse({ error: 'boom' }, false);
      return jsonResponse({ id: 1, author: 'human', body: 'x' });
    });
    renderComposer();
    const input = screen.getByTestId('worker-chat-input');
    expect(() => fireEvent.change(input, { target: { value: '@Chat' } })).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('autocomplete-empty')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/tracks/42/comments',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  it('TC-50: a disabled composer (no trackNumber) shows no menu and keeps the disabled hint', () => {
    renderComposer({ trackNumber: null, disabled: true, disabledHint: 'No track context to talk about' });
    expect(screen.queryByTestId('autocomplete-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('worker-chat-disabled-hint')).toBeInTheDocument();
  });

  it('TC-51: regression — the live-turn hint still renders', () => {
    renderComposer({ isLiveTurn: true, liveAction: 'implement' });
    expect(screen.getByTestId('composer-live-hint')).toBeInTheDocument();
  });

  it('TC-52: regression — worker-chat-input and worker-chat-send test ids still resolve', () => {
    renderComposer();
    expect(screen.getByTestId('worker-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('worker-chat-send')).toBeInTheDocument();
  });
});
