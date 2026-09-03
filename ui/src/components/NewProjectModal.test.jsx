// ui/src/components/NewProjectModal.test.jsx
// Track AM-1119 Phase 1: verifies (a) "Quick create" still dispatches the
// legacy scaffold_context-only payload unchanged, and (b) the "Guided
// wizard" toggle walks through all steps and dispatches a payload with the
// additional `wizard` block, via the same /api/dispatch/create-project
// endpoint. Track TU-10049 Phase 4 adds the Connections step (source
// control / issue tracker / cloud) between Design & Stack and Deployment
// for 'app' (six steps total) and an issue-tracker-only variant for
// 'marketing' (four steps total).
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

  it('walks all six steps and dispatches scaffold_context + wizard block', async () => {
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

    // Step 4: Connections (Track TU-10049) — fully optional, Next enabled immediately
    expect(screen.getByTestId('connections-source_control')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 5: Deployment — defaults to "skip", valid immediately
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 6: Review & Launch
    expect(screen.getByText(/Dig for ore, avoid hazards/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.payload.scaffold_context.project.name).toBe('Digger Game');
    expect(body.payload.wizard.deployment.provider).toBe('skip');
    expect(body.payload.repo_source).toEqual({ type: 'path', value: '/home/you/Code/digger-game' });
  });

  // Track TU-10049 Phase 4 (TC-28, AC-1): every category left on Skip —
  // Connections never blocks Next, and the payload records three explicit
  // skips rather than omitting the key.
  it('TC-28: leaving every Connections category on Skip still dispatches and reaches Launch', async () => {
    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Design & Stack
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Connections — all skip
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Deployment
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Launch

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.payload.wizard.connections).toEqual({
      source_control: { provider: 'skip' },
      issue_tracker: { provider: 'skip' },
      cloud: { provider: 'skip' },
    });
  });

  // Track TU-10049 Phase 4 (TC-27, REQ-6): a full Jira connection dispatches
  // the exact wizard.connections shape spec.md defines.
  it('TC-27: entering Jira details on Connections dispatches wizard.connections.issue_tracker', async () => {
    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Design & Stack

    // Connections
    fireEvent.click(screen.getByTestId('connections-real-issue_tracker'));
    fireEvent.change(screen.getByTestId('connections-jira-domain'), { target: { value: 'acme.atlassian.net' } });
    fireEvent.change(screen.getByTestId('connections-jira-email'), { target: { value: 'me@acme.com' } });
    fireEvent.change(screen.getByTestId('connections-jira-project-key'), { target: { value: 'ACME' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Deployment
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Launch

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.payload.wizard.connections.issue_tracker).toEqual({
      provider: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: 'JIRA_API_TOKEN',
    });
  });

  // Track TU-10049 Phase 4 (TC-29): Back from Connections preserves entered
  // values, matching the existing Back-preserves guarantee for other steps.
  it('TC-29: Back from Deployment to Connections preserves entered Jira values', async () => {
    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Design & Stack

    fireEvent.click(screen.getByTestId('connections-real-issue_tracker'));
    fireEvent.change(screen.getByTestId('connections-jira-domain'), { target: { value: 'acme.atlassian.net' } });
    fireEvent.click(screen.getByTestId('wizard-next-button')); // → Deployment

    fireEvent.click(screen.getByText('Back')); // → back to Connections
    expect(screen.getByTestId('connections-jira-domain')).toHaveValue('acme.atlassian.net');
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

  // Track AM-1119 Phase 2 (Task 2/3, TC-4/TC-5): Deployment step wiring —
  // selecting a real provider (a) produces a wizard.deployment payload with
  // that provider's environments, and (b) fetches + renders the worker-side
  // credential status badge without ever blocking Next/Launch on it.
  it('selecting Firebase + an environment dispatches wizard.deployment and shows a non-blocking credential badge', async () => {
    apiFetchMock.mockImplementation(async (url = '') => {
      if (url.includes('/deploy-credentials')) {
        return { ok: true, json: async () => ({ provider: 'firebase', status: 'verified', detail: null }) };
      }
      return { ok: true, json: async () => ({ id: 42, status: 'pending', result: null }) };
    });

    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Digger Game' } });
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/digger-game' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Dig for ore' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    fireEvent.click(screen.getByTestId('wizard-next-button')); // Design & Stack — skip
    fireEvent.click(screen.getByTestId('wizard-next-button')); // Connections — skip

    // Step 5: Deployment
    fireEvent.click(screen.getByText('Firebase Hosting'));
    expect(screen.getByTestId('wizard-next-button')).toBeDisabled(); // no environment picked yet
    fireEvent.click(screen.getByText('prod'));
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();

    await waitFor(() => expect(screen.getByTestId('deploy-credential-status')).toHaveTextContent(/verified/));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/workers/1/deploy-credentials?provider=firebase');

    fireEvent.click(screen.getByTestId('wizard-next-button')); // → Review
    fireEvent.click(screen.getByTestId('wizard-next-button')); // → Launch

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/dispatch/create-project', expect.any(Object)));
    const body = lastPostBody();
    expect(body.payload.wizard.deployment).toEqual({ provider: 'firebase', environments: ['prod'] });
  });

  // Track AM-1121: a "Marketing / growth (no code)" project skips
  // Design & Stack and Deployment entirely (three steps, not five) and
  // tags scaffold_context.project.kind so the manager worker routes track
  // generation through the marketing skills instead of deriveTrackPlan's
  // app-shaped templates.
  it('Marketing project type skips Design/Stack + Deployment and tags kind: marketing', async () => {
    render(<NewProjectModal {...baseProps()} />);
    fireEvent.click(screen.getByText('Guided wizard'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Digger Game'), { target: { value: 'Book Marketing' } });
    fireEvent.click(screen.getByText('Marketing / growth (no code)'));
    fireEvent.change(screen.getByPlaceholderText('/home/you/Code/digger-game'), { target: { value: '/home/you/Code/book-marketing' } });
    expect(screen.getByTestId('wizard-next-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 2: Product
    fireEvent.change(screen.getByPlaceholderText(/2D digging\/mining game/), { target: { value: 'Sell more copies of the book' } });
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 3: Connections (Track TU-10049, AC-7) — issue-tracker only, no
    // source-control or cloud picker, since a marketing project has no repo
    // and no cloud project.
    expect(screen.getByTestId('connections-issue_tracker')).toBeInTheDocument();
    expect(screen.queryByTestId('connections-source_control')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connections-cloud')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    // Step 4 is Review & Launch — no Design/Stack or Deployment step
    expect(screen.getByText(/Sell more copies of the book/)).toBeInTheDocument();
    expect(screen.queryByText(/Deployment:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.payload.scaffold_context.project.kind).toBe('marketing');
    expect(body.payload.wizard.design).toBeNull();
    expect(body.payload.wizard.deployment).toEqual({ provider: 'skip', environments: [] });
    // Marketing dispatches only issue_tracker — no source_control/cloud keys (spec.md REQ-6)
    expect(body.payload.wizard.connections).toEqual({ issue_tracker: { provider: 'skip' } });
  });
});
