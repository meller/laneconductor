# Track AM-10127: LaneConductor Lite: a Markdown-only plugin for the Anthropic directory, with pointers to the full plugin

## Phase 1: Generator profile `lite`
- [x] Replace the `lean` profile with `lite` (name `laneconductor-lite`, output `plugins/laneconductor-lite/`); `buildAll`, `--check` and the normal run cover it; the marketplace file still lists only the full plugin
- [x] plugin.json: known fields only, plus `privacyPolicyUrl`; agents without `isolation`; no connector tool names

## Phase 2: Lite content
- [x] Commands written for file editing (no connector tools, no board script); the board commands only explain and show the install commands
- [x] `FULL-PLUGIN.md` in the Lite skill (single source of the install commands) and a short "full plugin" section in SKILL.md; Lite README
- [x] `track-runner` makes its own worktree first

## Phase 3: Privacy page and tests
- [x] `docs/privacy.md`
- [x] Replace `directory-lean.test.mjs` with a Lite test that emulates the portal's 2026-11-18 blocks; update the other tests and docs that name the lean profile

## Phase 4: Verify
- [x] `cd connector && npm test`, `node scripts/build-plugin.mjs --check`, `claude plugin validate` on Lite, the full plugin and the repository root (all `--strict`)
- [x] Script scan of the Lite folder, and a grep for connector tool names in it

## Implementation notes

Done 2026-11-18 by the implementer: profile lean replaced by lite; 278 connector tests pass; claude plugin validate --strict passes on Lite, the full plugin and the repository root. Left for the lead and the owner: re-run the portal Validate on plugins/laneconductor-lite, and submit.
