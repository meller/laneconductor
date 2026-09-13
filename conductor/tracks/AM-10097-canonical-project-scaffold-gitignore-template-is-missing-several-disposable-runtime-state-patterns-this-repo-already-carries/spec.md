# Spec: Canonical scaffold gitignore template — close the drift against what this repo already learned

## Problem Statement

`lc setup` (`bin/lc.mjs`) and the skill-only scaffold path
(`.claude/skills/laneconductor/SKILL.md`) each carry their own hand-maintained
`.gitignore` template. Neither has ever been kept in sync with this repo's own
`.gitignore`, which has accumulated — one incident at a time — the patterns that
keep disposable, machine-local LaneConductor runtime state out of git.

Every pattern that exists here but not in the templates is a pattern that
**every other LaneConductor-managed project has to rediscover the hard way**. The
failure mode is not cosmetic: the main-mode dirty-checkout guard
(`conductor/laneconductor.sync.mjs`'s `checkDirty`, filtered by
`findDisqualifyingDirtyPaths` in `conductor/services/workspace-mode.mjs`) runs
`git status --porcelain --untracked-files=all` and blocks the spawn on *any*
non-exempt dirty path. One stray untracked runtime file halts **every** main-mode
lane action in that project, including every merge — not just the track whose
file it is.

### Verified findings (re-confirmed 2026-09-13 during planning, not taken on report)

| # | Pattern | This repo's `.gitignore` | `lc setup` template | SKILL.md template | Written by |
|---|---------|--------------------------|---------------------|-------------------|------------|
| 1 | `.conv-cursor` | ✅ line 113 | ✅ (fixed 2026-09-13, `43a7a634`) | ✅ (same commit) | `conductor/laneconductor.sync.mjs` |
| 2 | `.worktrees/` | ✅ line 28 | ❌ **missing** | ❌ **missing** | `git worktree add` (lock/worktree flow) |
| 3 | `conductor/.runs/` | ✅ line 35 | ❌ **missing** | ❌ **missing** | track 10020 per-run pid markers |
| 4 | `.prespawn-block-count` | ❌ **missing even here** | ❌ **missing** | ❌ **missing** | `conductor/services/prespawn-block-counter.mjs` (`COUNT_FILE`) |
| 5 | `.prespawn-block-kind` | ❌ **missing even here** | ❌ **missing** | ❌ **missing** | same module (`KIND_FILE`) |

Confirmed mechanically, not by inspection: in the primary checkout,
`git check-ignore -v conductor/tracks/foo/.prespawn-block-count` prints **nothing**
(unignored), while the same call for `.conv-cursor`, `.worktrees/x` and
`conductor/.runs/1.json` each resolve to a real `.gitignore` line.

Findings 4 and 5 are the same disposable-bookkeeping category as `.conv-cursor` —
an integer and a string, rewritten on every pre-spawn block, reset by
`resetBlockCount()` — with no review value whatsoever.

### Root cause (this is what the fix has to address)

The template is duplicated in three places that can silently disagree: this
repo's `.gitignore`, a hardcoded string list in `bin/lc.mjs`, and a prose
code-fence in `SKILL.md`. Nothing connects them, so "add the pattern we just
learned about" is a three-place manual edit that has been done inconsistently
every single time. Adding five more patterns to three unlinked lists reproduces
the bug at a larger size. **The drift itself is the defect**, so the fix
introduces one shared source and a test that fails when a copy drifts from it.

### Findings that resolve without code (items 3 and 4 of the intake)

Both were investigated during planning:

- **macrodash worktree gitlinks + runtime noise — already remediated, no action
  needed.** The 6 accidentally-tracked `.worktrees/` gitlinks (009, 027, 030, 031,
  26, 29) are gone: `git ls-files -s | awk '$1=="160000"'` in
  `~/Code/macrodash` returns **zero** rows. Its `.gitignore` now carries
  `.worktrees/`, `conductor/.runs/`, `conductor/tracks/**/.prespawn-block-count`
  and `conductor/tracks/**/.prespawn-block-kind`. Landed in macrodash's own
  commits `3f8b87bd` ("untrack .worktrees/ gitlinks + ignore LaneConductor run
  bookkeeping") and `deff9e06` ("gitignore remaining LaneConductor worker runtime
  files"). The intake's request for explicit confirmation before touching
  macrodash is therefore moot — **this track writes nothing to macrodash.**
- **`.agents/tracks/071-simplify-auth-pages/plan.md` — genuine authored content,
  must NOT be gitignored.** It is a real, hand-written 27-line track plan
  ("Simplify Auth Pages (Google-Only Registration/Login)") with concrete
  requirements naming macrodash's own files (`nextjs_frontend/app/(auth)/login/
  page.tsx` etc.), dated 2026-04-02. It is **not** sync noise and **not** a
  symlink-resolution artifact like AM-10096's nested `.claude` corruption. Its
  origin is an Antigravity session writing a plan under `.agents/tracks/` — a
  path no LaneConductor code ever writes (`.agents/skills/` and `.agents/rules/`
  are the only `.agents` paths the scaffold creates, both as symlinks), most
  likely invented by mirroring those. Its number collides with macrodash's real,
  unrelated `conductor/tracks/071-unified-intent-classification`. It is currently
  **macrodash's only dirty path** (`git status --porcelain` there reports exactly
  `?? .agents/`), and since `.agents/tracks/**` is not exempted by
  `isWorkerBookkeepingPath`, it is right now blocking every main-mode spawn in
  that project. Disposition is a macrodash decision (commit it, delete it as
  superseded after five months, or re-file it as a properly-numbered track) and
  is handed off as such — **out of scope for this repo's track.**

## Requirements

- **REQ-1** — One canonical, code-level source of the scaffold gitignore patterns:
  a new `conductor/services/scaffold-gitignore.mjs` exporting the pattern list
  (each entry carrying the pattern *and* the one-line reason it exists) plus an
  idempotent `ensureScaffoldGitignore(projectRoot)` that creates or appends to
  `.gitignore` and reports what it added.
- **REQ-2** — `bin/lc.mjs`'s `setup` command calls that helper instead of its
  current inline string list. Behaviour for the five patterns it already writes
  is unchanged; it gains findings 2–5.
- **REQ-3** — `SKILL.md`'s skill-only scaffold block lists the identical runtime-state
  patterns. Skill-only mode has no CLI to call, so this copy stays prose — but
  it stops being *unverified* prose (see REQ-4).
- **REQ-4** — A test asserts the SKILL.md fenced pattern block and
  `scaffold-gitignore.mjs`'s exported list are the same set. Adding a pattern in
  one place and not the other is a **test failure**, not a silent five-month
  drift. This is the requirement that actually fixes the root cause.
- **REQ-5** — This repo's own `.gitignore` gains `.prespawn-block-count` and
  `.prespawn-block-kind`, which it is missing today.
- **REQ-6** — `isWorkerBookkeepingPath` (`conductor/services/workspace-mode.mjs`)
  exempts `.prespawn-block-count`/`.prespawn-block-kind` inside a track folder,
  as it already does for `.conv-cursor`. Defence in depth: `.gitignore` only
  suppresses *untracked* reporting, so a copy committed before the ignore landed
  keeps showing dirty forever — this is precisely what happened with the 27
  committed `.conv-cursor` files (track 10020) and is why that exemption exists.
- **REQ-7** — `ensureScaffoldGitignore` is idempotent and tolerant of the
  path-scoped spelling already in the wild: a project whose `.gitignore` reads
  `conductor/tracks/**/.prespawn-block-count` (macrodash's form) must not get a
  duplicate bare entry appended on a re-run.

### Deliberate deviation from the intake wording

The intake asks for `conductor/tracks/**/.prespawn-block-count` and
`conductor/tracks/**/.prespawn-block-kind`. This spec uses the **bare filename**
form (`.prespawn-block-count`, `.prespawn-block-kind`) instead, in both the
templates and this repo's `.gitignore`, for three reasons: it matches the
`.conv-cursor` precedent set one commit ago and the reasoning recorded alongside
it in `bin/lc.mjs` ("a bare filename pattern matches at any depth, so this covers
every track's own folder"); it stays correct if the counter files ever move; and
it also covers a test fixture that writes one outside `conductor/tracks/`, which
is the same protection the `.test-tmp-*` wildcard in this repo's `.gitignore` was
added for. REQ-7 guarantees the already-deployed path-scoped spelling is
recognised, so nothing in the wild gets a duplicate.

## Acceptance Criteria

- [ ] **AC-1** — Running `lc setup` in a fresh project produces a `.gitignore`
      under which `git check-ignore` resolves every one of
      `conductor/tracks/x/.conv-cursor`, `.worktrees/x`, `conductor/.runs/1.json`,
      `conductor/tracks/x/.prespawn-block-count`, `conductor/tracks/x/.prespawn-block-kind`,
      `conductor/tracks/x/conversation.md`, `.env` and `.laneconductor.json`.
- [ ] **AC-2** — Running `lc setup` twice in a row leaves a `.gitignore` with no
      duplicated pattern lines, and running it over macrodash's existing
      path-scoped spelling adds no second entry for the same file (REQ-7).
- [ ] **AC-3** — A project scaffolded through the skill-only path (SKILL.md, no
      `lc` binary) ends up ignoring the same file set as AC-1's CLI-scaffolded
      project — verified by following SKILL.md's own instructions, not by reading
      them.
- [ ] **AC-4** — Deleting one pattern from SKILL.md's fenced block, or from
      `scaffold-gitignore.mjs`'s exported list, makes the drift test **fail**.
      (Demonstrated during implementation; the demo mutation is reverted.)
- [ ] **AC-5** — In this repo, `git check-ignore -v conductor/tracks/foo/.prespawn-block-count`
      and the `-kind` counterpart both resolve to a `.gitignore` line and exit 0
      (today both exit 1, matching nothing).
- [ ] **AC-6** — With a *tracked-then-modified* `.prespawn-block-count` in some
      other track's folder, a main-mode spawn still proceeds — i.e. that path no
      longer appears in `findDisqualifyingDirtyPaths`' output, matching
      `.conv-cursor`'s existing behaviour.
- [ ] **AC-7** — The macrodash disposition is recorded in `conversation.md` for a
      human: remediation already landed (no action), and
      `.agents/tracks/071-simplify-auth-pages/plan.md` is genuine content needing
      a macrodash-side decision, explicitly **not** something to gitignore. No
      file under `~/Code/macrodash` is modified by this track.

## Non-Goals

- Touching `~/Code/macrodash` in any way. Its remediation already landed; its one
  remaining orphan is a content decision for that project's owner.
- Retrofitting existing scaffolded projects. `ensureScaffoldGitignore` only runs
  during `lc setup`; sweeping every project on the machine is a separate effort.
- Adding `conductor/tracks/**/index.md` to any template — it carries real
  authored content, as `43a7a634` deliberately recorded.
- Fixing the pre-existing naive-substring weakness in the `.env` /
  `.laneconductor.json` checks beyond what REQ-7's line-aware matching gives for
  free.

## API Contracts / Data Models

No schema or endpoint changes. One new module:

```js
// conductor/services/scaffold-gitignore.mjs
export const SECRET_PATTERNS        // [{ pattern, why }]  .env, .laneconductor.json
export const RUNTIME_STATE_PATTERNS // [{ pattern, why }]  the 7 disposable-state patterns
export function ensureScaffoldGitignore(projectRoot) // → { created: bool, added: string[] }
```
