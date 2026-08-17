// Track 10014 TC-16: the Delete confirm button must stay disabled until the
// typed text exactly matches the project's name.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteProjectModal } from './DeleteProjectModal.jsx';
const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
}));
vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ apiFetch: mockApiFetch }),
}));

const project = { id: 1, name: 'Alpha', repo_path: '/repo/alpha' };

describe('DeleteProjectModal', () => {
  it('TC-16: confirm button is disabled until typed text matches the project name exactly', () => {
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={() => {}} />);
    const confirmBtn = screen.getByTestId('delete-submit');
    const input = screen.getByTestId('delete-confirm-input');

    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Alp' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Alpha' } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('the "also delete local files" checkbox is unchecked by default (safer/narrower default)', () => {
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByTestId('delete-local-files-checkbox')).not.toBeChecked();
  });

  it('sends deleteLocalFiles in the request body only when the checkbox is checked', async () => {
    mockApiFetch.mockClear();
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={() => {}} />);
    fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByTestId('delete-local-files-checkbox'));
    fireEvent.click(screen.getByTestId('delete-submit'));

    await new Promise(r => setTimeout(r, 0));
    expect(mockApiFetch).toHaveBeenCalledWith('/api/projects/1', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ deleteLocalFiles: true }),
    }));
  });
});
