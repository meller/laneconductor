# Spec: Track 1101 — Project selector prop mismatch in the cloud app shell

## Problem Statement

`ui/src/components/ProjectSelector.jsx` destructures exactly one callback
prop:

```js
export function ProjectSelector({ projects, selectedId, onChange })
```

Its `<select>` calls `onChange(...)` unconditionally in its own handler.
There are two call sites:

| Call site | Component | Prop passed | State |
|-----------|-----------|-------------|-------|
| `ui/src/App.jsx:440` | `AppContent` (local dashboard) | `onChange` | correct |
| `ui/src/App.jsx:898` | `CloudAppInner` (cloud shell) | `onSelect` | **wrong** |

At the second call site `onChange` is `undefined`, so selecting a project
throws `TypeError: onChange is not a function` inside the select handler
and `selectedProjectId` never updates.

### What planning changed about this track

The original filing assumed the cloud call site is live in remote/cloud
deployments and that the bug is therefore user-visible there. That is not
what the code shows today:

1. **`CloudAppInner` is never rendered.** The only reference to it in the
   entire repository is its own declaration at `ui/src/App.jsx:817`. The
   default export renders `AppInner` unconditionally, with no cloud
   branch, and nothing else imports it.
2. **It could not render even if reached.** Its first statement calls
   `useCloudAuth()`, which is not imported into `App.jsx` at all (only
   `AuthProvider`/`useAuth` from `AuthContext.jsx` are). Rendering it
   would fail with a `ReferenceError` before the selector ever mounted.
   There is no `CloudAuthContext.jsx`; `ui/src/contexts/` contains only
   `AuthContext.jsx`.
3. Two other tracks recorded the same observation independently — track
   1082's `plan.md` ("`CloudAppInner` in the same file is dead code, not
   referenced anywhere") and track 1107's `index.md` ("Cloud UI code paths:
   `CloudAppInner` is dead code locally").

So the prop mismatch is **real and worth fixing**, but it is currently
latent: it is a bug waiting inside an unreachable shell, not a live defect
a cloud user is hitting today. The build script `npm run build:cloud`
(`VITE_CLOUD_MODE=true vite build`) exists, but `VITE_CLOUD_MODE` is only
consulted by `NewProjectModal.jsx`, `WorkerOnboarding.jsx`, and
`ProvisionWorkerModal.jsx` — never to select the app shell.

This reframing matters because it makes the originally-filed Phase 3
("verify in cloud mode") **unsatisfiable as written**: there is no cloud
mode to verify in. Rather than let a later run quietly fake or skip that
step, this spec replaces it with criteria that can actually be met.

## Requirements

- **REQ-1**: `CloudAppInner`'s `ProjectSelector` call site passes `onChange`,
  matching the component's declared signature.
- **REQ-2**: `ProjectSelector` keeps exactly one callback prop name. Do not
  add an `onSelect` alias — two names for one prop is the mechanism that
  let this survive unnoticed.
- **REQ-3**: A regression guard exists that fails if any `ProjectSelector`
  call site passes a callback the component does not accept. Because the
  offending call site is unreachable at runtime, a render-based test alone
  cannot cover it — the guard must inspect call sites as source.
- **REQ-4**: `ProjectSelector`'s own behaviour is covered by a render test:
  choosing a project calls `onChange` with the numeric id, and choosing
  "All Projects" calls it with `null`.
- **REQ-5**: The status of `CloudAppInner` itself (delete it, or wire it up
  and give it its missing `useCloudAuth` import) is surfaced as a decision
  for a human, not decided inside this track. See Open Items.

## Acceptance Criteria

- [ ] Selecting a different project in `ProjectSelector` invokes the
      handler its parent supplied, at **both** call sites' prop shapes —
      demonstrated by a test that fails if either site is reverted to
      `onSelect`.
- [ ] `grep -n "onSelect" ui/src/App.jsx` returns no line containing
      `<ProjectSelector`.
- [ ] `cd ui && npx vitest run` passes, including the new test file, with
      no new failures in the existing suite.
- [ ] The cloud shell's reachability question is answered in
      `conversation.md` by a human, or explicitly carried as open — this
      track does not silently delete or revive `CloudAppInner`.

**Not an acceptance criterion, deliberately:** "verified in a cloud/remote
deployment." No build of this repository mounts `CloudAppInner`, so no
such verification is possible; claiming it would be false. Phase 3 below
carries that as explicitly deferred work, which is why this track cannot
reach 100% on the code fix alone.

## Open Items (for human review)

- **Fundamentals flag**: `conductor/product.md`'s feature matrix lists a
  working "Kanban dashboard, Inbox, conversation UI" for the Cloud
  (remote-api) column. The shell meant to provide it is unreachable dead
  code with a missing import. Either the matrix is aspirational for that
  column, or the cloud shell is unfinished. Not resolved here, and
  `product.md` was not modified.
- **Decision needed on `CloudAppInner`**: delete (it has been dead through
  at least tracks 1082, 1101, 1107) or finish (add `useCloudAuth`, create
  `CloudAuthContext.jsx`, branch the default export on `VITE_CLOUD_MODE`).
  Fixing the prop is correct under either outcome, which is why Phase 1
  does not wait on this answer.
