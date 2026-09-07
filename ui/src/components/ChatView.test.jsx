// Track 10069 Phase 3 (REQ-1..REQ-5, D5): persistent Chat view + target
// switcher. Worker targets are fully functional in this phase; the manager
// target resolves once Phase 4's resolver change lands (verified there).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatView } from './ChatView.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

function manager(overrides = {}) {
  return { id: 1, hostname: 'mgr-host', type: 'manager', project_id: null, ...overrides };
}
function busyWorker(overrides = {}) {
  return {
    id: 2, hostname: 'host-a', type: 'project', project_id: 1,
    status: 'busy', current_task: 'implement track 42',
    last_track_number: null, last_track_project_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path) => {
    if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
    return jsonResponse([]);
  });
});

describe('ChatView', () => {
  it('TC-3.2: a manager in the worker list is selected by default', () => {
    render(<ChatView projectId={1} workers={[manager(), busyWorker()]} />);
    const managerBtn = screen.getByTestId('chat-target-1');
    expect(managerBtn.className).toMatch(/bg-gray-800/);
  });

  it('TC-3.3: selecting a worker target swaps the transcript to that worker\'s resolved track', async () => {
    render(<ChatView projectId={1} workers={[manager(), busyWorker()]} />);
    fireEvent.click(screen.getByTestId('chat-target-2'));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/tracks/42/transcript')));
  });

  it('TC-3.5: a worker target composer posts to POST /api/projects/:id/tracks/:num/comments', async () => {
    render(<ChatView projectId={1} workers={[manager(), busyWorker()]} />);
    fireEvent.click(screen.getByTestId('chat-target-2'));
    await waitFor(() => screen.getByPlaceholderText(/Message host-a/));

    fireEvent.change(screen.getByPlaceholderText(/Message host-a/), { target: { value: 'hello' } });
    mockApiFetch.mockImplementationOnce(() => jsonResponse({ id: 99, author: 'human', body: 'hello' }));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/tracks/42/comments',
      expect.objectContaining({ method: 'POST' })
    ));
  });

  it('TC-3.6: a worker with neither running nor last-context track shows the disabled composer, not enabled', async () => {
    const idle = busyWorker({ status: 'idle', current_task: null, last_track_number: null });
    render(<ChatView projectId={1} workers={[manager(), idle]} />);
    fireEvent.click(screen.getByTestId('chat-target-2'));
    await waitFor(() => screen.getByText(/nothing to talk about/i));
  });

  it('renders "no workers" when the list is empty', () => {
    render(<ChatView projectId={1} workers={[]} />);
    expect(screen.getByText(/No workers registered yet/)).toBeInTheDocument();
  });
});
