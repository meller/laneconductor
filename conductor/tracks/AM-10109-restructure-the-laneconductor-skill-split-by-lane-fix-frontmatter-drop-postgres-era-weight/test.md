# Tests: Track 10109 — Restructure the laneconductor skill

## Test Commands
```bash
# The new guard (zero deps, does not spawn a worker)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10109-skill-structure.test.mjs

# The one existing test that reads skill text (retargeted to setup/scaffold.md)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10097-scaffold-gitignore.test.mjs

# Worktree .claude copy (extended with a skill-subfolder case)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10096-claude-dir-nesting.test.mjs

# Daemon path: the mock-CLI suites that drive real lane dispatch, aliases and merge
env -u NODE_TEST_CONTEXT node --test \
  conductor/tests/local-fs-e2e.test.mjs \
  conductor/tests/local-api-e2e.test.mjs \
  conductor/tests/brainstorm-dispatch.test.mjs \
  conductor/tests/claude-cli-args.test.mjs \
  conductor/tests/track-1102-f15-lane-dispatch-e2e.test.mjs \
  conductor/tests/track-10035-merge-lane-action.test.mjs \
  conductor/tests/track-10035-direct-merge-e2e.test.mjs \
  conductor/tests/track-10035-pr-flow-e2e.test.mjs \
  conductor/tests/track-10080-fuzzy-match.test.mjs

# After every run above: leaked workers?
ps aux | grep laneconductor.sync.mjs | grep -v grep   # readlink /proc/<pid>/cwd before calling one a leak
```

Note: the mock-CLI suites bypass the skill text (`LC_MOCK_CLI` replaces the CLI). They prove
that the daemon's command routing, which this track must not touch, still works. The skill
text itself is covered by the structure test and the live runs (Phase 5).

## Test Cases

### Phase 1: Structure guard (`track-10109-skill-structure.test.mjs`)
Fails before Phases 2-4. Passes after.

- [ ] TC-0: Fixture validity. Every string in `fixtures/track-10109-invariants.json` occurs
      in the **pre-restructure** SKILL.md (read with `git show main:.claude/skills/laneconductor/SKILL.md`).
      Expected: pass from day one. Guards against a typo in the fixture that would later pass
      vacuously.
- [ ] TC-1: Frontmatter.
    - It parses as YAML between the first two `---` lines.
    - Its keys are a subset of the documented set (name, description, when_to_use,
      argument-hint, arguments, disable-model-invocation, user-invocable, allowed-tools,
      disallowed-tools, model, effort, context, agent, background, hooks, paths, shell,
      metadata, license, compatibility).
    - `parameters` is absent.
    - Expected: pass.
- [ ] TC-2: `description.length + when_to_use.length` <= 1,536. `description` starts with
      "Plan". Neither field contains `<` or `>`. Expected: pass.
- [ ] TC-3: SKILL.md <= 200 lines and <= 20,000 bytes. Expected: pass. Today 2,392 /
      129,829, so it fails.
- [ ] TC-4: The SKILL.md body contains no `$` followed by a digit and no `$ARGUMENTS`.
      Expected: pass.
- [ ] TC-5: Every relative markdown link in SKILL.md resolves to an existing file under the
      skill dir. Expected: pass.
- [ ] TC-6: Routing completeness. Every `SLASH_COMMANDS[].name` (import
      `conductor/services/slash-commands.mjs`), plus `qualityGate`, `quality-gate`, `done`,
      `merge`, `brainstorm`, `comment`, `move`, `setup scaffold generate` and
      `setup-deploy generate`, appears in the SKILL.md routing table on a row that links an
      existing file. Expected: pass.
- [ ] TC-7: `qualityGate` and `quality-gate` route to the same file, `lanes/quality-gate.md`.
      `done` and `merge` route to `lanes/merge.md`. Expected: pass.
- [ ] TC-8: The layout exists: the six `lanes/*.md`, `ops/tracks.md`,
      `setup/{setup,scaffold,templates}.md`, `deploy/{setup-deploy,deploy}.md`,
      `legacy/{worker,db-schema,syncdb,remote-sync}.md`. Expected: pass.
