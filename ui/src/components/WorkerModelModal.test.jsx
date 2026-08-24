// Track 1096 Phase 6: switching a worker's CLI/provider (not just its
// model) means the worker starts a fresh conversation under the new
// provider — session ids are provider-specific (e.g. Claude's
// claude_session_id), so a plain model change never has this consequence.
// The modal must warn and require explicit confirmation only when the
// provider itself changes, never for a same-provider model change.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkerModelModal } from './WorkerModelModal.jsx';

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
  }),
}));

function makeWorker(overrides = {}) {
  return {
    id: 1,
    hostname: 'test-host',
    cli: 'claude',
    model: 'claude-3-5-sonnet',
    available_models: null,
    ...overrides,
  };
}

describe('WorkerModelModal — provider-switch confirmation', () => {
  it('TC-P6-1: same-provider model change shows no warning and Save stays enabled', () => {
    render(<WorkerModelModal worker={makeWorker()} onClose={() => {}} onUpdated={() => {}} />);
    expect(screen.queryByTestId('provider-switch-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('save-worker-config-btn')).not.toBeDisabled();

    fireEvent.change(screen.getByTestId('model-select-dropdown'), { target: { value: 'claude-3-5-haiku' } });
    expect(screen.queryByTestId('provider-switch-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('save-worker-config-btn')).not.toBeDisabled();
  });

  it('TC-P6-2: switching CLI shows the warning and disables Save until confirmed', () => {
    render(<WorkerModelModal worker={makeWorker()} onClose={() => {}} onUpdated={() => {}} />);

    fireEvent.click(screen.getByTestId('cli-option-gemini'));

    const warning = screen.getByTestId('provider-switch-warning');
    expect(warning.textContent).toContain('Claude');
    expect(warning.textContent).toContain('Gemini');
    expect(screen.getByTestId('save-worker-config-btn')).toBeDisabled();

    fireEvent.click(screen.getByTestId('confirm-provider-switch-checkbox'));
    expect(screen.getByTestId('save-worker-config-btn')).not.toBeDisabled();
  });

  it('TC-P6-3: switching CLI back to the original provider clears the warning', () => {
    render(<WorkerModelModal worker={makeWorker()} onClose={() => {}} onUpdated={() => {}} />);

    fireEvent.click(screen.getByTestId('cli-option-gemini'));
    expect(screen.getByTestId('provider-switch-warning')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cli-option-claude'));
    expect(screen.queryByTestId('provider-switch-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('save-worker-config-btn')).not.toBeDisabled();
  });

  it('TC-P6-4: re-picking a different CLI after confirming requires re-confirmation', () => {
    render(<WorkerModelModal worker={makeWorker()} onClose={() => {}} onUpdated={() => {}} />);

    fireEvent.click(screen.getByTestId('cli-option-gemini'));
    fireEvent.click(screen.getByTestId('confirm-provider-switch-checkbox'));
    expect(screen.getByTestId('save-worker-config-btn')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('cli-option-copilot'));
    expect(screen.getByTestId('save-worker-config-btn')).toBeDisabled();
  });
});
