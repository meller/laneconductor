// Track 10011: Primary/Secondary CLI dropdowns must offer every registry
// provider (previously hardcoded to claude/gemini/other, silently omitting
// copilot and antigravity).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjectConfigSettings } from './ProjectConfigSettings.jsx';

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({
    apiFetch: async (path) => {
      if (path.includes('/config')) {
        return {
          ok: true,
          json: async () => ({
            primary: { cli: 'claude', model: null },
            secondary: null,
            dev: null,
            create_quality_gate: false,
          }),
        };
      }
      return { ok: true, json: async () => [] };
    },
  }),
}));

describe('ProjectConfigSettings — CLI dropdowns', () => {
  it('TC-22/TC-23: primary and secondary CLI selects list all four registry providers', async () => {
    render(<ProjectConfigSettings projectId={1} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Loading config...')).not.toBeInTheDocument());

    const expected = ['claude', 'gemini', 'copilot', 'antigravity'];

    const primarySelect = screen.getByText('Primary CLI').parentElement.querySelector('select');
    const primaryValues = Array.from(primarySelect.options).map(o => o.value);
    for (const id of expected) expect(primaryValues).toContain(id);

    const secondarySelect = screen.getByText('Secondary CLI (optional)').parentElement.querySelector('select');
    const secondaryValues = Array.from(secondarySelect.options).map(o => o.value);
    for (const id of expected) expect(secondaryValues).toContain(id);
  });
});
