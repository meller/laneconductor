// Track 1116: Provider + Model dropdowns in the per-lane panel (REQ-1/REQ-2),
// replacing the free-text primary_model field that never actually shipped on
// this branch (see plan.md Phase 1 finding) — this is a from-scratch add.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WorkflowSettings } from './WorkflowSettings.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

beforeEach(() => {
  mockApiFetch.mockReset();
});

function baseConfig() {
  return {
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, primary_model: 'claude-opus-5', on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 1, max_retries: 3, on_success: 'review:queue', on_failure: 'implement:failure' },
      review: { parallel_limit: 1, max_retries: 1, on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, on_success: 'done:success', on_failure: 'plan:queue' },
      done: { parallel_limit: 1 },
    },
  };
}

function mockFetchWorkflow(config) {
  mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => config });
}

async function openLanePanel(laneId) {
  await waitFor(() => expect(screen.queryByText('Loading workflow...')).not.toBeInTheDocument());
  // react-flow renders its nodes asynchronously after the initial layout
  // effect — findByTestId retries until it appears (matches the real
  // Playwright walkthrough, where the same click needed no extra wait).
  const node = await screen.findByTestId(`rf__node-${laneId}`);
  fireEvent.click(node);
  await waitFor(() => expect(screen.getByTestId('lane-provider-select')).toBeInTheDocument());
}

describe('WorkflowSettings — Provider + Model dropdowns (Track 1116)', () => {
  it('TC-1: per-lane panel renders a Provider select and a Model select, no free-text primary_model input', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude', primary_model: 'claude-sonnet-5' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan');

    expect(screen.getByTestId('lane-provider-select')).toBeInTheDocument();
    expect(screen.getByTestId('lane-model-select')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/primary model/i)).not.toBeInTheDocument();
  });

  it('TC-2: Provider select options match the 4 registry providers', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan');

    const providerSelect = screen.getByTestId('lane-provider-select');
    const optionLabels = Array.from(providerSelect.options).map(o => o.textContent);
    expect(optionLabels).toEqual(['Claude', 'Gemini', 'Copilot', 'Antigravity']);
  });

  it('TC-3: a lane with no primary_model defaults Provider/Model to getDefaultProviderModel()\'s result', async () => {
    mockFetchWorkflow(baseConfig());
    // Project has nothing configured and no live workers — resolver falls to
    // the static registry recommendation (claude / claude-sonnet-5).
    render(<WorkflowSettings projectId={1} project={{}} workers={[]} onClose={() => {}} />);
    await openLanePanel('implement'); // implement lane has no primary_model in baseConfig()

    const providerSelect = screen.getByTestId('lane-provider-select');
    expect(providerSelect.value).toBe('claude');
    const modelSelect = screen.getByTestId('lane-model-select');
    expect(modelSelect.value).toBe(''); // nothing saved yet — shows the "use project default" slot
    // ...but the first real option (after the blank) is the resolver's recommended model.
    expect(modelSelect.options[1].value).toBe('claude-sonnet-5');
  });

  it('TC-4: a lane with a pre-existing primary_model opens with Provider=Claude, Model=claude-opus-5 pre-selected (no regression)', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan'); // plan lane has primary_model: claude-opus-5

    const providerSelect = screen.getByTestId('lane-provider-select');
    expect(providerSelect.value).toBe('claude');
    const modelSelect = screen.getByTestId('lane-model-select');
    expect(modelSelect.value).toBe('claude-opus-5');
  });

  it('TC-5: a worker reporting live available_models surfaces those ids in the Model dropdown', async () => {
    mockFetchWorkflow(baseConfig());
    const workers = [{ cli: 'claude', available_models: ['claude-sonnet-4-6', 'claude-opus-4-6-thinking'] }];
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={workers} onClose={() => {}} />);
    await openLanePanel('plan');

    const modelSelect = screen.getByTestId('lane-model-select');
    const values = Array.from(modelSelect.options).map(o => o.value);
    expect(values).toEqual(expect.arrayContaining(['claude-sonnet-4-6', 'claude-opus-4-6-thinking']));
  });

  it('TC-6: no worker reporting live models falls back to static presets without throwing or an empty list', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan');

    const modelSelect = screen.getByTestId('lane-model-select');
    expect(modelSelect.options.length).toBeGreaterThan(1);
    expect(Array.from(modelSelect.options).map(o => o.value)).toContain('claude-sonnet-5');
  });

  it('TC-7: selecting a model and saving writes the plain model-id string into lanes.<lane>.primary_model', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('implement');

    const modelSelect = screen.getByTestId('lane-model-select');
    fireEvent.change(modelSelect, { target: { value: 'claude-3-5-haiku' } });

    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fireEvent.click(screen.getByText('Save Configuration'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/workflow',
      expect.objectContaining({ method: 'POST' })
    ));
    const saveCall = mockApiFetch.mock.calls.find(([url, opts]) => url === '/api/projects/1/workflow' && opts?.method === 'POST');
    const body = JSON.parse(saveCall[1].body);
    expect(body.config.lanes.implement.primary_model).toBe('claude-3-5-haiku');
  });

  it('TC-8: clearing the Model selection back to "use project default" removes primary_model from that lane on save', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan'); // plan lane starts with primary_model: claude-opus-5

    const modelSelect = screen.getByTestId('lane-model-select');
    fireEvent.change(modelSelect, { target: { value: '' } });

    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fireEvent.click(screen.getByText('Save Configuration'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/workflow',
      expect.objectContaining({ method: 'POST' })
    ));
    const saveCall = mockApiFetch.mock.calls.find(([url, opts]) => url === '/api/projects/1/workflow' && opts?.method === 'POST');
    const body = JSON.parse(saveCall[1].body);
    expect(body.config.lanes.plan.primary_model).toBeUndefined();
  });

  it('TC-9: parallel_limit, max_retries, on_success, on_failure still work unchanged', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await openLanePanel('plan');

    fireEvent.change(screen.getByPlaceholderText('e.g. 1'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 0'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. implement or plan:success'), { target: { value: 'implement' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. backlog or plan:failure'), { target: { value: 'backlog' } });

    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fireEvent.click(screen.getByText('Save Configuration'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/workflow',
      expect.objectContaining({ method: 'POST' })
    ));
    const saveCall = mockApiFetch.mock.calls.find(([url, opts]) => url === '/api/projects/1/workflow' && opts?.method === 'POST');
    const body = JSON.parse(saveCall[1].body);
    expect(body.config.lanes.plan.parallel_limit).toBe(2);
    expect(body.config.lanes.plan.max_retries).toBe(5);
    expect(body.config.lanes.plan.on_success).toBe('implement');
    expect(body.config.lanes.plan.on_failure).toBe('backlog');
  });

  it('TC-15: help box mentions worker-mode-only and best-effort caveats', async () => {
    mockFetchWorkflow(baseConfig());
    render(<WorkflowSettings projectId={1} project={{ primary_cli: 'claude' }} workers={[]} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Loading workflow...')).not.toBeInTheDocument());

    expect(screen.getByText(/applies in worker mode/i)).toBeInTheDocument();
    expect(screen.getByText(/best-effort/i)).toBeInTheDocument();
  });
});
