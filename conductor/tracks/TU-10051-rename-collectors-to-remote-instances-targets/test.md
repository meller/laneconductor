# Tests: Track 10051 — Rename 'Collectors' to Sync Targets

## Test Commands

```bash
# Worker / integration suite (node:test)
# NOTE: `env -u NODE_TEST_CONTEXT` is required in this repo — see quality-gate.md
env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs

# This track's own suite
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10051-target-rename.test.mjs

# API + UI unit/integration (vitest)
cd ui && npm test

# Browser E2E (Project Configuration flow)
cd ui && npx playwright test

# Syntax check across everything touched
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +

# Lint
npm run lint
```

### AC-10 baseline procedure (required, not optional)

Absolute pass counts are meaningless in this repo — the worker suite has known
environment-dependent failures. Compare **failing-test-name sets**:

```bash
git worktree add /tmp/lc-main-baseline main
cd /tmp/lc-main-baseline && env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs 2>&1 \
  | grep -E "^not ok" | sed 's/^not ok [0-9]* - //' | sort > /tmp/main-failures.txt
cd - && env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs 2>&1 \
  | grep -E "^not ok" | sed 's/^not ok [0-9]* - //' | sort > /tmp/branch-failures.txt
# Must be empty: no failure on this branch that does not also fail on main
comm -23 /tmp/branch-failures.txt /tmp/main-failures.txt
git worktree remove /tmp/lc-main-baseline
```

---

## Test Cases

### Phase 1 — Compatibility seam (`conductor/services/sync-targets.mjs`)

Written **before** the module exists (TDD); each must fail first.

- [ ] TC-1.1: `readTargets({collectors:[{url:'http://a'}]})` — expected: returns the
      one-element array (legacy key honored)
- [ ] TC-1.2: `readTargets({targets:[{url:'http://b'}]})` — expected: returns it
- [ ] TC-1.3: `readTargets({targets:[{url:'http://b'}], collectors:[{url:'http://a'}]})`
      — expected: returns the `targets` value; `collectors` ignored
- [ ] TC-1.4: `readTargets({})` — expected: `[]`, no throw
- [ ] TC-1.5: `writeTargets(cfg, [t])` — expected: `cfg.targets` set AND
      `'collectors' in cfg === false`
- [ ] TC-1.6: `resolveTargetToken(0)` with only `COLLECTOR_0_TOKEN` set — expected:
      that value
- [ ] TC-1.7: `resolveTargetToken(0)` with only `TARGET_0_TOKEN` set — expected: that value
- [ ] TC-1.8: `resolveTargetToken(0)` with both set — expected: the `TARGET_0_TOKEN` value
- [ ] TC-1.9: `resolveTargetToken(2)` with neither set — expected: `null`, no throw
- [ ] TC-1.10: `resolveTargetEnv('PORT')` honors `COLLECTOR_PORT` then `TARGET_PORT`

### Phase 2 — Worker core

- [ ] TC-2.1: Worker boots against a fixture with a legacy `collectors` config and a
      legacy `COLLECTOR_0_TOKEN` — expected: reaches ready state, no error (**AC-1**)
- [ ] TC-2.2: Same fixture — a heartbeat POST reaches the mock target with a valid
      `Authorization` header (**AC-1**; verified against the mock's received requests,
      not by reading source)
- [ ] TC-2.3: New-shaped fixture (`targets` + `TARGET_0_TOKEN`) — same result (**AC-2**)
- [ ] TC-2.4: Both-keys fixture — worker posts to the `targets` URL only (**AC-3**)
- [ ] TC-2.5: After a full worker run against the legacy fixture, `.env` is
      byte-identical to before (**AC-5**; sha256 compare)
- [ ] TC-2.6: `conductor/target-client.mjs` and `conductor/jira-target.mjs` import
      cleanly and no module still imports the old paths — expected: repo-wide grep
      for `collector-client.mjs`/`jira-collector.mjs` returns nothing outside `scratch/`
- [ ] TC-2.7: `lock.mjs`/`unlock.mjs` resolve a target URL from a legacy config

### Phase 3 — CLI

- [ ] TC-3.1: `lc add-target --url http://localhost:8091` against a legacy fixture —
      expected: `.laneconductor.json` afterward has `targets`, has **no**
      `collectors` key, and contains both the pre-existing and the new entry (**AC-4**)
