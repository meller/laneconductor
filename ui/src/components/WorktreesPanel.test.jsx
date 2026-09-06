// ui/src/components/WorktreesPanel.test.jsx
// Track 10024: a running row's "Running…" state must be clickable (not just
// a disabled button label) and must carry a { transcript: true } intent
// through onSelectTrack, so App can auto-open TrackDetailPanel's Transcript
// drawer. A non-running row's existing #<track> ↗ link must keep behaving
// exactly as before (transcript: false).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WorktreesPanel } from './WorktreesPanel.jsx';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

const runningRow = { track: '19997', title: 'Running row', lane: 'implement', lane_status: 'running', class: 'open', merge_mode: 'direct', ahead: 1, behind: 0, dirty: 0 };
const idleRow = { track: '19996', title: 'Idle row', lane: 'implement', lane_status: 'queue', class: 'open', merge_mode: 'direct', ahead: 1, behind: 0, dirty: 0 };
const detachedRow = { track: null, branch: 'scratch/foo', class: 'detached', merge_mode: 'direct' };

function mockWorktreesEndpoints(rows) {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((url) => {
    if (url.includes('/worktrees') && !url.includes('/refresh')) return Promise.resolve(jsonResponse(rows));
    if (url.includes('/dev-server/status')) return Promise.resolve(jsonResponse({ preview_track: null }));
    return Promise.resolve(jsonResponse({}));
  });
}

async function renderPanel(rows, onSelectTrack = vi.fn()) {
  mockWorktreesEndpoints(rows);
  render(<WorktreesPanel projectId={1} onSelectTrack={onSelectTrack} />);
  await waitFor(() => expect(screen.queryByText('Loading worktrees…')).not.toBeInTheDocument());
  return onSelectTrack;
}

function trackLinkFor(track) {
  // The link's text is "#<track> ↗" as adjacent text nodes ("#" + track + " ↗"),
  // so an exact match on "#<track>" alone never matches — partial match instead.
  return screen.getByText(`#${track}`, { selector: 'button', exact: false });
}

function cardFor(track) {
  return trackLinkFor(track).closest('[data-testid="worktree-row"]');
}

describe('WorktreesPanel — running-row transcript deep link', () => {
  it('TC-7: a running row renders a clickable running badge', async () => {
    await renderPanel([runningRow]);
    const card = cardFor('19997');
    expect(within(card).getByTestId('worktree-running-badge')).toHaveTextContent(/Running/i);
  });

  it('TC-8: an idle row renders no running badge', async () => {
    await renderPanel([idleRow]);
    const card = cardFor('19996');
    expect(within(card).queryByTestId('worktree-running-badge')).toBeNull();
  });

  it('TC-9: clicking the running badge calls onSelectTrack with transcript: true', async () => {
    const onSelectTrack = await renderPanel([runningRow]);
    const card = cardFor('19997');
    fireEvent.click(within(card).getByTestId('worktree-running-badge'));
    expect(onSelectTrack).toHaveBeenCalledWith(1, '19997', { transcript: true });
  });

  it('TC-10: clicking the #<track> ↗ link on a running row also carries transcript: true', async () => {
    const onSelectTrack = await renderPanel([runningRow]);
    fireEvent.click(trackLinkFor('19997'));
    expect(onSelectTrack).toHaveBeenCalledWith(1, '19997', { transcript: true });
  });

  it('TC-11: clicking the #<track> ↗ link on an idle row carries transcript: false (unchanged behavior)', async () => {
    const onSelectTrack = await renderPanel([idleRow]);
    fireEvent.click(trackLinkFor('19996'));
    expect(onSelectTrack).toHaveBeenCalledWith(1, '19996', { transcript: false });
  });

  it('TC-11b: a detached row (no track) renders neither a running badge nor a select-track link', async () => {
    await renderPanel([detachedRow]);
    expect(screen.queryByTestId('worktree-running-badge')).toBeNull();
    expect(screen.queryByText('scratch/foo', { selector: 'button', exact: false })).toBeNull();
  });

  // Found live 2026-09-06: with "All Projects" selected, projectId is
  // falsy, and fetchRows() used to bail out with a bare `return` before
  // ever calling setLoading(false) — the effect that fires it always sets
  // loading true first, so the panel showed "Loading worktrees…"
  // indefinitely, with no error and no way to tell it wasn't just slow.
  it('TC-12: with no project selected, shows "Select a Project" instead of spinning forever', async () => {
    mockWorktreesEndpoints([]);
    render(<WorktreesPanel projectId={null} onSelectTrack={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading worktrees…')).not.toBeInTheDocument());
    expect(screen.getByText('Select a Project')).toBeTruthy();
    expect(mockApiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/worktrees'));
  });
});
