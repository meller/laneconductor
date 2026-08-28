// Track 10037 Phase 3 Task 5: target-track resolution matrix, send → POST
// to the comments endpoint (not dispatch), transcript events render.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkerChatPanel } from './WorkerChatPanel.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

function busyWorker(overrides = {}) {
  return {
    id: 1, hostname: 'host-a', type: 'project', project_id: 1,
    status: 'busy', current_task: 'implement track 42',
    last_track_number: '10', last_track_project_id: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path) => {
    if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
    return jsonResponse({});
  });
});

describe('WorkerChatPanel — target-track resolution', () => {
  it('a busy worker scopes to its running track', async () => {
    render(<WorkerChatPanel worker={busyWorker()} projectId={1} onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-track-link'));
    expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#42');
  });

  it('an idle worker with a last track scopes to it', async () => {
    const worker = busyWorker({ status: 'idle', current_task: null });
    render(<WorkerChatPanel worker={worker} projectId={1} onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-track-link'));
    expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#10');
  });

  it('a worker with neither running nor last track disables the input with a hint', async () => {
    const worker = busyWorker({ status: 'idle', current_task: null, last_track_number: null });
    render(<WorkerChatPanel worker={worker} projectId={1} onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-no-target'));
    expect(screen.getByTestId('worker-chat-input')).toBeDisabled();
    expect(screen.getByTestId('worker-chat-disabled-hint')).toBeInTheDocument();
  });

  it('a manager gets transcript-only view — no target even if it looks busy', async () => {
    const worker = busyWorker({ type: 'manager' });
    render(<WorkerChatPanel worker={worker} projectId={1} onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-no-target'));
    expect(screen.getByTestId('worker-chat-input')).toBeDisabled();
  });

  it('forcedTrackNumber (last-track chip) pins the scope even for a busy worker', async () => {
    render(<WorkerChatPanel worker={busyWorker()} projectId={1} forcedTrackNumber="10" onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-track-link'));
    expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#10');
  });
});

describe('WorkerChatPanel — sending a message', () => {
  it('POSTs to the track comments endpoint with author human, not a dispatch endpoint', async () => {
    mockApiFetch.mockImplementation((path, opts) => {
      if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
      if (path.endsWith('/comments') && opts?.method === 'POST') {
        return jsonResponse({ id: 999, author: 'human', body: JSON.parse(opts.body).body });
      }
      return jsonResponse({});
    });

    render(<WorkerChatPanel worker={busyWorker()} projectId={1} onClose={() => { }} />);
    await waitFor(() => screen.getByTestId('worker-chat-input'));

    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: 'hey, how is it going?' } });
    fireEvent.click(screen.getByTestId('worker-chat-send'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([p]) => p.endsWith('/comments'));
      expect(call).toBeTruthy();
      expect(call[0]).toBe('/api/projects/1/tracks/42/comments');
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({ author: 'human', body: 'hey, how is it going?' });
    });

    expect(mockApiFetch.mock.calls.some(([p]) => p.includes('/dispatch'))).toBe(false);
    await waitFor(() => expect(screen.getByText('hey, how is it going?')).toBeInTheDocument());
  });
});

describe('WorkerChatPanel — transcript rendering', () => {
  it('renders transcript blocks fetched for the resolved track', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (path.includes('/transcript')) {
        return jsonResponse({
          events: [{
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'hello from the agent' }] },
          }],
          rawLog: null,
        });
      }
      return jsonResponse({});
    });

    render(<WorkerChatPanel worker={busyWorker()} projectId={1} onClose={() => { }} />);
    await waitFor(() => expect(screen.getByText('hello from the agent')).toBeInTheDocument());
  });
});
