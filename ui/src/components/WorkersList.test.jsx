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
