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
| quality-gate | done:success | plan:queue   |

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
