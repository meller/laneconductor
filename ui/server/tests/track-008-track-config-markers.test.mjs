// ui/server/tests/track-008-track-config-markers.test.mjs
// Track 008 Phase 5: trackTemplates() gains an optional 5th-arg config
// object ({ mergeMode, autoRun, workspaceMode, model }) so the New Track
// modal can set them at creation time. Each marker is written ONLY when
// the caller explicitly asked for a value that differs from the silent
// default that would otherwise apply (mirrors **Track Kind**'s own
// sparse-emission convention already established in this file — see
// utils.test.mjs) — an always-present default marker on every new track
// would be pure noise (resolveMergeMode/parseAutoRun/resolveWorkspaceMode
// already treat "absent" as "default" everywhere else in the codebase).
import { describe, it, expect } from 'vitest';
import { trackTemplates } from '../utils.mjs';

describe('trackTemplates: per-track config markers (Track 008 Phase 5)', () => {
  it('emits no config markers at all when nothing is passed (today\'s behavior unchanged)', () => {
    const t = trackTemplates('006', 'Plain Feature', 'Desc');
    expect(t.index).not.toContain('**Merge Mode**');
    expect(t.index).not.toContain('**Auto Run**');
    expect(t.index).not.toContain('**Workspace**');
    expect(t.index).not.toContain('**Model**');
  });

  it('writes **Merge Mode**: direct when explicitly set to the non-default value', () => {
    const t = trackTemplates('007', 'T', 'D', 'feature', 'dev', 'plan', { mergeMode: 'direct' });
    expect(t.index).toContain('**Merge Mode**: direct');
  });

  it('does NOT write **Merge Mode** when explicitly set to "pr" (matches the silent default)', () => {
    const t = trackTemplates('008', 'T', 'D', 'feature', 'dev', 'plan', { mergeMode: 'pr' });
    expect(t.index).not.toContain('**Merge Mode**');
  });

  it('writes **Auto Run**: yes when explicitly true', () => {
    const t = trackTemplates('009', 'T', 'D', 'feature', 'dev', 'plan', { autoRun: true });
    expect(t.index).toContain('**Auto Run**: yes');
  });

  it('does NOT write **Auto Run** when false/omitted (matches the silent default)', () => {
    const t1 = trackTemplates('010', 'T', 'D', 'feature', 'dev', 'plan', { autoRun: false });
    const t2 = trackTemplates('011', 'T', 'D', 'feature', 'dev', 'plan');
    expect(t1.index).not.toContain('**Auto Run**');
    expect(t2.index).not.toContain('**Auto Run**');
  });

  it('writes **Workspace**: main when explicitly set to main', () => {
    const t = trackTemplates('012', 'T', 'D', 'feature', 'dev', 'plan', { workspaceMode: 'main' });
    expect(t.index).toContain('**Workspace**: main');
  });

  it('does NOT write **Workspace** when explicitly set to branch (matches the silent default)', () => {
    const t = trackTemplates('013', 'T', 'D', 'feature', 'dev', 'plan', { workspaceMode: 'branch' });
    expect(t.index).not.toContain('**Workspace**');
  });

  it('writes **Model**: <id> whenever a non-empty model is given (no silent default to compare against)', () => {
    const t = trackTemplates('014', 'T', 'D', 'feature', 'dev', 'plan', { model: 'claude-opus-5' });
    expect(t.index).toContain('**Model**: claude-opus-5');
  });

  it('all four markers together, plus a bug track\'s **Track Kind**, coexist correctly', () => {
    const t = trackTemplates('015', 'T', 'D', 'bug', 'dev', 'plan', {
      mergeMode: 'direct', autoRun: true, workspaceMode: 'main', model: 'claude-sonnet-5',
    });
    expect(t.index).toContain('**Track Kind**: bug');
    expect(t.index).toContain('**Merge Mode**: direct');
    expect(t.index).toContain('**Auto Run**: yes');
    expect(t.index).toContain('**Workspace**: main');
    expect(t.index).toContain('**Model**: claude-sonnet-5');
  });

  it('ignores an invalid mergeMode/workspaceMode rather than writing garbage (defense in depth — the endpoint validates first)', () => {
    const t = trackTemplates('016', 'T', 'D', 'feature', 'dev', 'plan', { mergeMode: 'bogus', workspaceMode: 'bogus' });
    expect(t.index).not.toContain('**Merge Mode**');
    expect(t.index).not.toContain('**Workspace**');
  });
});
