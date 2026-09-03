# Spec: Worktree Base Freshness — Start Track Branches From The Freshest Safe Base

## Problem Statement

`createWorktree()` (`conductor/laneconductor.sync.mjs:3940`) creates every new track
branch with a hardcoded start point:

```js
const addArgs = resolveWorktreeAddArgs({ branchExists, branchName, worktreePath, startPoint: 'HEAD' });
gitExec(`git worktree add -B "${branchName}" "${worktreePath}" HEAD`, process.cwd());
```

The literal string `HEAD` produces two distinct defects.

### Defect 1 — the base is whatever local `main` happened to be, which can be arbitrarily stale

Local `main` is only ever refreshed from `origin/main` by `checkOutOfBandGitSync()`
(`laneconductor.sync.mjs:4532`), and that refresh is heavily conditional:

- it ticks every 30s but only *acts* every `git.fetch_interval_ms` (default **300 000 ms /
  5 minutes**, `laneconductor.sync.mjs:4533`);
- `safePull()` refuses anything that is not a strict fast-forward — `ahead > 0` returns
  `reason: 'diverged'` and nothing is pulled (`git-divergence.mjs:84`);
- it also refuses on `dirty-overlap`, on `git.auto_pull: false`, and on fetch failure.

So in the best case a track branch starts up to 5 minutes behind `origin/main`. In the
common case it is much worse: **once local `main` is ahead of `origin/main`, it never
converges again.** `checkOutOfBandGitSync` returns early at `behind === 0`
(`laneconductor.sync.mjs:4544`), and even when `behind > 0` the `ahead > 0` case is refused
outright. Nothing in the worker ever pushes local `main` — `mergeWorktreeBranch()`
(`services/worktree-merge.mjs`) advances `refs/heads/main` via `update-ref` and stops there.
Meanwhile the worker *adds* commits to local `main` on every single lane action
(`chore(track-N): sync files before worktree`, `laneconductor.sync.mjs:3857`, plus the git
lock commits).

Measured on this repo while planning this track:

```
$ git rev-list --left-right --count main...origin/main
27      0
```

27 local-only commits, 0 incoming. That is the steady state, not an anomaly.

Consequence: a track branch is based on code the rest of the world may have moved past,
the agent implements against a base that no longer reflects `main`, and the cost lands at
merge time as conflicts — or, worse, as a silent re-introduction of behavior `main` already
changed. Nothing surfaces the staleness until then.

### Defect 2 — `HEAD` is not `main`

`gitExec(..., process.cwd())` resolves `HEAD` against the primary checkout's *currently
checked-out branch*. Nothing anywhere asserts the primary checkout is on `main` — a human
who left it on another branch, or a prior `workspace: main` run that changed branches,
silently causes every subsequently created track branch to be based on that unrelated
branch. `getMainBranch()` already exists (`conductor/agent-runtime.mjs:42`) and is used by
the git-lock fetch two lines earlier; `createWorktree` simply never uses it.

### Why the obvious fix is wrong

The track title says "start track branches from `origin/main`", and two other call sites in
this repo already do exactly that — `conductor/lock.mjs:138`
(`git worktree add "$path" origin/main`) and the dead-but-still-present
`conductor/agent-runtime.mjs:115` (`git worktree add -b … origin/$(getMainBranch())`).

**Unconditionally basing on `origin/main` would make this repo strictly worse.** With local
`main` 27 commits ahead, every new track branch would start 27 commits in the past,
missing every already-merged track, and would generate precisely the merge conflicts this
track exists to eliminate.

The correct requirement is therefore **the freshest base that loses nothing**, not
`origin/main` specifically. The two coincide only when local `main` has no unique commits.

## Solution

Introduce a pure decision module, `conductor/services/worktree-start-point.mjs`, exporting
`resolveWorktreeStartPoint()`. It follows the established pattern of
`services/worktree-create-args.mjs` (track 1114): the safety-critical decision is a pure,
directly unit-testable function, and all git I/O stays in `createWorktree()`.

`createWorktree()` gathers the facts (`checkDivergence()` — already available and already
cheap here, since `checkAndClaimGitLock()` fetched `origin/<main>` moments earlier at
`laneconductor.sync.mjs:3796`), optionally refreshes local `main` via the existing
`safePull()`, then feeds the outcome to the resolver and uses the returned start point.

