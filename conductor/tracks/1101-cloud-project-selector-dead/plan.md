# Track 1101: Project selector is dead in Cloud mode (wrong prop name)

Scope note: Phases 1 and 2 are the complete, shippable fix. Phase 3 is
explicitly deferred and blocked on a human decision — this track cannot be
marked 100% while it is open (see spec.md's Acceptance Criteria).

## Phase 1: Fix the prop mismatch

**Problem**: `CloudAppInner` passes `onSelect` to a component that only
accepts `onChange`, so its select handler would throw on every change.
**Solution**: Rename the prop at the call site. Do not add an alias in the
component (spec REQ-2).

- [ ] Task 1: In `ui/src/App.jsx` at the `CloudAppInner` call site
      (currently line 898), change `onSelect={setSelectedProjectId}` to
      `onChange={setSelectedProjectId}`.
- [ ] Task 2: Confirm no other mismatched call site exists:
      `grep -n "<ProjectSelector" -A3 ui/src/App.jsx` and check every hit
      passes `onChange`. Expected hits: two, both `onChange` after Task 1.
- [ ] Task 3: Leave `ProjectSelector.jsx` unchanged. No `onSelect` alias,
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

- [ ] Task 1: Write `ProjectSelector.test.jsx` (behaviour, spec REQ-4).
      Render with a two-project list, fire a change to a project id,
      assert `onChange` received the **number** id; fire a change to the
      "All Projects" empty option, assert `onChange` received `null`.
      Write it first and watch it pass against current
      `ProjectSelector.jsx` — this test covers the component, not the bug.
- [ ] Task 2: Write the call-site contract test (spec REQ-3) — the one
      that actually catches this class of bug. Read `ui/src/App.jsx` as
      text, extract every `<ProjectSelector ... />` usage, and assert each
      passes `onChange` and none passes `onSelect`.
      **TDD order matters here**: write this test and run it BEFORE
      Phase 1's edit is in place, confirm it FAILS on the real `onSelect`
      at line 898, then apply Phase 1 and confirm it passes. A guard that
      was never seen red proves nothing.
- [ ] Task 3: Run the full `cd ui && npx vitest run` and confirm no
      pre-existing test regressed.

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
