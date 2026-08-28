// Track 10037 Phase 2/4: strip ordering (AC-1), running-track chip deep-dive
// (AC-2), last-track chip + chat panel (AC-3), and Machine Workers view
// (grid layout) parity (AC-6).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WorkersList } from './WorkersList.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

function makeWorker(overrides = {}) {
  return {
    id: 1,
    hostname: 'test-host',
    pid: 1234,
    worker_number: 1,
    status: 'idle',
    last_heartbeat: new Date().toISOString(),
    current_task: null,
    visibility: 'private',
    type: 'project',
    mode: 'sync+poll',
    project_id: 1,
    project_name: 'test-project',
    cli: 'claude',
    model: null,
    last_track_number: null,
    last_track_project_id: null,
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

describe('WorkersList strip — active-first ordering (AC-1)', () => {
  it('renders the busy worker before idle workers', () => {
    const idle1 = makeWorker({ id: 1, hostname: 'idle-1' });
    const idle2 = makeWorker({ id: 2, hostname: 'idle-2' });
    const busy = makeWorker({ id: 3, hostname: 'busy-1', status: 'busy', current_task: 'implement track 42' });
    render(<WorkersList projectId={1} workers={[idle1, idle2, busy]} layout="strip" />);
    const items = screen.getAllByTestId('worker-strip-item');
    expect(within(items[0]).getByText('busy-1')).toBeInTheDocument();
  });
});

describe('WorkersList strip — running-track chip (AC-2)', () => {
  it('clicking the running-track chip calls onSelectTrack with project/track', () => {
    const onSelectTrack = vi.fn();
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42' });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" onSelectTrack={onSelectTrack} />);
    fireEvent.click(screen.getByTestId('worker-running-track-chip'));
    expect(onSelectTrack).toHaveBeenCalledWith(1, '42');
  });
});

describe('WorkersList strip — last-track chip (AC-3)', () => {
  it('renders a last-track chip when present and distinct from the running track', () => {
    const worker = makeWorker({ last_track_number: '10', last_track_project_id: 1 });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    expect(screen.getByTestId('worker-last-track-chip').textContent).toContain('10');
  });

  it('does not render a last-track chip when it matches the running track', () => {
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42', last_track_number: '42' });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    expect(screen.queryByTestId('worker-last-track-chip')).not.toBeInTheDocument();
  });

  it('clicking the last-track chip opens the chat panel pre-scoped to that track', async () => {
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42', last_track_number: '10', last_track_project_id: 1 });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    fireEvent.click(screen.getByTestId('worker-last-track-chip'));
    expect(screen.getByTestId('worker-chat-panel')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#10'));
  });
});

describe('WorkersList strip — chat trigger', () => {
  it('opens the chat panel defaulting to the running track', async () => {
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42' });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    fireEvent.click(screen.getByTestId('worker-chat-btn-strip'));
    await waitFor(() => expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#42'));
  });

  it('does not render a chat trigger for a manager', () => {
    const worker = makeWorker({ type: 'manager' });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    expect(screen.queryByTestId('worker-chat-btn-strip')).not.toBeInTheDocument();
  });
});

describe('WorkersList grid (Machine Workers view) — parity (AC-6)', () => {
  it('renders the running-track chip, last-track chip, and chat button', async () => {
    const worker = makeWorker({ status: 'busy', current_task: 'implement track 42', last_track_number: '10', last_track_project_id: 1 });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" onSelectTrack={() => {}} />);
    expect(screen.getByTestId('worker-running-track-chip').textContent).toContain('42');
    expect(screen.getByTestId('worker-last-track-chip').textContent).toContain('10');

    fireEvent.click(screen.getByTestId('worker-chat-btn'));
    await waitFor(() => expect(screen.getByTestId('worker-chat-track-link').textContent).toContain('#42'));
  });

  it('does not render a chat button for a manager', () => {
    const worker = makeWorker({ type: 'manager' });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    expect(screen.queryByTestId('worker-chat-btn')).not.toBeInTheDocument();
  });
});
