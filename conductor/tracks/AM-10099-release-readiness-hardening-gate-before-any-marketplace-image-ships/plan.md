# Track AM-10099: `lc <subcommand> --help` — stop swallowing `--help` as data

Five phases, TDD throughout: every phase writes its failing test first, confirms
it fails for the right reason, then implements. All work is in `bin/lc.mjs` plus
test files — no schema, no worker, no UI.

## Phase 1: Reproduce every defect as a failing test

**Problem**: D1/D2/D3 are confirmed by hand but nothing in CI pins them. The one
existing test that covers the broken shape passes anyway (substring assertion).
**Solution**: A new test file that fails today for each confirmed defect, modeled
on `track-10035-new-track-flags.test.mjs`'s harness (throwaway `local-fs` project
under a `.test-tmp-*` dir, real `node bin/lc.mjs` via `execFileSync`).

- [ ] Task 1: Create `conductor/tests/track-10099-subcommand-help.test.mjs` with
      the temp-project harness (`setupProject`, `lc()`, cleanup in `after`).
- [ ] Task 2: Failing test for D1 — `lc new --help` exits 0, prints usage, and
      creates no track folder and no `file_sync_queue.md` entry (AC-1, AC-2).
- [ ] Task 3: Failing test for D2 — title exactly `My Title`, desc exactly
      `My desc`, slug ends `-my-title`, `**Merge Mode**: pr` (AC-3, AC-5).
- [ ] Task 4: Failing test for D3 — stdout/stderr contain no "unquoted words"
      warning for correctly-quoted input plus a flag (AC-4).
- [ ] Task 5: Failing tests for the other free-text subcommands — `reportaBug`
      creates nothing; `comment NNN --help` appends nothing; `updateTrack NNN
      --help` appends nothing and does not change the lane (AC-6, AC-7, AC-8).
- [ ] Task 6: Run the file, confirm each test fails for the expected reason (not
      a harness error) and record the output in this file.

**Impact**: The bug becomes reproducible on demand; later phases have a gate.

## Phase 2: Fix `lc new`'s flag-boundary parsing (D2, D3)

**Problem**: Only `--type` bounds the positional slice, so three documented flags
leak into the title and trigger a bogus warning.
**Solution**: A single helper that splits argv at the first `--`-prefixed token,
used for the positional slice; the existing bracket / quoted / unquoted-phrase
branches then operate on genuinely positional input only.

- [ ] Task 1: Add `splitPositionalArgs(args)` near the other `lc.mjs` helpers —
      returns `{ positional, flags }`, cutting at the first token matching
      `/^--?[a-z]/i`, and honoring `--` as an explicit terminator (shared with
      Phase 4).
- [ ] Task 2: Replace the `typeIdx`-based slice in the `new` branch with it, and
      correct the stale comment that claims it already stops at the first flag.
- [ ] Task 3: Confirm the `>2 raw args` unquoted-phrase heuristic now counts only
      real positionals, so the warning fires only for genuine unquoted input
      (REQ-3).
- [ ] Task 4: Leave the existing per-flag `args.indexOf('--merge-mode')` reads
      untouched — they already work; this phase only stops the leak.
- [ ] Task 5: Re-run Phase 1's D2/D3 tests → green. Re-run
      `track-10035-new-track-flags.test.mjs` → still green.

**Impact**: Documented invocations (`lc new "T" "D" --merge-mode pr`) stop
producing garbled titles and silently dropped descriptions.

## Phase 3: Global `--help` / `-h` intercept + per-subcommand help (D1, REQ-1/5/6)

**Problem**: One help branch, reachable only at `args[0]`.
**Solution**: Intercept before dispatch — the one place that covers all ~36
subcommands at once, including the destructive four.

- [ ] Task 1: Add a `SUBCOMMAND_HELP` map (subcommand → `{ usage, summary,
      options }`), seeded from the one-liners already in the top-level help text
      so the two cannot drift apart in wording.
