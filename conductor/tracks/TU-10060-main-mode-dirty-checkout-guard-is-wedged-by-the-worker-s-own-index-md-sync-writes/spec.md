# Spec: Main-mode dirty-checkout guard — wedge diagnosis and durable fix

## Problem Statement

Track 10051 sat at `done:queue` on 2026-09-03 and could not merge. The
main-mode pre-spawn guard (`conductor/laneconductor.sync.mjs:4801`) refused
to spawn, reporting:

> Main-mode run blocked — the primary checkout has unrelated uncommitted
> changes outside this track's folder: prisma/schema.sql

The `done` lane's merge action is forced to `workspace: main` (track 10035),
so this guard gates **every merge in the project**, not just one track. A
single non-exempt dirty path halts all integration.

The track report attributes this to the worker's own `index.md` status-marker
writes creating the dirt that blocks it. **Investigation shows that specific
mechanism is already fixed** — see Finding 1. The real still-open defects are
different, and are what this track fixes.

## Findings (investigation, 2026-09-04)

### Finding 1 — the `index.md` mechanism is already exempt (no work needed)

`isWorkerBookkeepingPath()` in `conductor/services/workspace-mode.mjs:161`
already exempts `conductor/tracks/*/(index|plan|spec|test).md` from the
guard, added 2026-08-25 for exactly this reason (see its doc comment), nine
days before the incident. `conversation.md` is deliberately excluded because
a human can have real WIP there.

Verified live against the primary checkout on 2026-09-04:

| Measure | Value |
|---|---|
| Dirty paths reported by `git status --porcelain -uall` | 19 |
| Paths `findDisqualifyingDirtyPaths` returns | 0 |

All 19 are track marker churn and quarantined `_duplicate-*` folders. So the
report's claim that worker `index.md` writes restore the blocking condition
is **not** what happened, and no change to the exemption list is warranted
for that class. This track must not "fix" it again.

### Finding 2 — `prisma/schema.sql` drift was a one-off, not recurring

`prisma/schema.sql` is a generated Atlas/Prisma dump written only by
`scripts/atlas-prisma.mjs`, called only from `scripts/setup-db.mjs`. No
worker, CLI, or Makefile path regenerates it. Its drift on the incident day
came from track 10053's own migration work and was committed as
`chore(db): refresh schema.sql dump with prespawn_block_*, model_override,
dismissed_at`. This answers the report's open question: **one-off**. It is
still worth a targeted detection path (Finding 4) because the class recurs
whenever anyone runs the DB setup script.

### Finding 3 — the escalation counter fails open, so a permanent block retries forever and never escalates (PRIMARY DEFECT)

The guard is supposed to escalate: `decidePreSpawnBlockOutcome` warns on the
first block of a streak, stays silent mid-streak, and marks the track failed
at 5 consecutive blocks. In `local-api`/`remote-api` the streak counter lives
in `tracks.prespawn_block_count`, incremented via
`POST /track/:num/prespawn-block`.

Those four columns are added by `ui/server/migrations/013_track_10040_prespawn_block.sql`.
**Nothing applies `ui/server/migrations/*.sql` automatically** — no runner
exists in `ui/server/index.mjs` or `bin/lc.mjs`; they are run by hand. The
Atlas chain only gained them on the incident day
(`migrations/20260903120000_add_prespawn_block_columns.sql`).

On any database where 013 has not been applied, the endpoint returns 500. The
worker catches that and deliberately fails safe:

```
countBefore = 0;   // "treating as first-of-streak"
```

which pins every block at first-of-streak forever. Escalation becomes
structurally unreachable, `⚠️` is re-posted on every block, and the track
retries into the same wedge indefinitely. This exactly matches the observed
shape: 10051 blocked twice, both reported `warn`, never escalating.

The fail-safe's intent is right (never escalate on a guess). Its
implementation is wrong: it silently converts a permanent block into an
unbounded quiet retry, and nothing anywhere reports that the counter itself
is broken.

### Finding 4 — the operator has no actionable remedy for a regenerable artifact

`classifyHealableDirtyPath` (`conductor/services/dirty-path-heal.mjs`) only
recognises one class: deleted-from-worktree **and** git-ignored **and** on a
build-output basename allowlist. `prisma/schema.sql` is modified, tracked,
and not ignored, so it produces no suggestion at all. The operator gets a
bare path name and must work out both what dirtied it and that every merge in
the project is halted until they act.

### Finding 5 — auto-complete re-wedges without being rate-limited