### Resolution table

| Local vs `origin/<main>` | Worker action first | Resulting `startPoint` | `reason` | Stale? |
|---|---|---|---|---|
| `behind > 0`, `ahead === 0` | `safePull()` fast-forwards local `main` | `<main>` (now equals `origin/<main>`) | `refreshed` | no |
| `behind > 0`, `ahead === 0`, pull refused (`dirty-overlap` / `auto-pull-disabled` / `merge-failed`) | none | `origin/<main>` | `remote-ahead-pull-refused` | no — local `main` has no unique commits, so the remote ref is strictly newer and safe |
| `ahead > 0`, `behind === 0` | none | `<main>` | `local-ahead` | no |
| `ahead > 0`, `behind > 0` (diverged) | none | `<main>` | `diverged` | **yes**, by `behind` commits |
| fetch failed / no `origin` / no remote branch | none | `<main>` | `offline` | unknown |
| `<main>` ref does not resolve locally | none | `HEAD` | `no-main-ref` | unknown |

Two properties fall out of this table:

- **Defect 2 is fixed everywhere**: the start point is the `<main>` ref *by name* in every
  row but the last, so a primary checkout sitting on some other branch no longer
  contaminates new track branches.
- **The `no-main-ref` row preserves today's behavior** for the brand-new-project case
  (`laneconductor.sync.mjs:7086`), where a repo has exactly one commit and possibly no
  `main` ref yet. Nothing that works today starts failing.

### Observability

When the resolved base is knowingly stale (`diverged`, `staleBy > 0`), `createWorktree()`
logs it and appends one comment to the track's `conversation.md`:

```
> **system**: ⚠️ Track branch based on a stale <main> — local <main> has diverged from
> origin/<main> (N commit(s) behind, M ahead). Expect to resolve those N commit(s) at merge
> time.
```

`local-ahead` and `offline` are logged only, never commented — `local-ahead` is this
project's normal steady state and a comment on every worktree creation would be pure noise.

### Secondary alignment: `conductor/lock.mjs`

`conductor/lock.mjs:138` is a separate, human-invocable entry point (the
`/laneconductor lock` skill command) with two defects of its own beyond the shared one:
it hardcodes `origin/main` (wrong on a `master` repo — `getMainBranch()` exists precisely
for this) and it creates a **detached** worktree with no `-b`, so `/laneconductor lock` +
manual work produces commits on no branch at all. It is routed through the same resolver.

## Requirements

- **REQ-1**: A new module `conductor/services/worktree-start-point.mjs` exports a pure
  `resolveWorktreeStartPoint({ mainBranch, mainRefExists, fetchOk, ahead, behind, pullOutcome })`
  returning `{ startPoint, reason, staleBy }`, implementing the resolution table above. It
  performs no git I/O and no filesystem access.
- **REQ-2**: `createWorktree()` (`laneconductor.sync.mjs`) resolves its start point through
  REQ-1 instead of the literal `'HEAD'`, and passes the result to `resolveWorktreeAddArgs`.
- **REQ-3**: When local `<main>` is a strict fast-forward behind `origin/<main>`,
  `createWorktree()` refreshes it with the existing `safePull()` before creating the branch,
  so the new branch starts at `origin/<main>`.
- **REQ-4**: `createWorktree()` never bases a branch on `origin/<main>` when local `<main>`
  holds commits `origin/<main>` does not (`ahead > 0`). Local work is never dropped.
- **REQ-5**: The start point is always a named ref (`<main>` or `origin/<main>`), never the
  literal `HEAD` — except in the `no-main-ref` fallback row, which preserves today's
  behavior for a repo with no resolvable `<main>`.
- **REQ-6**: Track 1114's guarantee is untouched: when the branch already exists,
  `resolveWorktreeAddArgs` still returns a plain checkout with no `-B` and the start point
  is ignored entirely. A resumed branch is never rebased or reset onto a fresher base.
- **REQ-7**: When the resolved base is knowingly stale (`staleBy > 0`), the worker logs it
  and appends exactly one `> **system**: ⚠️ …` comment to the track's `conversation.md`,
  in the format required by the skill's conversation protocol. `local-ahead` and `offline`
  produce a log line only.
