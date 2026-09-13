# Tests: Track AM-10099 — `lc <subcommand> --help`

## Test Commands

```bash
# This track's own suite
node --test conductor/tests/track-10099-subcommand-help.test.mjs

# The existing test this track strengthens (must stay green)
node --test conductor/tests/track-10035-new-track-flags.test.mjs

# Full CLI regression set
node --test \
  conductor/tests/claude-cli-args.test.mjs \
  conductor/tests/track-10035-new-track-flags.test.mjs \
  conductor/tests/track-10040-track-dir-cli.test.mjs \
  conductor/tests/track-10063-track-dir-cli.test.mjs \
  conductor/tests/track-10069-lc-state-cli.test.mjs \
  conductor/tests/track-10092-move-family-cli.test.mjs \
  conductor/tests/track-10095-cli-push.test.mjs \
  conductor/tests/track-1102-f6-cli-mode-vocabulary.test.mjs \
  conductor/tests/track-1114-worktree-create-args.test.mjs \
  conductor/tests/track-10099-subcommand-help.test.mjs

# Hazard check after any run (this repo leaks workers — see MEMORY.md)
ps aux | grep laneconductor.sync.mjs | grep -v grep
```

Harness: `node:test`, per this project's rule that anything spawning real
processes or touching the filesystem uses `node:test`, not Vitest. Each test runs
the real `node bin/lc.mjs` via `execFileSync` against a throwaway `local-fs`
project (`.test-tmp-track-10099/`), cleaned up in `after`.

## Test Cases

### Phase 1 — Defect reproduction (must fail before Phase 2/3)

- [ ] TC-1.1: `lc new --help` — expected: exit 0, stdout contains `Usage` and
      `new`, `conductor/tracks/` contains no new track folder.
- [ ] TC-1.2: `lc new -h` — expected: identical to TC-1.1.
- [ ] TC-1.3: `lc new --help` leaves `file_sync_queue.md` with no
      `track-create` entry — expected: no `**Type**: track-create` added.
- [ ] TC-1.4: `lc new "My Title" "My desc" --merge-mode pr` — expected: `index.md`
      first line is exactly `# Track AM-NNN: My Title`.
- [ ] TC-1.5: same command — expected: created folder slug matches
      `/^AM-\d+-my-title$/` (no `-my-desc-merge-mode-pr` suffix).
- [ ] TC-1.6: same command — expected: `**Summary**: My desc` present (description
      not dropped) and `**Merge Mode**: pr`.
- [ ] TC-1.7: same command — expected: combined stdout+stderr does **not** match
      `/Multiple unquoted words detected/`.
- [ ] TC-1.8: `lc new "T" "D" --workspace main` — expected: title exactly `T`,
      `**Workspace**: main`.
- [ ] TC-1.9: `lc new "T" "D" --auto-run no` — expected: title exactly `T`,
      `**Auto Run**: no`.
- [ ] TC-1.10: `lc reportaBug --help` — expected: exit 0, help printed, no track
      folder created.
- [ ] TC-1.11: `lc feature-request --help` — expected: as TC-1.10.
- [ ] TC-1.12: `lc comment <NNN> --help` on a seeded track — expected: exit 0,
      `conversation.md` byte-identical to before (no `> **human**: --help`).
- [ ] TC-1.13: `lc updateTrack <NNN> --help` on a seeded track — expected: exit 0,
      `plan.md` unchanged and `**Lane**` unchanged (not moved to backlog).

### Phase 2 — Flag-boundary parsing

- [ ] TC-2.1: `splitPositionalArgs(['new','T','D','--merge-mode','pr'])` —
      expected: `positional` is `['T','D']`.
- [ ] TC-2.2: `--type` still works in any position: `lc new "T" "D" --type support`
      — expected: title `T`, `**Type**: support`.
- [ ] TC-2.3: Two flags together: `lc new "T" "D" --merge-mode pr --auto-run no` —
      expected: title `T`, desc `D`, both markers applied.
- [ ] TC-2.4: Flag before positionals: `lc new --type dev "T" "D"` — expected:
      title `T`, desc `D`, `**Type**: dev`.

### Phase 3 — Subcommand help

- [ ] TC-3.1: Table-driven over every subcommand in the dispatch chain (including
      aliases) — expected: `--help` exits 0 with non-empty stdout for each.
- [ ] TC-3.2: Same table with `-h` — expected: identical results.
- [ ] TC-3.3: Help text is subcommand-specific — expected: `lc worker --help`
      mentions `worker` and does not equal `lc new --help` output.
- [ ] TC-3.4: `lc help new` — expected: output equals `lc new --help` output.
- [ ] TC-3.5: `lc bogus-command --help` — expected: exit 0, top-level help printed
      (REQ-6), no crash.
- [ ] TC-3.6: No side effects across the whole table — expected: track count in
      `conductor/tracks/` is unchanged after running every subcommand's `--help`.
- [ ] TC-3.7: Bare `lc --help`, `lc -h`, `lc help` still print top-level help
      (regression on the existing line-648 behavior).

### Phase 4 — `--` escape hatch

- [ ] TC-4.1: `lc comment <NNN> -- --help` — expected: `conversation.md` gains
      `> **human**: --help` and the `--` itself is not included.
- [ ] TC-4.2: `lc new -- "--help"` — expected: a track titled `--help` is created
      deliberately (escape hatch honored, no interception).

### Phase 5 — Regression / coverage teeth

- [ ] TC-5.1: Tightened `track-10035-new-track-flags.test.mjs` fails against the
      pre-Phase-2 `bin/lc.mjs` — expected: failure on exact-title assertion
      (proves the test now has teeth).
- [ ] TC-5.2: Full CLI regression set passes — expected: all files pass, 0 failures.
- [ ] TC-5.3: Existing `lc new` shapes unchanged — `lc new "T" "D"`,
      `lc new [T] [D]`, and unquoted `lc new one two three` (warning still fires)
      — expected: same behavior as before this track.
- [ ] TC-5.4: No orphaned `laneconductor.sync.mjs` processes after the suite —
      expected: empty `ps` output.

## Acceptance Criteria

- [ ] All Phase 1 TCs pass after Phases 2–4 (and provably failed before).
- [ ] All Phase 2–4 TCs pass.
- [ ] Full CLI regression set green; no new failures in unrelated suites.
- [ ] No track folder, comment, plan entry or lane change is produced by any
      `--help` invocation anywhere in the CLI.
- [ ] `.test-tmp-*` directories removed and no orphaned processes left behind.
