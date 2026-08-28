// Track 10037 Phase 4 Task 3: WorkerActivityLatch (Machine Workers view
// side latch) now uses the same TrackChatComposer/useTrackTranscript
// pieces as WorkerChatPanel — messages post through the track's own
// conversation, not the old worker_dispatch-based chat bar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkerActivityLatch } from './WorkerActivityLatch.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

function makeWorker(overrides = {}) {
  return {
    id: 1, hostname: 'host-a', type: 'project', project_id: 1,
    status: 'idle', current_task: null, last_heartbeat: new Date().toISOString(),
    last_track_number: null, last_track_project_id: null,
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

describe('WorkerActivityLatch — chat composer parity', () => {
  it('a busy worker scopes the composer to its running track', async () => {
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42' });
    render(<WorkerActivityLatch workers={[worker]} projectId={1} onClose={() => { }} onSelectTrack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /host-a/ }));
    await waitFor(() => expect(screen.getByTestId('worker-latch-track-link').textContent).toContain('#42'));
    expect(screen.getByTestId('worker-chat-input')).not.toBeDisabled();
  });

  it('an idle worker with a last-context track shows its transcript and scopes the composer to it', async () => {
    const worker = makeWorker({ last_track_number: '10', last_track_project_id: 1 });
    render(<WorkerActivityLatch workers={[worker]} projectId={1} onClose={() => { }} onSelectTrack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /host-a/ }));
    await waitFor(() => expect(screen.getByTestId('worker-latch-track-link').textContent).toContain('#10'));
    expect(screen.getByTestId('worker-chat-input')).not.toBeDisabled();
  });

  it('a worker with no running and no last track disables the composer with a hint', async () => {
    const worker = makeWorker();
    render(<WorkerActivityLatch workers={[worker]} projectId={1} onClose={() => { }} onSelectTrack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /host-a/ }));
    await waitFor(() => expect(screen.getByTestId('worker-chat-input')).toBeDisabled());
    expect(screen.getByTestId('worker-chat-disabled-hint')).toBeInTheDocument();
  });

  it('a manager is transcript-only — composer disabled even with a track-shaped task', async () => {
    const worker = makeWorker({ type: 'manager', status: 'busy', current_task: 'implement track 42' });
    render(<WorkerActivityLatch workers={[worker]} projectId={1} onClose={() => { }} onSelectTrack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /host-a/ }));
    await waitFor(() => expect(screen.getByTestId('worker-chat-input')).toBeDisabled());
  });

  it('sending a message POSTs to the track comments endpoint, not a dispatch endpoint', async () => {
    mockApiFetch.mockImplementation((path, opts) => {
      if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
      if (path.endsWith('/comments') && opts?.method === 'POST') {
        return jsonResponse({ id: 555, author: 'human', body: JSON.parse(opts.body).body });
      }
      return jsonResponse({});
    });

    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42' });
    render(<WorkerActivityLatch workers={[worker]} projectId={1} onClose={() => { }} onSelectTrack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /host-a/ }));
    await waitFor(() => screen.getByTestId('worker-chat-input'));

    fireEvent.change(screen.getByTestId('worker-chat-input'), { target: { value: 'status check' } });
    fireEvent.click(screen.getByTestId('worker-chat-send'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([p]) => p.endsWith('/comments'));
      expect(call).toBeTruthy();
      expect(call[0]).toBe('/api/projects/1/tracks/42/comments');
    });
    expect(mockApiFetch.mock.calls.some(([p]) => p.includes('/dispatch'))).toBe(false);
    await waitFor(() => expect(screen.getByText('status check')).toBeInTheDocument());
  });
});