- [ ] TC-9: Self-containment. No `lanes/*.md` file links or names another `lanes/` file,
      `ops/`, `setup/`, `deploy/` or `legacy/`. None matches
      `/see `?\/laneconductor (plan|implement|review|quality-gate|merge|brainstorm)/`.
      Expected: pass.
- [ ] TC-10: Invariants. Each lane file contains every string listed for it in the fixture.
      SKILL.md contains its own list. Expected: pass.
- [ ] TC-11: No lane file and no SKILL.md tells the agent to write the legacy `**Status**:`
      marker. A line containing `**Status**:` is allowed only in a `file_sync_queue.md` entry
      example. Expected: pass.
- [ ] TC-12: Size budget. For each lane, bytes(SKILL.md) + bytes(lanes/<lane>.md) <= 32,000.
      The test prints the ratio against 129,829. Expected: pass.
- [ ] TC-13: There is exactly one `remote-sync` procedure across the skill dir (in
      `legacy/remote-sync.md`). The stale `qualityGate` short section text ("Move track to
      `done` lane, update `index.md` status to `success`") appears nowhere. Expected: pass.

### Phase 2: Lane files
- [ ] TC-L1: TC-9 and TC-10 are green for all six lane files.
- [ ] TC-L2: Manual read-through of each lane file. Followed literally with only SKILL.md
      alongside, does it reach the same `index.md` end state as the old section? Record one
      line per lane in conversation.md.

### Phase 3: ops/setup/deploy/legacy
- [ ] TC-S1: `track-10097-scaffold-gitignore.test.mjs` reads `setup/scaffold.md`. Both tests
      pass: the fence equals `RUNTIME_STATE_PATTERNS`, and the `Do **not** add` / `index.md`
      carve-out is present.
- [ ] TC-S2: `legacy/db-schema.md` contains both `CREATE TABLE IF NOT EXISTS tracks` variants
      and a note on how they differ.
- [ ] TC-S3: `ops/tracks.md` names `lc update-track`, `lc report-bug` and
      `lc feature-request`, and `newTrack` keeps the `direct` / `yes` defaults.

### Phase 4: Index
- [ ] TC-I1: TC-1 through TC-7 and TC-13 are green.
- [ ] TC-I2: Heading coverage. Every `^#{1,3} ` heading of the old SKILL.md outside code
      fences maps to a new file or to a "deleted" row in spec section 3. Checked by a script
      that prints the unmapped ones; expected output is empty.

### Phase 5: Daemon path, symlinks, live
- [ ] TC-D1: Every daemon suite in Test Commands passes on this branch, or its failures are a
      subset of the same command's failures on `main`'s tip (`comm -23` of the sorted failure
      names is empty).
- [ ] TC-SYM-1: New case in the structure test. Make a temp dir with
      `.claude/skills/laneconductor` as a **symlink** to the real skill dir. Every relative
      link in SKILL.md, resolved from the symlink path, opens. Expected: pass.
- [ ] TC-SYM-2: New case in `track-10096-claude-dir-nesting.test.mjs`. `copyClaudeDir`
      carries `skills/laneconductor/lanes/plan.md` into the worktree:
    - (a) when the skill dir is real (this repo);
    - (b) when it is a symlink (other projects), where the copied entry stays a symlink and
      `lanes/plan.md` is reachable through it.
    - Expected: pass.
- [ ] TC-LIVE-1 (AC-1): `claude -p "/laneconductor plan 99109"` in this worktree on a
      throwaway track. Expected:
    - `**Lane**: plan`, `**Lane Status**: success`;
    - real spec/plan/test (no `(Test cases to be added)`);
    - `> **system**: ✅ Plan complete`;
    - the transcript shows a Read of `lanes/plan.md` and no read of `setup/` or `legacy/`.
- [ ] TC-LIVE-2 (AC-2): `claude -p "/laneconductor qualityGate 99109"`. Expected: the
      transcript shows a Read of `lanes/quality-gate.md` first, then the claim
      `**Lane**: quality-gate` / `running` with `**Verdict**` cleared. It may be stopped after
      the claim.
- [ ] TC-LIVE-3 (AC-3): No-slash prompts "plan track 99109" and "create a track for fixing the
      README typo" in a fresh session invoke the skill. The result is recorded.
- [ ] TC-SIZE (AC-6): The size table is recorded in plan.md: SKILL.md + each lane file in
      bytes and bytes/4, against 129,829.

### Phase 6: References
- [ ] TC-R1: `.claude/MEMORY.md` and the `slash-commands.mjs` header describe the new layout.
      `node --check conductor/services/slash-commands.mjs` passes.

## Acceptance Criteria
- [ ] AC-1 through AC-7 in spec.md are met with recorded evidence.
- [ ] No command name, skill name or SKILL.md path changed (TC-6, TC-D1).
- [ ] No regressions in the daemon suites against `main` (TC-D1, diff-confirmed).
- [ ] The throwaway track folder 99109 is deleted and never committed.
