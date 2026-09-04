// Track 10011: a worker with no reported `model` must never show another
// provider's model string (the "gemini has wrong version" bug), and its
// icon must come from the shared provider registry.
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
    model: null,
    ...overrides,
  };
}

describe('WorkersList — provider-aware model/icon rendering', () => {
  it('TC-17: grid layout — gemini worker with no model never shows a claude model string', () => {
    const worker = makeWorker({ cli: 'gemini', model: null });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    const badge = screen.getByTestId('worker-model-badge');
    expect(badge.textContent).not.toBe('claude-3-5-sonnet');
    expect(badge.textContent.toLowerCase()).not.toContain('claude');
  });

  it('TC-18: strip layout — gemini worker with no model never shows a claude model string', () => {
    const worker = makeWorker({ cli: 'gemini', model: null });
    render(<WorkersList projectId={1} workers={[worker]} layout="strip" />);
    const btn = screen.getByTestId('change-worker-model-btn-strip');
    expect(btn.textContent).not.toContain('claude-3-5-sonnet');
    expect(btn.textContent.toLowerCase()).not.toContain('claude');
  });

  it('TC-19: copilot worker renders the Copilot icon, not the generic fallback', () => {
    const worker = makeWorker({ cli: 'copilot', model: null });
    render(<WorkersList projectId={1} workers={[worker]} layout="grid" />);
    const badge = screen.getByTestId('worker-model-badge');
    // Copilot's provider-aware fallback model is its own first preset, not "not reported yet"
    expect(badge.textContent).not.toBe('model not reported yet');
    const card = badge.closest('div').parentElement;
    expect(card.textContent).toContain('✈️');
    expect(card.textContent).not.toContain('🤖');
  });
});

// Track 10062: an expired CLI login was previously indistinguishable from
// a genuine rate limit anywhere a human could look — both fell through to
// `isExhausted = p.status === 'exhausted'` and rendered a green
// HEALTHY badge. These assert the new auth_required/probe_failed states
// render as their own visibly-not-healthy states in both layouts.
describe('WorkersList — provider status card (track 10062)', () => {
  const worker = makeWorker();

  it('TC-13: strip layout — auth_required renders LOGIN REQUIRED, no healthy dot', () => {
    const providers = [{ provider: 'claude', status: 'auth_required', reset_at: null, last_error: 'login expired' }];
    render(<WorkersList projectId={1} workers={[worker]} providers={providers} layout="strip" />);
    expect(screen.getByText(/LOGIN REQUIRED/)).toBeTruthy();
    // Scope to the provider status card itself — the worker row elsewhere
    // in this layout has its own unrelated green "idle" status dot.
    const providerCard = screen.getByText('claude').closest('div');
    expect(providerCard.querySelector('.bg-green-500')).toBeNull();
    expect(providerCard.textContent).not.toContain('HEALTHY');
  });

  it('TC-14: grid layout — auth_required badge is not HEALTHY, body names claude login and says it will not recover on its own', () => {
    const providers = [{ provider: 'claude', status: 'auth_required', reset_at: null, last_error: 'login expired', updated_at: new Date().toISOString() }];
    const { container } = render(<WorkersList projectId={1} workers={[worker]} providers={providers} layout="grid" />);
    expect(container.textContent).toContain('LOGIN REQUIRED');
    expect(container.textContent).not.toContain('HEALTHY');
    expect(container.textContent).toMatch(/claude login/i);
    expect(container.textContent).toMatch(/will not recover on its own/i);
  });

  it('TC-15: probe_failed renders PROBE FAILED with its last_error, in both layouts', () => {
    const providers = [{ provider: 'claude', status: 'probe_failed', reset_at: null, last_error: 'Error: ENOENT spawn claude', updated_at: new Date().toISOString() }];

    const strip = render(<WorkersList projectId={1} workers={[worker]} providers={providers} layout="strip" />);
    expect(strip.container.textContent).toContain('PROBE FAILED');
    expect(strip.container.textContent).toContain('Error: ENOENT spawn claude');
    strip.unmount();

    const grid = render(<WorkersList projectId={1} workers={[worker]} providers={providers} layout="grid" />);
    expect(grid.container.textContent).toContain('PROBE FAILED');
    expect(grid.container.textContent).toContain('Error: ENOENT spawn claude');
  });

  it('TC-16: no regression — exhausted still renders EXHAUSTED with countdown, ok still renders HEALTHY', () => {
    const futureReset = new Date(Date.now() + 5 * 60000).toISOString();
    const exhausted = [{ provider: 'claude', status: 'exhausted', reset_at: futureReset, last_error: 'Capacity exhausted', updated_at: new Date().toISOString() }];
    const { container: exhaustedContainer } = render(<WorkersList projectId={1} workers={[worker]} providers={exhausted} layout="grid" />);
    expect(exhaustedContainer.textContent).toContain('EXHAUSTED');
    expect(exhaustedContainer.textContent).toMatch(/Resets in/i);

    const ok = [{ provider: 'claude', status: 'ok', reset_at: null, last_error: null, updated_at: new Date().toISOString() }];
    const { container: okContainer } = render(<WorkersList projectId={1} workers={[worker]} providers={ok} layout="grid" />);
    expect(okContainer.textContent).toContain('HEALTHY');
    expect(okContainer.textContent).not.toContain('LOGIN REQUIRED');
    expect(okContainer.textContent).not.toContain('PROBE FAILED');
  });
});
