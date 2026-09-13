# Tests: Track AM-10097 — Canonical scaffold gitignore template

## Test Commands

```bash
# This track's own suite (zero deps, node:test) — note env -u NODE_TEST_CONTEXT,
# the gotcha track 1096 documented for every node --test run in this repo
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10097-scaffold-gitignore.test.mjs

# The dirty-guard exemption suite this track extends (Phase 4)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10060-dirty-guard-exemptions.test.mjs

# Syntax check on everything touched
node --check conductor/services/scaffold-gitignore.mjs
node --check conductor/services/workspace-mode.mjs
node --check bin/lc.mjs

# Manual verification of this repo's own gitignore (Phase 4 / AC-5)
git check-ignore -v conductor/tracks/foo/.prespawn-block-count \
                    conductor/tracks/foo/.prespawn-block-kind
```

⚠️ **Do not run the full `conductor/tests/*.test.mjs` sweep casually.** Per this
project's recorded incidents, `node --test` and full vitest runs in this repo have
leaked real `laneconductor.sync.mjs` workers against the primary checkout. If a
broad run is needed, check `ps aux | grep laneconductor.sync.mjs` afterwards and
`readlink /proc/<pid>/cwd` before calling anything an orphan.

---

## Test Cases

### Phase 1 — `scaffold-gitignore.mjs` (unit, tmp dirs, no git needed for 1–5)

- [ ] **TC-1**: `ensureScaffoldGitignore()` on a directory with **no** `.gitignore`
      — expected: file created, `created === true`, `added` contains all nine
      patterns (2 secret + 7 runtime-state), and the file's non-comment lines are
      exactly that set.
- [ ] **TC-2**: Run TC-1's call a second time on the same directory — expected:
      `created === false`, `added` is empty, file content byte-identical to after
      the first run. (AC-2)
- [ ] **TC-3**: Pre-seed `.gitignore` with only `.env` and
      `conductor/tracks/**/conversation.md` — expected: exactly the seven missing
      patterns are appended, the two existing lines are neither duplicated nor
      reordered nor rewritten.
- [ ] **TC-4**: Pre-seed with macrodash's real path-scoped spellings
      (`conductor/tracks/**/.prespawn-block-count`,
      `conductor/tracks/**/.conv-cursor`) — expected: **no** bare duplicate is
      appended for either; `added` omits both. (REQ-7 / AC-2)
- [ ] **TC-5**: Pre-seed with a commented-out `# .worktrees/` line — expected:
      `.worktrees/` **is** appended (a comment is not an active pattern), and the
      comment line survives untouched.
- [ ] **TC-6**: Pre-seed with `/conductor/.runs/` (leading-slash spelling) —
      expected: recognised as satisfying `conductor/.runs/`, nothing appended.