The auto-complete chain (`checkDispatchInbox`, dispatch action
`auto-complete-track`) is a worker-dispatch inbox entry, processed "every
sync tick regardless of sync-only/sync+poll mode" by design. On a pre-spawn
block it correctly reports `failed` and drops the entry, so it does not
self-loop. But with Finding 3 in play, each re-issue of "Complete & Merge"
re-wedges at first-of-streak with a fresh `⚠️`, and the track never reaches a
terminal failure a human would notice.

## Solution

Keep the guard. Fix what makes a legitimate block indistinguishable from
routine housekeeping and unbounded in time.

1. Make the streak counter survive a broken/unavailable counter backend by
   falling back to the local sibling-file counter that `local-fs` already
   uses, so escalation stays reachable in every mode.
2. Surface counter-backend failure once, loudly, as its own condition.
3. Teach the block message to state project-wide impact and, where possible,
   name the command that produced the dirty artifact.
4. Extend heal classification to recognise regenerable-artifact drift as a
   *proposal only* — never auto-applied, matching the module's existing
   conservative stance.
5. Lock Finding 1's exemption in with a regression test so a future change
   cannot silently reintroduce the reported symptom.

## Requirements

- **REQ-1**: `findDisqualifyingDirtyPaths` must continue to exempt
  `conductor/tracks/*/(index|plan|spec|test).md` and must continue **not** to
  exempt `conductor/tracks/*/conversation.md`. Covered by a regression test.
- **REQ-2**: When the collector's `prespawn-block` counter call fails,
  `handlePreSpawnBlock` must fall back to the filesystem sibling counter
  (`.prespawn-block-count` / `.prespawn-block-kind` in the track folder)
  rather than hardcoding `countBefore = 0`, so escalation remains reachable.
- **REQ-3**: The fallback must apply the same cause-change reset semantics as
  the `local-fs` path: a different `kind` starts a new streak.
- **REQ-4**: A counter-backend failure must be reported once per streak as a
  distinct, greppable warning naming the likely cause (unapplied
  `ui/server/migrations/013_track_10040_prespawn_block.sql`), not folded into
  the generic block warning.
- **REQ-5**: A successful spawn must reset both the API counter and the
  filesystem fallback counter, so a fallback count cannot outlive the block
  that created it.
- **REQ-6**: The `⚠️`/`❌` block comment must state that main-mode is halted
  project-wide (every merge blocked), not read as a single-track
  housekeeping note.
- **REQ-7**: `classifyHealableDirtyPath` must recognise a
  modified-and-tracked regenerable artifact (initially `prisma/schema.sql`,
  `cloud/schema.sql`) and return a **suggestion-only** classification naming
  how it is regenerated. It must never be auto-applied, and must never be
  returned as `healable: true` (which is the auto-apply gate).
- **REQ-8**: The `auto_heal` apply path must remain gated on every
  disqualifying path being `healable`, unchanged — a suggestion-only
  classification must not widen unattended write access to `main`.
- **REQ-9**: No change to `resolveWorkspaceMode`, the guard's placement, its
  30s settle window, or the `done`-lane `workspace: main` forcing. The guard
  stays.

## Non-Requirements (explicitly out of scope)

- Adding a runner for `ui/server/migrations/*.sql`. Real, but its own
  concern; this track only stops the missing migration from silently
  disabling escalation.
- Moving track status markers out of the primary checkout into the database
  (one of the report's suggested options). Rejected: Finding 1 shows the
  markers are already exempt, so this would be a large change with no
  behavioural benefit, and `local-fs` mode has no database to move them to.
- Auto-committing worker marker churn. Rejected for the same reason.

## Acceptance Criteria

- [ ] With the primary checkout dirtied by a tracked, non-exempt file, a
      `done`-lane merge spawn is blocked five consecutive times and the fifth
      leaves the track at `done:failure` with exactly one `❌` comment and one
      `⚠️` comment across the whole streak — **including when the collector's
      prespawn-block endpoint is unavailable**.
- [ ] With the collector's prespawn-block endpoint returning 500, a human
      reading the worker log sees a distinct warning naming the unapplied
      migration, not just a generic block line.
- [ ] After a blocked streak, a subsequent successful spawn leaves both the
      DB counter and the track folder's `.prespawn-block-count` at zero, so
      the next unrelated block starts a fresh streak.
- [ ] A human reading the block comment can tell from the comment alone that
      every merge in the project is halted, and what to do about the named
      path.
- [ ] Dirtying `conductor/tracks/<other-track>/index.md` does not block a
      main-mode spawn; dirtying `conductor/tracks/<other-track>/conversation.md`
      still does.
- [ ] `prisma/schema.sql` dirty produces a suggestion naming
      `node scripts/atlas-prisma.mjs` and is **not** auto-applied even with
      `manager.auto_heal: true`.
