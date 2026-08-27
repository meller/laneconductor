# Workflow

## Commit Strategy
- Conventional Commits: feat/fix/docs/refactor/test/chore
- Include track number: `feat(track-NNN): description`

## Branching Model
- main: production-ready
- feature branches: track-NNN-description

## Development Process
1. Create track with `/laneconductor newTrack`
2. Write spec.md before coding
3. Implement in phases with commits per phase
4. Update progress with `/laneconductor pulse`

## Code Review
- Self-review before marking done
- Update plan.md with learnings after each phase

## Lane Transitions

Transitions can specify just a lane (defaults: moving → `queue`, staying → `success`/`failure`) or a explicit state using `lane:status` format.

| Lane         | On Success   | On Failure   |
|--------------|--------------|--------------|
| plan         | plan:success | backlog      |
| implement    | review:queue | implement:failure |
| review       | quality-gate:queue | implement:queue |
| quality-gate | done:queue   | plan:queue   |
| done         | done:success | done:failure |

`done`'s "on success" is the merge action (track 10035) actually landing the code — see
**Merge As A Done Lane Action** below. `quality-gate` no longer declares `done:success` directly.

## Workflow Configuration
Machine-readable config lives in `conductor/workflow.json`.
Edit it directly or via `/laneconductor workflow set`.
See `conductor/workflow.json` for lane transitions, parallel limits, and model overrides.

## Workspace Modes (Track 1115)

Every lane action resolves to one of two workspace modes:

- **`branch`** (default) — lock → worktree → track branch → merge at
  `done:success`. The safe default for autonomous/unattended runs: a run
  that goes sideways stays quarantined on its own branch.
- **`main`** — runs directly in the primary checkout. No worktree, no
  track branch. Still takes the git lock (serializes to one lane action
  at a time per project), and every commit made during the run must
  reference the track (`feat(track-NNN): ...`) per the Commit Strategy
  above — the worker injects this instruction automatically.

**When to use `main`:** attended bug fixes (small, fast, worktree overhead
dominates the change itself) and self-hosted infrastructure fixes to
this project's own worker/API/UI, where you need to run the fix from the
checkout that's actually serving it — a fix on a branch never takes
effect until merged and restarted. **`branch` stays the default for
everything else**, especially unattended/autonomous runs: a track marked
`main` via inference alone (see `**Track Kind**` below) still runs on
`branch` when claimed from the open queue, and only runs `main` when a
human deliberately set `**Workspace**: main`.

The `plan` lane always runs `main`-direct for every track, regardless of
mode — it only writes the track's own docs, and the worktree for a
`branch`-mode track is created lazily at the first lane action that
needs one (normally `implement`), not at track creation.

Two markers control this, in `index.md`:
- `**Workspace**: main|branch` — a deliberate, explicit choice (set by a
  human, `lc new --workspace`, or a track detail panel control). Always
  wins, except the `plan` lane still runs `main` regardless.
- `**Track Kind**: bug|feature` — an *inference* (from the New Track
  modal's type selector, or `/laneconductor plan`'s own classification
  when neither marker is set). Feeds a `bug` → `main` default, but —
  unlike `**Workspace**` — does not survive an auto-queue claim, so an
  inferred-but-unconfirmed bug track still runs safely on `branch` when
  nobody is watching.

See `conductor/tracks/1115-workspace-mode-main-vs-branch/spec.md` for the
full resolution table and the reasoning behind the marker split.

## Model Overrides

Which model an automated lane action uses is resolved in this order (highest wins):

1. **Track-level** — a `**Model**: <model-id>` marker in the track's own
   `index.md` (set via the track detail panel's "Model override" field, or
   by hand). Beats everything below, for that track only.
2. **Lane-level** — `lanes.<lane>.primary_model` in `conductor/workflow.json`
   (editable via Workflow Settings' Provider/Model picker in the app, or
   `/laneconductor workflow set <lane> primary_model <id>`).
