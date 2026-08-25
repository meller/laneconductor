// ui/src/components/NewProjectModal.test.jsx
// Track AM-1119 Phase 1: verifies (a) "Quick create" still dispatches the
// legacy scaffold_context-only payload unchanged, and (b) the "Guided
// wizard" toggle walks through all five steps and dispatches a payload
// with the additional `wizard` block, via the same
// /api/dispatch/create-project endpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewProjectModal } from './NewProjectModal.jsx';

const apiFetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ id: 42, status: 'pending', result: null }),
}));

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ apiFetch: (...args) => apiFetchMock(...args) }),
}));

function baseProps(overrides = {}) {
  return {
    managerWorkers: [{ id: 1, hostname: 'dev-machine' }],
    knownHostnames: [],
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
}

function lastPostBody() {
  const call = apiFetchMock.mock.calls.find(([url]) => url === '/api/dispatch/create-project');
  return JSON.parse(call[1].body);
}

describe('NewProjectModal — Quick create (legacy, unchanged)', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('defaults to Quick create mode and dispatches scaffold_context only (no wizard block)', async () => {
    const { container } = render(<NewProjectModal {...baseProps()} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. My New App'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/my-new-app'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.change(container.querySelector('textarea'), {
      target: { value: 'A digging game' },
    });

    fireEvent.click(screen.getByText('Create Project'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    const body = lastPostBody();
    expect(body.payload.scaffold_context.project.name).toBe('Digger Game');
    expect(body.payload.wizard).toBeUndefined();
  });
});

describe('NewProjectModal — Guided wizard (Track AM-1119)', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('walks all five steps and dispatches scaffold_context + wizard block', async () => {
    render(<NewProjectModal {...baseProps()} />);

    fireEvent.click(screen.getByText('Guided wizard'));

    // Step 1: Basics — Next disabled until required fields filled
    expect(screen.getByTestId('wizard-next-button')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 2: Product — required purpose field
    expect(screen.getByTestId('wizard-next-button')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore, avoid hazards' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 3: Design & Stack — fully optional, Next enabled immediately
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 4: Deployment — defaults to "skip", valid immediately
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 5: Review & Launch
    expect(screen.getByText(/Dig for ore, avoid hazards/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.payload.scaffold_context.project.name).toBe('Digger Game');
    expect(body.payload.wizard.deployment.provider).toBe('skip');
    expect(body.payload.repo_source).toEqual({ type: 'path', value: '/home/you/Code/digger-game' });
  });

  it('Back preserves previously entered values', async () => {
    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. casual browser-game players'), { target: { value: 'kids' } });

    // Back to Basics, then forward again to Product
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByPlaceholderText('e.g. Digger Game')).toHaveValue('Digger Game');
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    expect(screen.getByPlaceholderText(/2D digging\/mining game/)).toHaveValue('Dig for ore');
    expect(screen.getByPlaceholderText('e.g. casual browser-game players')).toHaveValue('kids');
  });
});
