# Track 1101: Project selector is dead in Cloud mode (wrong prop name)

Scope note: Phases 1 and 2 are the complete, shippable fix. Phase 3 is
explicitly deferred and blocked on a human decision — this track cannot be
marked 100% while it is open (see spec.md's Acceptance Criteria).

## Phase 1: Fix the prop mismatch

**Problem**: `CloudAppInner` passes `onSelect` to a component that only
accepts `onChange`, so its select handler would throw on every change.
**Solution**: Rename the prop at the call site. Do not add an alias in the
component (spec REQ-2).

- [x] Task 1: In `ui/src/App.jsx` at the `CloudAppInner` call site
      (line 898), changed `onSelect={setSelectedProjectId}` to
      `onChange={setSelectedProjectId}`.
- [x] Task 2: Confirmed no other mismatched call site exists — ran
      `grep -n "<ProjectSelector" -A3 ui/src/App.jsx`: two hits, both
      `onChange` (lines 440 and 898). `grep -n "onSelect" ui/src/App.jsx`
      shows only unrelated `onSelectTrack` props on other components.
- [x] Task 3: `ProjectSelector.jsx` left unchanged. No `onSelect` alias,
      no normalising wrapper.

**Impact**: One line in `App.jsx`. Correct whether `CloudAppInner` is later
deleted or revived, so it does not depend on Phase 3's outcome.

## Phase 2: Regression guard

**Problem**: The bug survived because the broken call site is never
rendered — no render-based test can reach it, and nothing checks that a
call site's props match the component's signature.
**Solution**: Two small tests in `ui/src/components/`, run by the existing
`cd ui && npx vitest run` (React Testing Library, jsdom, and vitest are
already dev dependencies; ~30 sibling component tests exist to copy the
setup from).

- [x] Task 1: Wrote `ui/src/components/ProjectSelector.test.jsx` (TC-4
      through TC-7). Ran green against unmodified `ProjectSelector.jsx`
      first — this test covers the component's own behaviour, not the bug.
- [x] Task 2: Wrote `ui/src/components/ProjectSelector.callsites.test.jsx`
      (TC-8/TC-9) — parses `<ProjectSelector>` usages out of `App.jsx` as
      source and asserts each passes `onChange`, none passes `onSelect`.
      Confirmed red first: run before Phase 1's edit failed with
      "expected [ Array(1) ] to have a length of +0 but got 1" against the
      live `onSelect` at line 898 (TC-10). Applied Phase 1, re-ran: green.
- [x] Task 3: Ran full `cd ui && npx vitest run`: 10 failed files / 33
      failed tests both before and after this change (Firebase-admin-init
      and DB-backed dispatch/model-override tests, unrelated to
      ProjectSelector — confirmed by diffing against the pre-fix state).
      New tests added 2 files / 6 tests, all passing. No regression.
      `ps aux | grep laneconductor.sync.mjs` showed no new worker PIDs
      after the run.

**Impact**: Two new test files. Catches recurrence at any call site,
including unreachable ones.

**Hazard — read before running the suite**: per session memory, a full
`cd ui && npx vitest run` in this repo has previously leaked real
`laneconductor.sync.mjs` worker processes against the primary checkout.
After the run, check `ps aux | grep laneconductor.sync.mjs` and kill any
worker that was not running before.

## Phase 3: Resolve the cloud shell (DEFERRED — human decision required)

**Problem**: `CloudAppInner` is unreachable (nothing references it) and
would throw a `ReferenceError` if it were reached (`useCloudAuth` is never
imported into `App.jsx`; no `CloudAuthContext.jsx` exists). The original
Phase 3 — "verify in cloud mode" — cannot be performed, because no build
of this repo mounts that component.
**Solution**: A human picks one of two directions; this track does not
choose unilaterally.

- [ ] Task 1: Get a decision in `conversation.md` — **delete** the dead
      shell, or **finish** it.
- [ ] Task 2a (if delete): Remove `CloudAppInner` and any helpers left
      referenced only by it. Keep Phase 1's fix regardless — it is also
      the diff's own documentation of why the component was inspected.
- [ ] Task 2b (if finish): Add the missing `useCloudAuth` import, create
      `ui/src/contexts/CloudAuthContext.jsx`, branch the default export on
      `VITE_CLOUD_MODE`, then verify the selector by hand in a
      `npm run build:cloud` preview — the verification the original filing
      asked for, possible only once the shell actually mounts.
- [ ] Task 3: Resolve the `product.md` feature-matrix flag raised in
      spec.md's Open Items alongside whichever direction is chosen.

**Impact**: Either a deletion, or real cloud-mode wiring. Out of scope for
the Phase 1–2 fix, which is why this phase stays unchecked rather than
being quietly dropped.

## ✅ COMPLETE (Phases 1–2 only)

Phase 3 remains open by design — see Scope note at top of this file and
spec.md's Acceptance Criteria. This is not a full-track completion.
