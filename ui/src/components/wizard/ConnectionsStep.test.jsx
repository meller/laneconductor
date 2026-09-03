// ui/src/components/wizard/ConnectionsStep.test.jsx
// Track TU-10049 Phase 3 (TC-18..TC-25): the Connections step's three
// category pickers, disabled FFU alternatives, credential badges, and the
// non-blocking / no-secret-in-request guarantees.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionsStep, connectionsStepValid } from './ConnectionsStep.jsx';
import { defaultConnectionsState } from '../../lib/connectors.js';

const apiFetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({ apiFetch: (...args) => apiFetchMock(...args) }),
}));

function Wrapper({ workerId = 1, showCategories, repoUrl }) {
  const [value, setValue] = React.useState(defaultConnectionsState());
  return <ConnectionsStep value={value} onChange={setValue} workerId={workerId} showCategories={showCategories} repoUrl={repoUrl} />;
}

describe('ConnectionsStep', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    apiFetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
  });

  it('TC-18: renders three category pickers, each defaulting to Skip', () => {
    render(<Wrapper />);
    expect(screen.getByTestId('connections-source_control')).toBeInTheDocument();
    expect(screen.getByTestId('connections-issue_tracker')).toBeInTheDocument();
    expect(screen.getByTestId('connections-cloud')).toBeInTheDocument();
    // one "Skip" radio per category, all checked by default
    const skipRadios = screen.getAllByText('Skip — configure later').map(el => el.closest('label').querySelector('input'));
    for (const radio of skipRadios) expect(radio.checked).toBe(true);
  });

  it('TC-19: alternatives render disabled and carry an FFU marker', () => {
    render(<Wrapper />);
    const gitlab = screen.getByTestId('connections-alt-source_control-gitlab');
    expect(gitlab).toBeDisabled();
    expect(screen.getByText(/GitLab — FFU/)).toBeInTheDocument();
  });

  it('TC-20: clicking a disabled alternative leaves the category selection unchanged', () => {
    render(<Wrapper />);
    const gitlab = screen.getByTestId('connections-alt-source_control-gitlab');
    fireEvent.click(gitlab);
    // Skip is still selected — no error, no state change
    const skipRadio = screen.getByTestId('connections-source_control').querySelectorAll('input')[0];
    expect(skipRadio.checked).toBe(true);
    expect(gitlab.checked).toBe(false);
  });

  it('TC-21: choosing Jira reveals domain/email/project-key/token-env fields, defaulting token env', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-issue_tracker'));
    expect(screen.getByTestId('connections-jira-domain')).toBeInTheDocument();
    expect(screen.getByTestId('connections-jira-token-env').placeholder).toBe('JIRA_API_TOKEN');
  });

  it('TC-22: badge shows verified/NOT CONFIGURED from the mocked API', async () => {
    apiFetchMock.mockImplementation(async url => {
      if (url.includes('provider=github')) return { ok: true, json: async () => ({ provider: 'github', status: 'verified', detail: null }) };
      return { ok: true, json: async () => ({}) };
    });
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-source_control'));
    await waitFor(() => expect(screen.getByTestId('connections-credential-status')).toHaveTextContent(/verified/));
  });

  it('TC-22b: shows NOT CONFIGURED with remediation copy', async () => {
    apiFetchMock.mockImplementation(async url => {
      if (url.includes('provider=github')) return { ok: true, json: async () => ({ provider: 'github', status: 'NOT CONFIGURED', detail: null }) };
      return { ok: true, json: async () => ({}) };
    });
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-source_control'));
    await waitFor(() => expect(screen.getByTestId('connections-credential-status')).toHaveTextContent(/NOT CONFIGURED/));
    expect(screen.getByTestId('connections-credential-status')).toHaveTextContent(/gh auth login/);
  });

  it('TC-23: a failing/unreachable credential endpoint degrades to a muted message, step still usable', async () => {
    apiFetchMock.mockImplementation(async () => { throw new Error('network down'); });
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-source_control'));
    await waitFor(() => expect(screen.getByTestId('connections-credential-status')).toHaveTextContent(/unavailable/));
    expect(connectionsStepValid()).toBe(true);
  });

  it('TC-24: Jira text input changes are debounced — far fewer requests than keystrokes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-issue_tracker'));
    fireEvent.change(screen.getByTestId('connections-jira-email'), { target: { value: 'me@acme.com' } });
    fireEvent.change(screen.getByTestId('connections-jira-project-key'), { target: { value: 'ACME' } });

    const domainInput = screen.getByTestId('connections-jira-domain');
    const chars = 'acme.atlassian.net'.split('');
    let acc = '';
    for (const ch of chars) {
      acc += ch;
      fireEvent.change(domainInput, { target: { value: acc } });
    }
    apiFetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    // one debounced call, not one per keystroke (18 keystrokes)
    expect(apiFetchMock.mock.calls.length).toBeLessThan(3);
    vi.useRealTimers();
  });

  it('TC-3.2: GitHub reads the repo value already entered on Basics, shown alongside the picker', () => {
    render(<Wrapper repoUrl="git@github.com:acme/widget.git" />);
    fireEvent.click(screen.getByTestId('connections-real-source_control'));
    expect(screen.getByTestId('connections-github-repo')).toHaveTextContent('git@github.com:acme/widget.git');
  });

  it('TC-25: the credentials request carries token_env (a name), never a token value', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId('connections-real-issue_tracker'));
    fireEvent.change(screen.getByTestId('connections-jira-domain'), { target: { value: 'acme.atlassian.net' } });
    fireEvent.change(screen.getByTestId('connections-jira-email'), { target: { value: 'me@acme.com' } });
    fireEvent.change(screen.getByTestId('connections-jira-project-key'), { target: { value: 'ACME' } });
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();

    const jiraCall = apiFetchMock.mock.calls.find(([url]) => url.includes('provider=jira'));
    expect(jiraCall).toBeTruthy();
    expect(jiraCall[0]).toContain('token_env=JIRA_API_TOKEN');
    expect(jiraCall[0]).not.toMatch(/token=/);
  });
});

describe('ConnectionsStep — marketing kind (AC-7)', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('shows only the issue-tracker picker when showCategories restricts to it', () => {
    render(<Wrapper showCategories={['issue_tracker']} />);
    expect(screen.queryByTestId('connections-source_control')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connections-cloud')).not.toBeInTheDocument();
    expect(screen.getByTestId('connections-issue_tracker')).toBeInTheDocument();
  });
});