3. **Project default** — `.laneconductor.json`'s `project.primary.model`
   (editable via Project Configuration, or a worker's "Change Model" action).

The **provider** (which CLI — Claude, Antigravity, etc.) is fixed
project-wide (`.laneconductor.json`'s `project.primary.cli`) and never
varies per lane or per track — only the model does. This is deliberate:
switching providers mid-track would break session continuity
(`--resume`), which is provider-specific. A stray provider override at any
level (lane or track) is detected and stripped with a warning, never
honored.

**Two caveats, both by design, not bugs:**
- **Worker mode only.** Model selection is applied by the worker at spawn
  time (`--model` passed to the launched CLI). Skill-only sessions (no
  worker — e.g. Claude Desktop driving `conductor/` files directly) have
  nothing to apply it to; the model is whatever session the human is
  running. All three worker modes (local-fs, local-api, remote-api) honor
  it identically, since they share the same spawn path.
- **Best-effort matching.** The requested model id is passed to the CLI
  unvalidated against what's actually installed on the executing machine.
  If the worker can't serve it, that run fails at the CLI level and normal
  retry/`on_failure` handling applies — it is not blocked ahead of time at
  claim time. (Claim-time capability matching, if wanted later, belongs in
  the claim-allowlist machinery — tracks 1084/1109 — as its own effort.)

## PR & Merge Modes (Track 10018, superseded by Track 10035)

Controls how track branches integrate back into the main branch. This is configured via the `**Merge Mode**: pr|direct` marker in the track's `index.md`, read by the `done`-lane merge action (see below):

- **`pr`** (default): Pushes the track branch to GitHub and opens a Pull Request, landing the track at `done:waiting`. A human can preview the branch from the Worktrees panel and approve/merge the PR directly on GitHub — there is no in-app Merge PR button.
- **`direct`**: The merge action merges the track branch straight to `main` in-session, resolving real conflicts as part of the same run, landing the track at `done:success` once merged.

## Merge As A Done Lane Action (Track 10035)

Merging is a standard lane action, not a special case. Once quality-gate passes, the track lands
at `done:queue` — "unmerged," not "done." A worker claims it (Auto Run or a manual ▶, exactly
like any other lane action) and runs `/laneconductor merge`, which executes in the **primary
checkout** (`workspace: main` — the only lane action for which that's forced rather than
inferred, since there is nothing to run on a track's own branch when the point of the run is to
integrate that branch into `main`). The session produces a live transcript like every other lane
action.

```
quality-gate ──success──▶ done:queue      "unmerged", waiting for the merge action
                              │
                    worker claims it (auto-run or ▶)
                              ▼
                         done:running     merge skill session, live transcript
                              │
        direct mode ──────────┼────────── pr mode
        merge to main,        │           push branch, gh pr create
        resolve conflicts     │                   │
        in-session            ▼                   ▼
                         done:success        done:waiting  ← card + worktree row show
                              ▲              "PR open → [GitHub link]"
                              │                   │
                              └──── reconciler ───┤ PR merged → success (+ cleanup)
                                                  └ PR conflicted → back to done:queue
```

`done:success` means the code is actually reachable from local `main` (direct mode) or the PR
has actually been merged on GitHub (pr mode) — never anything less. A conflicted PR routes back
to `done:queue` with a system comment; the next merge run updates the branch from `main`,
resolves in-session, and returns to `done:waiting`. See
`conductor/tracks/10035-merge-as-a-done-lane-action/spec.md` for the full requirements and the
five specific bugs (dead-PID lock trust, folder-matching, auto-complete ignoring merge_mode,
merge-pr posting no result, stale DB `merge_mode`) this replaces the old four-dispatch-handler
machinery to fix.

## Auto-Run Configuration (Track 10017)

Determines whether a track can be automatically claimed and executed by background workers. Configured via the `**Auto Run**: yes|no` marker in `index.md`:

- **`yes`**: Allows non-sync-only workers to pick up the track from the queue and automatically move it through planning, implementation, and review.
- **`no`** (or omitted): The track remains in the queue until a developer manually clicks run or dispatch in the UI, ensuring sensitive changes are never run unattended.
