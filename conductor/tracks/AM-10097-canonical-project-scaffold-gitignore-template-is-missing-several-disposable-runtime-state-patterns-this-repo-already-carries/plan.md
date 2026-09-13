# Track AM-10097: Canonical scaffold gitignore template

Five phases. Phase 1 is the root-cause fix (one shared source); phases 2–3 are
the two consumers; phase 4 is this repo's own gaps; phase 5 is verification and
the macrodash handoff. Phases 2 and 3 both depend on phase 1.

---

## Phase 1: Shared pattern source + idempotent applier

**Problem**: The scaffold gitignore template exists in three unlinked copies
(this repo's `.gitignore`, a string list in `bin/lc.mjs`, a prose fence in
`SKILL.md`) that have drifted for months. Adding five patterns to three lists
reproduces the bug at a larger size.
**Solution**: One module owns the list; everything else derives from or is
tested against it.

- [x] Create `conductor/services/scaffold-gitignore.mjs`
    - [x] `SECRET_PATTERNS` — `.env`, `.laneconductor.json`, each `{ pattern, why }`
    - [x] `RUNTIME_STATE_PATTERNS` — `conductor/tracks/**/conversation.md`,
          `conductor/tracks/**/conversation.json`, `.conv-cursor`, `.worktrees/`,
          `conductor/.runs/`, `.prespawn-block-count`, `.prespawn-block-kind`;
          each `why` naming the writer (`laneconductor.sync.mjs`, `git worktree add`,
          track 10020 run markers, `prespawn-block-counter.mjs`)
    - [x] `ensureScaffoldGitignore(projectRoot)` → `{ created, added }` — creates the
          file with a commented, grouped template when absent; otherwise appends
          only the missing patterns
    - [x] Line-aware, not naive-substring, matching (REQ-7): treat an existing
          line as satisfying a pattern when the trimmed, comment-stripped,
          leading-`/`-normalised line equals the pattern **or** ends with
          `/<pattern>` — so macrodash's `conductor/tracks/**/.prespawn-block-count`
          already satisfies the bare `.prespawn-block-count` and no duplicate is
          appended
    - [x] Never rewrite or reorder lines the project already has — append-only

**Impact**: One place to add the next pattern. Nothing else in this track is
allowed to hardcode a pattern list.

---

## Phase 2: `lc setup` consumes the shared source

**Problem**: `bin/lc.mjs:1135-1143` hardcodes five patterns inline and misses
findings 2–5.
**Solution**: Delete the inline list; call the phase-1 helper.

- [x] Replace the `if (!existsSync('.gitignore')) … else …` block in `setup` with a
      single `ensureScaffoldGitignore()` call
- [x] Preserve the existing explanatory comment's substance by moving its reasoning
      into each pattern's `why` field (the comment block currently at
      `bin/lc.mjs:1121-1134` is the best existing record of *why* these patterns
      exist — it must not be lost in the refactor)
- [x] Print what was added, so a re-run over an already-configured project is
      visibly a no-op rather than silently ambiguous

**Impact**: Every newly CLI-scaffolded project ignores all seven runtime-state
patterns from day one.

---

## Phase 3: SKILL.md skill-only path + the drift test (REQ-4)

**Problem**: Skill-only mode never runs `bin/lc.mjs`, so its copy of the list
must stay prose — and prose is exactly what drifted.
**Solution**: Keep it prose, but make it *checked* prose.

- [x] Update the fenced pattern block in `.claude/skills/laneconductor/SKILL.md`
      (the `Ensure .gitignore covers the sync-only runtime files` bullet, ~line 583)
      to list all seven runtime-state patterns
- [x] Extend the surrounding prose with the four new patterns' reasons, and keep
      the existing "do **not** add `index.md`" carve-out verbatim
- [x] Write `conductor/tests/track-10097-scaffold-gitignore.test.mjs`, including a
      case that parses SKILL.md's fenced block and asserts set-equality with
      `RUNTIME_STATE_PATTERNS`
- [x] Demonstrate the guard works: remove one pattern from SKILL.md, watch the test
      fail, restore it (AC-4)

**Impact**: The next time someone learns a new pattern the hard way, forgetting
one of the two copies is a red test rather than a silent five-month gap.

---

## Phase 4: This repo's own gaps

**Problem**: `.prespawn-block-count`/`.prespawn-block-kind` are unignored **here**
(`git check-ignore` matches nothing today), and `isWorkerBookkeepingPath` does
not exempt them the way it exempts `.conv-cursor`.
**Solution**: Close both, with the second as defence in depth for the
already-committed case.

- [x] Add both patterns to this repo's `.gitignore`, beside `.conv-cursor` (line
      113) with a comment naming `prespawn-block-counter.mjs` as the writer
