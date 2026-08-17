// Track 10014 Phase 5: ConductorPanel gains an Edit/Save/Cancel mode for
// allow-listed tabs (matches the PATCH /api/projects/:id/conductor/:key
// allow-list added in Phase 2), while `workflow` and dynamically-added
// `sg_*` styleguide tabs must NOT get an Edit button (TC-20).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConductorPanel } from './ConductorPanel.jsx';

vi.mock('../hooks/useWebSocket.js', () => ({ useWebSocket: () => {} }));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('../hooks/useApi.js', () => ({ useApi: () => ({ apiFetch: mockApiFetch }) }));

const project = { id: 1, name: 'Alpha', repo_path: '/repo/alpha' };

function mockFilesResponse(files) {
  return { ok: true, json: async () => files };
}

describe('ConductorPanel — edit mode', () => {
  it('TC-18/TC-19: product tab can be edited, saved, and cancelled', async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValueOnce(mockFilesResponse({ product: 'Old product doc' }));

    render(<ConductorPanel project={project} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Old product doc')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('conductor-edit-btn'));
    const textarea = screen.getByTestId('conductor-edit-textarea');
    expect(textarea.value).toBe('Old product doc');

    fireEvent.change(textarea, { target: { value: 'New product doc' } });

    // Cancel restores original content, no API call.
    fireEvent.click(screen.getByTestId('conductor-cancel-btn'));
    expect(screen.getByText('Old product doc')).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // only the initial GET

    // Edit again and Save this time.
    fireEvent.click(screen.getByTestId('conductor-edit-btn'));
    fireEvent.change(screen.getByTestId('conductor-edit-textarea'), { target: { value: 'New product doc' } });
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByTestId('conductor-save-btn'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/1/conductor/product',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ content: 'New product doc' }) })
    ));
  });

  it('TC-20: workflow tab has no Edit button (excluded from the allow-list)', async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValueOnce(mockFilesResponse({ workflow_json: '{}' }));

    render(<ConductorPanel project={project} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Loading context files…')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('Workflow'));
    expect(screen.queryByTestId('conductor-edit-btn')).not.toBeInTheDocument();
  });

  it('TC-20: styleguide (sg_*) tabs have no Edit button', async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValueOnce(mockFilesResponse({ code_styleguides: { javascript: '# JS style' } }));

    render(<ConductorPanel project={project} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Javascript Style')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Javascript Style'));
    expect(screen.queryByTestId('conductor-edit-btn')).not.toBeInTheDocument();
  });
});