- [ ] Task 2: Cover every subcommand in the dispatch chain, including aliases
      (`report-bug`/`reportaBug`, `update-track`/`updateTrack`,
      `feature-request`/`featureRequest`, `delete`/`remove`,
      `verify`/`quality-gate`, `enable-target`/`disable-target`).
- [ ] Task 3: Insert the intercept immediately after the existing top-level help
      block, before `version` and every `else if (command === …)` branch: if any
      argv token after the command is exactly `--help` or `-h` (and no `--`
      precedes it), print that subcommand's help and `process.exit(0)`.
- [ ] Task 4: Unknown subcommand + `--help` → fall through to top-level help
      (REQ-6).
- [ ] Task 5: Accept `lc help <subcommand>` as an alias (REQ-5).
- [ ] Task 6: Table-driven test over the full subcommand list asserting exit 0
      and non-empty, subcommand-specific output (AC-9, AC-10).
- [ ] Task 7: Re-run Phase 1's D1 and free-text tests → green.

**Impact**: `lc <anything> --help` becomes safe and useful; the class of bug that
created this track is closed at the root, not per-subcommand.

## Phase 4: `--` end-of-options escape hatch (REQ-7)

**Problem**: Once `--help` is intercepted, a literal `--help` can no longer be
submitted as content.
**Solution**: Standard `--` terminator, already threaded through
`splitPositionalArgs` in Phase 2.

- [ ] Task 1: Honor `--` in the Phase 3 intercept: tokens after it are never
      treated as a help request.
- [ ] Task 2: Strip the `--` itself from the free-text body so the posted content
      is `--help`, not `-- --help`.
- [ ] Task 3: Test `lc comment <NNN> -- --help` appends literal `--help` (AC-11).
- [ ] Task 4: Document `--` in the top-level help's footer.

**Impact**: No capability is lost by the intercept.

## Phase 5: Close the coverage gap and verify no regressions (REQ-8)

**Problem**: The existing 10035 test would not have caught D2 and still wouldn't.
**Solution**: Tighten its assertions, then run the CLI suite.

- [ ] Task 1: In `track-10035-new-track-flags.test.mjs`, replace the
      `.includes(fragment)` folder lookup with an exact-slug assertion and add an
      exact-title assertion (AC-8 of spec / REQ-8).
- [ ] Task 2: Confirm that tightened test fails against pre-Phase-2 code
      (`git stash` the fix or check out the prior blob) — proof it now has teeth.
- [ ] Task 3: Run every CLI test: `node --test conductor/tests/claude-cli-args.test.mjs
      conductor/tests/track-10035-new-track-flags.test.mjs
      conductor/tests/track-10040-track-dir-cli.test.mjs
      conductor/tests/track-10063-track-dir-cli.test.mjs
      conductor/tests/track-10069-lc-state-cli.test.mjs
      conductor/tests/track-10092-move-family-cli.test.mjs
      conductor/tests/track-10095-cli-push.test.mjs
      conductor/tests/track-1102-f6-cli-mode-vocabulary.test.mjs
      conductor/tests/track-1114-worktree-create-args.test.mjs
      conductor/tests/track-10099-subcommand-help.test.mjs` (AC-12, AC-13).
- [ ] Task 4: Check for orphaned processes after the runs
      (`ps aux | grep laneconductor.sync.mjs`) per this repo's known test hazard,
      and remove the `.test-tmp-*` dirs.
- [ ] Task 5: Record actual command output in this file before ticking anything.

**Impact**: The regression is pinned by assertions that can actually fail.

## Verification Notes

- Every phase's checkbox is ticked only after the command was **run** and its real
  output seen — a written-but-unexecuted test is not verification.
- `lc` is installed globally; tests must invoke `node bin/lc.mjs` from the
  worktree so they exercise this branch's code, not the installed copy.
- Probe runs must use a throwaway `local-fs` project. Never run `lc new` against
  the real project to test parsing — that is what produced this track.
