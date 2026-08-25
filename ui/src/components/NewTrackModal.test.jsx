// ui/src/components/NewTrackModal.test.jsx
// Track 008 Phase 5, Task 6: the New Track modal's Advanced disclosure
// (Merge Mode / Workspace / Auto Run / Model) — verifies the default
// submission sends none of the optional fields, each field appears in the
// POST body once toggled away from its default, and `type` (the bug/
// feature selector) is always sent since Task 1's fix means the server
// now actually persists it as **Track Kind**.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewTrackModal } from './NewTrackModal.jsx';

const apiFetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ id: 1, track_number: '001', title: 'T', lane_status: 'plan', progress_percent: 0 }),
}));

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ apiFetch: (...args) => apiFetchMock(...args) }),
}));

function baseProps(overrides = {}) {
  return {
    projectId: 1,
    projects: [{ id: 1, name: 'Test Project', primary_cli: 'claude', primary_model: 'claude-sonnet-5' }],
    tracks: [],
    workers: [],
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onResumed: vi.fn(),
    ...overrides,
  };
}

function lastPostBody() {
  const call = apiFetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST');
  return JSON.parse(call[1].body);
}

async function fillTitleAndSubmit(title = 'A New Track') {
  fireEvent.change(screen.getByTestId('title-input'), { target: { value: title } });
  fireEvent.click(screen.getByText('Create Track'));
  await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
}

describe('NewTrackModal — Advanced config fields (Track 008 Phase 5)', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
  });

  it('Advanced disclosure is closed by default (native <details> element)', () => {
    render(<NewTrackModal {...baseProps()} />);
    const details = screen.getByTestId('advanced-toggle').closest('details');
    expect(details.open).toBe(false);
  });

  it('default submission: type is sent, merge_mode/auto_run/workspace_mode/model are all omitted', async () => {
    render(<NewTrackModal {...baseProps()} />);
    await fillTitleAndSubmit();

    const body = lastPostBody();
    expect(body.type).toBe('feature');
    expect(body).not.toHaveProperty('merge_mode');
    expect(body).not.toHaveProperty('auto_run');
    expect(body).not.toHaveProperty('workspace_mode');
    expect(body).not.toHaveProperty('model');
  });

  it('setting Merge Mode to Direct includes merge_mode: "direct" in the POST body', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('merge-mode-direct'));
    await fillTitleAndSubmit();

    expect(lastPostBody().merge_mode).toBe('direct');
  });

  it('re-selecting Merge Mode PR (the default) after toggling away omits it again', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('merge-mode-direct'));
    fireEvent.click(screen.getByTestId('merge-mode-pr'));
    await fillTitleAndSubmit();

    expect(lastPostBody()).not.toHaveProperty('merge_mode');
  });

  it('setting Workspace to Main includes workspace_mode: "main" in the POST body', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('workspace-mode-main'));
    await fillTitleAndSubmit();

    expect(lastPostBody().workspace_mode).toBe('main');
  });

  it('checking Auto Run includes auto_run: true in the POST body', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('auto-run-checkbox'));
    await fillTitleAndSubmit();

    expect(lastPostBody().auto_run).toBe(true);
  });

  it('unchecking Auto Run after checking it omits it again', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('auto-run-checkbox'));
    fireEvent.click(screen.getByTestId('auto-run-checkbox'));
    await fillTitleAndSubmit();

    expect(lastPostBody()).not.toHaveProperty('auto_run');
  });

  it('picking a Model includes it in the POST body', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-opus-5' } });
    await fillTitleAndSubmit();

    expect(lastPostBody().model).toBe('claude-opus-5');
  });

  it('type always appears in the POST body, including for a bug track', async () => {
    render(<NewTrackModal {...baseProps({ initialType: 'bug' })} />);
    await fillTitleAndSubmit('A Real Bug');

    expect(lastPostBody().type).toBe('bug');
  });

  it('all four Advanced fields set together all appear in the POST body', async () => {
    render(<NewTrackModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('merge-mode-direct'));
    fireEvent.click(screen.getByTestId('workspace-mode-main'));
    fireEvent.click(screen.getByTestId('auto-run-checkbox'));
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-opus-5' } });
    await fillTitleAndSubmit();

    const body = lastPostBody();
    expect(body.merge_mode).toBe('direct');
    expect(body.workspace_mode).toBe('main');
    expect(body.auto_run).toBe(true);
    expect(body.model).toBe('claude-opus-5');
  });
});