- **REQ-8**: `createWorktree()` degrades safely: any failure inside divergence detection or
  the refresh pull falls back to the current behavior (base on `<main>`, or `HEAD` if
  `<main>` does not resolve) rather than aborting worktree creation. A network outage must
  never stop a track from running.
- **REQ-9**: `conductor/lock.mjs` uses `getMainBranch()` rather than a hardcoded
  `origin/main`, routes its start point through REQ-1, and creates the worktree on a named
  `track-<N>` branch instead of a detached HEAD.
- **REQ-10**: No additional network round-trip is added to the hot path.
  `checkAndClaimGitLock()` already runs `git fetch origin <main> --quiet` immediately before
  `createWorktree()` (`laneconductor.sync.mjs:3796`), so divergence counts are read from
  already-fresh remote-tracking refs.

## Non-Goals

- **Rebasing or refreshing an existing track branch.** Explicitly out of scope. Track 1114
  exists because force-updating an existing branch destroyed real committed work; REQ-6
  preserves that guarantee. A resumed branch keeps its original base.
- **Reconciling a diverged local `main` with `origin/main`.** The `diverged` row detects and
  reports; it does not merge. A real three-way merge of `main` is a human decision.
- **Pushing local `main` to `origin`.** The root cause of this repo's permanent 27-ahead
  state is that `mergeWorktreeBranch()` advances `refs/heads/main` and never pushes. That is
  a real gap, but it is a change to merge semantics, not to worktree creation — it belongs
  in its own track. This track makes the consequence safe and visible; it does not fix the
  cause.
- **`conductor/agent-runtime.mjs`.** Its `createWorktree()` (line 95) is dead code — nothing
  in the repo imports the module (verified: `grep -rn "from '.*agent-runtime"` returns no
  hits outside comments). Left untouched; deleting dead code is not this track's job.

## Acceptance Criteria

- [ ] On a repo where local `<main>` is behind `origin/<main>` and can fast-forward, a newly
      created track worktree's `HEAD` equals `origin/<main>`'s commit — the agent starts
      from code that includes the incoming commits.
- [ ] On a repo where local `<main>` is ahead of `origin/<main>` (this repo's steady state),
      a newly created track worktree's `HEAD` equals local `<main>` — none of the local-only
      commits are missing from the branch's history.
- [ ] With the primary checkout sitting on a branch other than `<main>`, a newly created
      track branch is based on `<main>`, not on that branch.
- [ ] Creating a worktree for a track whose `track-<N>` branch already exists leaves that
      branch's tip commit unchanged (track 1114 regression guard still holds).
- [ ] With `origin` unreachable, worktree creation still succeeds and the track still runs.
- [ ] When local `<main>` is genuinely diverged, the track's `conversation.md` contains a
      `> **system**: ⚠️` comment naming how many commits behind the base is — a human can
      see the staleness before merge time rather than discovering it as a conflict.
- [ ] `node --test conductor/tests/track-10050-worktree-start-point.test.mjs` passes.
- [ ] `node --test conductor/tests/track-1114-worktree-create-args.test.mjs` still passes.

## API Contracts / Data Models

No DB schema changes. No API changes. No `.laneconductor.json` schema changes — the existing
`git.fetch_interval_ms` and `git.auto_pull` keys are read through the existing
`getGitConfig()` and their meaning is unchanged.

```js
// conductor/services/worktree-start-point.mjs
/**
 * @param {object}  input
 * @param {string}  input.mainBranch     e.g. 'main' — from getMainBranch()
 * @param {boolean} input.mainRefExists  does refs/heads/<mainBranch> resolve locally?
 * @param {boolean} input.fetchOk        did checkDivergence's fetch succeed?
 * @param {number|null} input.ahead      local-only commit count
 * @param {number|null} input.behind     incoming commit count
 * @param {string|null} input.pullOutcome  'pulled' | safePull's `reason` | null (not attempted)
 * @returns {{ startPoint: string, reason: string, staleBy: number|null }}
 */
export function resolveWorktreeStartPoint(input) { /* … */ }
```
