// WorktreesPanel — deep-link highlight (companion to TrackCard's new
// "View in Worktrees" link). App passes the clicked track's number down as
// `highlightTrack`; the matching row should visually stand out and scroll
// into view so the deep link actually lands the user somewhere useful in a
// panel that can hold dozens of rows.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorktreesPanel } from './WorktreesPanel.jsx';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

const rowA = { track: '1118', title: 'Manager Worker Credential Storage', lane: 'done', lane_status: 'success', class: 'mergeable', merge_mode: 'direct', ahead: 1, behind: 0, dirty: 0 };
const rowB = { track: '1119', title: 'App Creator Wizard', lane: 'done', lane_status: 'success', class: 'mergeable', merge_mode: 'direct', ahead: 1, behind: 0, dirty: 0 };

function mockWorktreesEndpoints(rows) {
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((url) => {
    if (url.includes('/worktrees') && !url.includes('/refresh')) return Promise.resolve(jsonResponse(rows));
    if (url.includes('/dev-server/status')) return Promise.resolve(jsonResponse({ preview_track: null }));
    return Promise.resolve(jsonResponse({}));
  });
}

async function renderPanel(rows, highlightTrack) {
  mockWorktreesEndpoints(rows);
  render(<WorktreesPanel projectId={1} highlightTrack={highlightTrack} />);
  await waitFor(() => expect(screen.queryByText('Loading worktrees…')).not.toBeInTheDocument());
}

function rowFor(track) {
  const row = screen.getAllByTestId('worktree-row').find(el => el.dataset.track === track);
  if (!row) throw new Error(`no worktree-row found for track ${track}`);
  return row;
}

describe('WorktreesPanel — deep-link highlight', () => {
  it('marks the row matching highlightTrack as highlighted', async () => {
    await renderPanel([rowA, rowB], '1118');
    expect(rowFor('1118').dataset.highlighted).toBe('true');
  });

  it('does not mark other rows as highlighted', async () => {
    await renderPanel([rowA, rowB], '1118');
    expect(rowFor('1119').dataset.highlighted).not.toBe('true');
  });

  it('marks no row as highlighted when highlightTrack is not provided', async () => {
    await renderPanel([rowA, rowB], undefined);
    expect(rowFor('1118').dataset.highlighted).not.toBe('true');
    expect(rowFor('1119').dataset.highlighted).not.toBe('true');
  });

  it('scrolls the highlighted row into view', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await renderPanel([rowA, rowB], '1118');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