- [ ] **TC-7**: Every entry in `SECRET_PATTERNS` and `RUNTIME_STATE_PATTERNS` has a
      non-empty `why` string — expected: passes. (Guards the Phase-2 refactor from
      silently dropping `bin/lc.mjs`'s existing reasoning comment.)

### Phase 1 + 2 — real `git check-ignore` behaviour (integration)

- [ ] **TC-8**: In a `git init`'d tmp repo, call `ensureScaffoldGitignore()`, then
      assert `git check-ignore` **exits 0** for each of:
      `conductor/tracks/AM-1-x/.conv-cursor`,
      `conductor/tracks/AM-1-x/.prespawn-block-count`,
      `conductor/tracks/AM-1-x/.prespawn-block-kind`,
      `conductor/tracks/AM-1-x/conversation.md`,
      `conductor/tracks/AM-1-x/conversation.json`,
      `.worktrees/10097/x`, `conductor/.runs/083.json`, `.env`,
      `.laneconductor.json`. (AC-1 — the actual user-facing outcome: git really
      ignores these, not merely "a line was appended".)
- [ ] **TC-9**: Same repo — assert `git check-ignore` **exits 1** (not ignored) for
      `conductor/tracks/AM-1-x/index.md`, `spec.md`, `plan.md` and `test.md`.
      Guards the deliberate carve-out from `43a7a634`: authored track content must
      stay tracked.
- [ ] **TC-10**: `git status --porcelain --untracked-files=all` in that repo, after
      creating one of each runtime-state file, reports **zero** lines for them —
      the precise thing the main-mode dirty guard reads. (AC-1, end-to-end)

### Phase 3 — drift guard (REQ-4)

- [ ] **TC-11**: Parse the fenced pattern block from
      `.claude/skills/laneconductor/SKILL.md` and assert set-equality with
      `RUNTIME_STATE_PATTERNS.map(p => p.pattern)` — expected: equal. Failure
      message must name the specific patterns present in one copy and not the
      other, so a future failure is self-explaining.
- [ ] **TC-12** *(manual, AC-4, performed once during Phase 3 and reverted)*:
      delete one pattern line from SKILL.md's fence, run TC-11 — expected: **fails**,
      naming that pattern. Then delete a different entry from
      `RUNTIME_STATE_PATTERNS` instead — expected: **fails** in the other
      direction. Record both observed failure outputs in `conversation.md`; restore
      both. A drift guard that has never been seen to fail is not a guard.

### Phase 4 — this repo's own gaps

- [ ] **TC-13**: `git check-ignore -v conductor/tracks/foo/.prespawn-block-count`
      and `…/.prespawn-block-kind` in this repo both exit 0 and name a
      `.gitignore` line — expected: pass after Phase 4 (**both exit 1 today**; capture
      the before/after). (AC-5)
- [ ] **TC-14**: `isWorkerBookkeepingPath('conductor/tracks/AM-1-x/.prespawn-block-count')`
      and the `-kind` counterpart → `true`; `isWorkerBookkeepingPath('.prespawn-block-count')`
      (repo root, outside any track folder) → `false` — the exemption is scoped to
      track folders exactly as `.conv-cursor`'s is, not widened.
- [ ] **TC-15**: `findDisqualifyingDirtyPaths(['conductor/tracks/AM-2-other/.prespawn-block-count'], 'conductor/tracks/AM-1-mine/')`
      → `[]` — a *different* track's counter file no longer disqualifies a
      main-mode spawn. (AC-6 — this is the user-facing outcome: the spawn proceeds.)
- [ ] **TC-16**: Negative control —
      `findDisqualifyingDirtyPaths(['src/index.js'], 'conductor/tracks/AM-1-mine/')`
      → `['src/index.js']`. Real WIP still blocks; the exemption did not widen into
      a hole.

### Phase 5 — end-to-end scaffold parity

- [ ] **TC-17** *(manual)*: `lc setup` in a throwaway `git init` directory, then run
      TC-8's `git check-ignore` list against it. Expected: all ignored. Record the
      real command output. (AC-1)
- [ ] **TC-18** *(manual)*: In a second throwaway directory, follow SKILL.md's
      skill-only scaffold instructions by hand (no `lc` on PATH), then run the same
      `git check-ignore` list. Expected: identical ignore decisions to TC-17 — diff
      the two outputs and show them equal. (AC-3)
- [ ] **TC-19** *(manual)*: Run `lc setup` twice in TC-17's directory; `diff` the
      `.gitignore` before and after the second run. Expected: empty diff. (AC-2)
- [ ] **TC-20** *(manual)*: `git -C ~/Code/macrodash status --porcelain` before and
      after this track's implementation. Expected: byte-identical, still exactly
      `?? .agents/`. Proves the Non-Goal held — nothing here wrote to macrodash.
      (AC-7)

---

## Acceptance Criteria

- [ ] All of TC-1 … TC-16 pass under `env -u NODE_TEST_CONTEXT node --test`.
- [ ] TC-17 … TC-20 performed for real with their output recorded in
      `conversation.md` — not reasoned about, not assumed.
- [ ] TC-12's two induced failures observed and recorded, then reverted.
- [ ] `node --check` clean on all three modified/added `.mjs` files.
- [ ] No file under `~/Code/macrodash` modified.
- [ ] No regression in `conductor/tests/track-10060-dirty-guard-exemptions.test.mjs`
      or `conductor/tests/track-1115-workspace-mode.test.mjs` (both read
      `isWorkerBookkeepingPath`, which Phase 4 changes).
