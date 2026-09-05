// Track 10061 Phase 4 (REQ-14): the collector handshake mismatch has to be
// where a human already looks, not only in the worker's log — a warning
// badge on the worker card/strip item, following the existing "No worker
// for this project" badge precedent.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkersList } from './WorkersList.jsx';

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
    model: 'sonnet',
    collector_compat: null,
    ...overrides,
  };
}

const MISSING_ROUTES_COMPAT = {
  compatible: true,
  severity: 'missing-routes',
  apiVersionDelta: 0,
  missingRoutes: ['POST /tracks/claim-queue', 'GET /worker/1/dispatch'],
  reason: 'collector does not serve 2 route(s) this worker calls',
};

describe('WorkersList — collector compat badge (Track 10061)', () => {
  it('TC-30: grid layout — a missing-routes verdict renders a badge whose tooltip names the routes', () => {
    const worker = makeWorker({ collector_compat: MISSING_ROUTES_COMPAT });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    const badge = screen.getByTestId('worker-collector-compat-badge');
    expect(badge.title).toContain('POST /tracks/claim-queue');
    expect(badge.title).toContain('GET /worker/1/dispatch');
  });

  it('TC-31: grid layout — collector_compat: null renders no badge at all', () => {
    const worker = makeWorker({ collector_compat: null });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    expect(screen.queryByTestId('worker-collector-compat-badge')).toBeNull();
  });

  it('a severity of "ok" (a matched handshake) renders no badge', () => {
    const worker = makeWorker({
      collector_compat: { compatible: true, severity: 'ok', apiVersionDelta: 0, missingRoutes: [], reason: null },
    });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    expect(screen.queryByTestId('worker-collector-compat-badge')).toBeNull();
  });

  it('TC-32: strip layout — the same missing-routes verdict also renders a badge', () => {
    const worker = makeWorker({ collector_compat: MISSING_ROUTES_COMPAT });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    const badge = screen.getByTestId('worker-collector-compat-badge');
    expect(badge.title).toContain('POST /tracks/claim-queue');
  });

  it('TC-32: strip layout — collector_compat: null renders no badge', () => {
    const worker = makeWorker({ collector_compat: null });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    expect(screen.queryByTestId('worker-collector-compat-badge')).toBeNull();
  });

  it('a version-drift verdict names the delta in the tooltip', () => {
    const worker = makeWorker({
      collector_compat: { compatible: true, severity: 'version-drift', apiVersionDelta: -1, missingRoutes: [], reason: 'collector reports api_version 1, worker expects 2' },
    });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    const badge = screen.getByTestId('worker-collector-compat-badge');
    expect(badge.title).toContain('api_version delta: -1');
  });
});