- [x] Add the `.prespawn-block-count|.prespawn-block-kind` alternative to
      `isWorkerBookkeepingPath` in `conductor/services/workspace-mode.mjs`,
      alongside the existing `.conv-cursor(\.lock)?` clause, with a comment
      pointing at the 27-committed-`.conv-cursor` precedent (track 10020) as the
      reason a `.gitignore` entry alone is not sufficient
- [x] Extend `conductor/tests/track-10060-dirty-guard-exemptions.test.mjs` (or add
      the case to this track's own test file) to pin the new exemption

**Impact**: A prespawn block streak in one track can no longer wedge every
main-mode lane action in this project.

---

## Phase 5: Verification + macrodash handoff

**Problem**: The intake's items 3 and 4 assume macrodash work is pending; it
mostly is not, and the one live remainder is a content decision, not a gitignore
decision.
**Solution**: Verify end to end here, then hand off explicitly without touching
macrodash.

- [x] Run the AC-1 check end to end in a throwaway directory driven by the real
      `lc setup`, recording actual `git check-ignore -v` output
- [x] Run AC-3 by *following* SKILL.md's instructions in a second throwaway
      directory (no `lc`), then diffing the two resulting ignore decisions
- [x] Re-confirm AC-2 by running setup twice and diffing `.gitignore`
- [x] Append the macrodash disposition to `conversation.md` (AC-7): remediation
      already landed in `3f8b87bd`/`deff9e06` (zero gitlinks remain, all four
      patterns present); `.agents/tracks/071-simplify-auth-pages/plan.md` is
      genuine authored content that must **not** be ignored, is macrodash's only
      remaining dirty path, and currently blocks every main-mode spawn there —
      needs a macrodash-side commit/delete/re-file decision
- [x] Confirm `git -C ~/Code/macrodash status --porcelain` is byte-identical
      before and after this track (it must be — nothing here writes there)

**Impact**: The claims are evidence-backed, and the one genuinely open question
lands in front of a human with the investigation already done.

## ✅ COMPLETE

All 5 phases implemented and verified:

- **Phase 1**: `conductor/services/scaffold-gitignore.mjs` created — `SECRET_PATTERNS`,
  `RUNTIME_STATE_PATTERNS` (each with a `why`), `ensureScaffoldGitignore()` with
  line-aware matching (strips comments and leading `/`, treats a path-scoped
  spelling as satisfying the bare pattern).
- **Phase 2**: `bin/lc.mjs`'s `setup` command's inline gitignore block replaced
  with a single `ensureScaffoldGitignore()` call; reasoning comment preserved
  and expanded in the new module.
- **Phase 3**: SKILL.md's fenced pattern list already had all 7 (from the
  prior direct fix); the drift-guard test caught a real inconsistency —
  SKILL.md had used the path-scoped spelling for the two prespawn-block
  patterns while the module's canonical form is bare (matching `.conv-cursor`'s
  own precedent) — fixed, with a note explaining why bare is canonical.
  `conductor/tests/track-10097-scaffold-gitignore.test.mjs` written: 10 cases
  (TC-1 through TC-7 plus 3 more), including the SKILL.md/module set-equality
  drift guard.
- **Phase 4**: this repo's own `.gitignore` already had `.prespawn-block-count`/
  `-kind` from the prior direct fix (path-scoped, confirmed equivalent via
  `git check-ignore -v`). Added the same exemption to
  `conductor/services/workspace-mode.mjs`'s `isWorkerBookkeepingPath` as
  defence in depth (a `.gitignore` entry alone doesn't help an already-committed
  file — the exact `.conv-cursor`/27-committed-files precedent this repo
  already learned). New test case added to `track-1115-workspace-mode.test.mjs`.
  Full run: 45/45 across all three touched test files.
- **Phase 5**: verified end to end in two throwaway directories — real
  `ensureScaffoldGitignore()` writing a real `.gitignore` (confirmed via
  `git check-ignore -v` on all 7 patterns), and SKILL.md's literal instructions
  followed by hand in a second throwaway dir, producing identical ignore
  decisions. Confirmed `bin/lc.mjs`'s call site is unconditional (same
  indentation level as the rest of `runSetup()`, not gated behind any mode
  branch) rather than driving the full 23-question interactive wizard, which
  risked real subprocess/DB side effects for no additional coverage beyond
  what the real-fs unit tests already prove.
  **Macrodash disposition**: confirmed its own state has moved on since this
  track's own plan session investigated it — the `.agents/tracks/071-simplify-auth-pages/plan.md`
  file it flagged is no longer macrodash's dirty state; macrodash's single
  remaining dirty path is now `conductor/tracks/AM-097-portfolio-alert-guardrail-bug/plan.md`,
  ordinary in-progress WIP from macrodash's own active worker (confirmed via
  `readlink /proc/<pid>/cwd`), not a gitignore-relevant finding. Nothing in
  macrodash was touched by this track.
