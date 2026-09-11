# Tests: Track 1101 — Cloud Project Selector Dead

## Test Commands

```bash
# Full UI unit suite (vitest + jsdom + React Testing Library)
cd ui && npx vitest run

# Just this track's files
cd ui && npx vitest run src/components/ProjectSelector.test.jsx \
                        src/components/ProjectSelector.callsites.test.jsx

# Non-test check used as an acceptance criterion
grep -n "<ProjectSelector" -A3 ui/src/App.jsx
```

**After any full vitest run**: `ps aux | grep laneconductor.sync.mjs` and
kill workers that were not running beforehand (known leak, see plan.md).

## Test Cases

### Phase 1: Prop mismatch fixed

- [ ] TC-1: `grep -n "<ProjectSelector" -A3 ui/src/App.jsx` — expected:
      exactly two usages, both passing `onChange`, neither passing
      `onSelect`.
- [ ] TC-2: `grep -n "onSelect" ui/src/App.jsx` — expected: no hit on any
      line belonging to a `ProjectSelector` usage. Unrelated `onSelectTrack`
      props on other components are fine and must not be touched.
- [ ] TC-3: `ui/src/components/ProjectSelector.jsx` still destructures
      `onChange` only — expected: no `onSelect` alias was added.

### Phase 2: Component behaviour — `ProjectSelector.test.jsx`

- [ ] TC-4: Renders one `<option>` per project plus the "All Projects"
      option — expected: 3 options for a 2-project list.
- [ ] TC-5: Selecting a project fires `onChange` with the **numeric** id —
      expected: called once with `7`, not the string `"7"`.
- [ ] TC-6: Selecting "All Projects" (empty value) fires `onChange` with
      `null` — expected: called once with `null`.
- [ ] TC-7: `selectedId` renders as the select's current value, and
      `selectedId={null}` renders as the empty "All Projects" value.

### Phase 2: Call-site contract — `ProjectSelector.callsites.test.jsx`

- [ ] TC-8: Every `<ProjectSelector ... />` usage parsed out of
      `ui/src/App.jsx` passes an `onChange` prop — expected: all usages
      pass, and the test finds at least one usage (a regex that silently
      matches nothing must fail, not vacuously pass).
- [ ] TC-9: No `<ProjectSelector ... />` usage passes `onSelect` —
      expected: zero hits.
- [ ] TC-10: **Red-first check, run manually during Phase 2 Task 2.**
      With `App.jsx:898` still on `onSelect`, TC-8 and TC-9 both FAIL.
      Record the failing output before applying Phase 1. A guard never
      seen red does not count as a guard.

### Phase 3 (deferred)

- [ ] TC-11: Not written. Cloud-mode verification requires a build that
      mounts `CloudAppInner`; none exists today. Left unwritten
      deliberately rather than stubbed green.

## Acceptance Criteria

- [ ] TC-1 through TC-9 pass.
- [ ] TC-10's red state was actually observed and recorded.
- [ ] `cd ui && npx vitest run` shows no regression in the existing suite.
- [ ] TC-11 remains open, and the track is not marked 100% while it is.
