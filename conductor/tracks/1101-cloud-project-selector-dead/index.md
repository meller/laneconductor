# Track 1101: Project selector is dead in Cloud mode (wrong prop name)

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Not started — found 2026-08-12
**Type**: bug
**Summary**: CloudAppInner passes `onSelect` to ProjectSelector, which only accepts `onChange` — so in cloud/remote mode changing the project dropdown does nothing at all. Local mode is unaffected.

## Problem

`ui/src/components/ProjectSelector.jsx` has the signature:

```js
export function ProjectSelector({ projects, selectedId, onChange })
```

Two call sites:

- `ui/src/App.jsx:386` (`AppContent`, local mode) — passes `onChange`. ✅
- `ui/src/App.jsx:740` (`CloudAppInner`, cloud/remote mode) — passes
  **`onSelect`**. ❌ `onChange` is `undefined`, so the select's handler
  throws (or silently no-ops) and `selectedProjectId` never updates.

Effect in cloud mode: picking a different project in the dropdown does
nothing — the board keeps showing whatever was loaded first. Since remote
mode is the multi-project/multi-user deployment, this makes project
switching unusable there.

Found during a local-mode e2e session, by reading the component's props
while debugging an unrelated harness issue — **not** caught by any test or
by the UI itself, because local mode (the only mode exercised here) uses
the correct prop.

## Solution

Rename the prop at the `CloudAppInner` call site to `onChange` (one-line
fix), **or** make `ProjectSelector` accept both and normalise.

Prefer fixing the call site: two names for one prop is how this class of
bug survives. If both are accepted, the component should at least warn on
the legacy name.

## Phases
- [ ] Phase 1: Fix the prop at `App.jsx:740`; grep for any other
      `ProjectSelector` usage with a mismatched prop.
- [ ] Phase 2: Guard against recurrence — either a prop-types/default
      assertion that throws in dev when `onChange` is missing, or a small
      test that renders both call sites' prop shapes.
- [ ] Phase 3: Verify in cloud mode. Local mode cannot reproduce this, so
      "works on my machine" is not evidence here — needs a remote/cloud
      deployment or `VITE_CLOUD_MODE=true` build.

## Notes

Cheap to fix, but deliberately filed rather than patched inline: it's in
`App.jsx`, which track 1092 is actively editing, and it can't be verified
in local mode — so a blind one-line change would be an unverified claim.
