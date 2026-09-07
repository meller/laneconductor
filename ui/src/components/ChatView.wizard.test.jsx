// Track 10069 Phase 7 (REQ-17..REQ-19): Conditional setup wizard
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChatView } from './ChatView.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({
  useWebSocket: () => {},
}));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function manager(overrides = {}) {
  return { id: 1, hostname: 'mgr-host', type: 'manager', project_id: null, ...overrides };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path) => {
    if (path.includes('/transcript')) return jsonResponse({ events: [], rawLog: null });
    if (path.includes('/comments')) return jsonResponse([]);
    if (path.includes('/api/state')) return jsonResponse({ gaps: [] });
    return jsonResponse([]);
  });
});

describe('ChatView conditional wizard (Phase 7, REQ-17..REQ-19)', () => {
  it('TC-7.1: with a blocking gap present, opening the view renders the wizard message naming that gap and its remedy', async () => {
    const blockingGap = {
      id: 'no-workers',
      severity: 'blocking',
      subject: 'No live worker',
      detail: 'No worker for this project has heartbeat within the staleness window.',
      remedy: 'Run `lc worker start` (or `lc start`) in the project directory.',
    };

    mockApiFetch.mockImplementation((path) => {
      if (path.includes('/api/state')) return jsonResponse({ gaps: [blockingGap] });
      return jsonResponse([]);
    });

    render(<ChatView projectId={1} workers={[manager()]} />);

    await waitFor(() => {
      const wizardMsg = screen.getByTestId('wizard-opening-message');
      expect(wizardMsg).toBeTruthy();
      expect(wizardMsg.textContent).toContain('No live worker');
      expect(wizardMsg.textContent).toContain('Run `lc worker start` (or `lc start`) in the project directory.');
    });
  });

  it('TC-7.2: with only advisory gaps, no wizard message renders; they appear as a header note instead', async () => {
    const advisoryGap = {
      id: 'no-manager',
      severity: 'advisory',
      subject: 'No manager worker',
      detail: 'No type: manager worker is registered on this machine.',
      remedy: 'Run `lc worker start --manager` to register a manager worker.',
    };

    mockApiFetch.mockImplementation((path) => {
      if (path.includes('/api/state')) return jsonResponse({ gaps: [advisoryGap] });
      return jsonResponse([]);
    });

    render(<ChatView projectId={1} workers={[manager()]} />);

    await waitFor(() => {
      // Advisory note is present
      const note = screen.getByTestId('advisory-gaps-note');
      expect(note).toBeTruthy();
      expect(note.textContent).toContain('No manager worker');
      expect(note.textContent).toContain('Run `lc worker start --manager`');
    });

    // REQ-17: Wizard opening message must NOT render for advisory-only gaps
    expect(screen.queryByTestId('wizard-opening-message')).toBeNull();

    // Advisory note is dismissible
    fireEvent.click(screen.getByTestId('dismiss-advisory-gaps'));
    expect(screen.queryByTestId('advisory-gaps-note')).toBeNull();
  });

  it('TC-7.3: with zero gaps, opening the view issues no POST at all', async () => {
    mockApiFetch.mockImplementation((path) => {
      if (path.includes('/api/state')) return jsonResponse({ gaps: [] });
      return jsonResponse([]);
    });

    render(<ChatView projectId={1} workers={[manager()]} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/state'));
    });

    // Zero gaps: neither wizard message nor advisory note appears
    expect(screen.queryByTestId('wizard-opening-message')).toBeNull();
    expect(screen.queryByTestId('advisory-gaps-note')).toBeNull();

    // REQ-18 / AC-10: Assert no POST requests made (no dispatch row, no comment written)
    const postCalls = mockApiFetch.mock.calls.filter(([_, opts]) => opts?.method === 'POST');
    expect(postCalls.length).toBe(0);
  });

  it('TC-7.4: the wizard message is rendered client-side from the gap list, with no model turn dispatched to produce it', async () => {
    const blockingGap = {
      id: 'no-provider',
      severity: 'blocking',
      subject: 'Primary provider unreachable',
      detail: 'The configured primary CLI is not reachable on this machine.',
      remedy: 'Run `lc setup` and choose a primary CLI, then verify it with `<cli> --version`.',
    };

    mockApiFetch.mockImplementation((path) => {
      if (path.includes('/api/state')) return jsonResponse({ gaps: [blockingGap] });
      return jsonResponse([]);
    });

    render(<ChatView projectId={1} workers={[manager()]} />);

    await waitFor(() => {
      expect(screen.getByTestId('wizard-opening-message')).toBeTruthy();
    });

    // No POST/dispatch was sent to any model endpoint or worker_dispatch
    const postCalls = mockApiFetch.mock.calls.filter(([_, opts]) => opts?.method === 'POST');
    expect(postCalls.length).toBe(0);
  });
});
