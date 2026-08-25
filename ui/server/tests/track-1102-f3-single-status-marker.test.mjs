// Track 1102 F3: a track scaffolded by trackTemplates() (ui/server/utils.mjs,
// used by POST /track's local-filesystem creation path) used to bake in a
// legacy `**Status**: <lane>` marker alongside `**Lane**:`/`**Lane Status**:`.
// Nothing ever updates `**Status**` after creation (see parse-status.mjs's
// own doc comment for the track-10012 revert incident this caused), so the
// two silently diverge the first time the card moves lanes. `**Lane**` is
// the sole authoritative marker going forward — trackTemplates() must not
// emit `**Status**` at all.
import { describe, it, expect } from 'vitest';
import { trackTemplates } from '../utils.mjs';

describe('Track 1102 F3: trackTemplates() emits one lane marker', () => {
  it('bug-type index.md has no legacy **Status** marker', () => {
    const t = trackTemplates('002', 'My Bug', 'Repro steps', 'bug');
    expect(t.index).not.toMatch(/\*\*Status\*\*:/);
  });

  it('feature-type (default) index.md has no legacy **Status** marker', () => {
    const t = trackTemplates('001', 'My Feature', 'Desc');
    expect(t.index).not.toMatch(/\*\*Status\*\*:/);
  });

  it('bug-type index.md carries **Lane** and **Lane Status** instead', () => {
    const t = trackTemplates('002', 'My Bug', 'Repro steps', 'bug');
    expect(t.index).toMatch(/\*\*Lane\*\*:\s*plan/);
    expect(t.index).toMatch(/\*\*Lane Status\*\*:\s*queue/);
  });

  it('feature-type index.md carries **Lane** and **Lane Status** instead', () => {
    const t = trackTemplates('001', 'My Feature', 'Desc');
    expect(t.index).toMatch(/\*\*Lane\*\*:\s*plan/);
    expect(t.index).toMatch(/\*\*Lane Status\*\*:\s*queue/);
  });

  it('respects a non-default laneStatus argument for **Lane**', () => {
    const t = trackTemplates('003', 'Imported', 'Desc', 'feature', 'dev', 'backlog');
    expect(t.index).toMatch(/\*\*Lane\*\*:\s*backlog/);
    expect(t.index).not.toMatch(/\*\*Status\*\*:/);
  });
});