- [ ] TC-3.2: Same run — the pre-existing `COLLECTOR_0_TOKEN` line in `.env` is
      untouched (**AC-5**)
- [ ] TC-3.3: `lc add-target --key lc_xxx` writes `TARGET_<n>_TOKEN` (not `COLLECTOR_*`)
- [ ] TC-3.4: `lc list-targets` on a legacy project lists the targets correctly
- [ ] TC-3.5: `lc setup` on a fresh project emits `targets` in the new config
- [ ] TC-3.6: `lc status` / `lc --help` output contains no case-insensitive
      "collector" (**AC-9**)
- [ ] TC-3.7: `lc config mode local-api` on a legacy project migrates the key

### Phase 4 — API + UI

- [ ] TC-4.1: An authenticated request through the renamed `targetAuth` middleware
      succeeds; an unauthenticated one still 401s (behavior unchanged)
- [ ] TC-4.2: Route paths are unchanged — snapshot the registered route list and
      assert it is identical to before the rename (guards the Category C no-wire-break
      claim)
- [ ] TC-4.3: `ui/server` reads a legacy `COLLECTOR_0_TOKEN` and authenticates
- [ ] TC-4.4 (Playwright): Project Configuration renders a **"Sync Targets"** heading,
      no "Collector" text (**AC-6**, **AC-8**)
- [ ] TC-4.5 (Playwright): Add a target in the UI → save → assert
      `.laneconductor.json` gained a `targets` entry and lost `collectors` (**AC-6**)
- [ ] TC-4.6 (Playwright): Project Configuration renders correctly for an
      **unmigrated** project (legacy `collectors` in file) — the legacy-read fallback
- [ ] TC-4.7: `grep -rniE '\bcollector' ui/src` returns only the
      `collector.laneconductor.io` hostname (**AC-8**)
- [ ] TC-4.8: Worker Onboarding's rendered snippet contains `"targets"` and
      `TARGET_0_TOKEN` (**AC-10 of spec / REQ-10**)
- [ ] TC-4.9 (manual, recorded): configure a token exactly as Worker Onboarding
      instructs, then make a real authenticated API request — record the actual
      response (**AC-7**). Restart the API server first; it does not hot-reload

### Phase 5 — Tests and fixtures

- [ ] TC-5.1: `startMockTarget` is importable from `conductor/tests/mock-target.mjs`
      and every consumer spawns the new path — expected: no `mock-collector` string
      remains under `conductor/tests/`
- [ ] TC-5.2: At least one fixture remains deliberately legacy-shaped, and TC-2.1/2.4
      consume it (keeps back-compat honest rather than renaming the evidence away)
- [ ] TC-5.3: Full worker suite meets the AC-10 diff procedure above — empty `comm -23`

### Phase 6 — Documentation

- [ ] TC-6.1: `grep -rniE '\bcollector' conductor/*.md SKILL.md DEPLOYMENT.md` returns
      only the hostname and the deliberate migration/back-compat notes
- [ ] TC-6.2: `.claude/.claude/` and `.claude/.claude/.claude/` are untouched —
      expected: `git status` shows no changes under those quarantined paths
- [ ] TC-6.3: `docs/superpowers/specs/2026-08-07-*.md` is unmodified

### Phase 7 — Guard

- [ ] TC-7.1: The naming guard passes on the current tree
- [ ] TC-7.2: The guard **fails** when a `const collectorFoo = 1` is injected into
      `conductor/laneconductor.sync.mjs` — expected: non-zero exit naming the file
      (a guard never observed failing is not a guard)
- [ ] TC-7.3: The guard does **not** fire on the allowlist: the
      `collector.laneconductor.io` hostname, `scripts/`, `scratch/`,
      `docs/superpowers/`, and the `COLLECTOR_*` back-compat fallback literals
- [ ] TC-7.4: `conductor/collector/index.mjs` decision is recorded in
      `conversation.md` with a human reply before any deletion (**REQ-13**)

---

## Acceptance Criteria

- [ ] All Phase 1–7 test cases above pass
- [ ] AC-1…AC-11 in `spec.md` are each satisfied by an observed result, not by
      code inspection
- [ ] `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — clean
- [ ] `npm run lint` — clean
- [ ] `cd ui && npm test` — no new failures vs. `main`
- [ ] AC-10 diff procedure run, `comm -23` output empty
- [ ] No regression in worker sync, CLI target management, or the Kanban board
