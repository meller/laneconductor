// ui/src/components/ProvisionWorkerModal.test.jsx
// Verifies the New Worker modal's mode picker defaults to Auto
// (sync+poll) and sends whatever the user picks in the dispatch payload —
// per-track **Auto Run** (default no) already gates which tracks a worker
// may run unattended, so the worker-level mode no longer needs the
// conservative sync-only default.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProvisionWorkerModal } from './ProvisionWorkerModal.jsx';

const project = { id: 1, name: 'laneconductor', repo_path: '/home/meller/Code/laneconductor' };
const manager = { id: 42, type: 'manager', status: 'idle', hostname: 'meller-X1-AI' };

const apiFetchMock = vi.fn(async (url) => {
  if (url === '/api/projects') return { ok: true, json: async () => [project] };
  if (url === '/api/workers') return { ok: true, json: async () => [manager] };
  if (url === '/api/dispatch/provision-worker') {
    return { ok: true, json: async () => ({ id: 99 }) };
  }
  return { ok: true, json: async () => ({}) };
});

vi.mock('../hooks/useApi.js', () => ({
  useApi: () => ({ apiFetch: (...args) => apiFetchMock(...args) }),
}));

function lastProvisionBody() {
  const call = apiFetchMock.mock.calls.find(([url]) => url === '/api/dispatch/provision-worker');
  return JSON.parse(call[1].body);
}

describe('ProvisionWorkerModal — worker mode (Track 1119)', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('defaults the mode select to Auto (sync+poll)', async () => {
    render(<ProvisionWorkerModal projectId={1} workers={[manager]} onClose={vi.fn()} onProvisioned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('provision-mode-select')).toHaveValue('sync+poll'));
  });

  it('dispatches payload.mode = "sync+poll" by default', async () => {
    render(<ProvisionWorkerModal projectId={1} workers={[manager]} onClose={vi.fn()} onProvisioned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('provision-project-select')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Start Worker'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/dispatch/provision-worker', expect.any(Object)));

    expect(lastProvisionBody().payload.mode).toBe('sync+poll');
  });

  it('switching to Manual dispatches payload.mode = "sync-only"', async () => {
    render(<ProvisionWorkerModal projectId={1} workers={[manager]} onClose={vi.fn()} onProvisioned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('provision-mode-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('provision-mode-select'), { target: { value: 'sync-only' } });
    fireEvent.click(screen.getByText('Start Worker'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/dispatch/provision-worker', expect.any(Object)));

    expect(lastProvisionBody().payload.mode).toBe('sync-only');
  });
});
