# Spec: Manager Worker Type & New-Project Flow (Track 1091)

## Problem Statement

Onboarding a new project into LaneConductor requires a human to manually run
`lc setup` → `setup scaffold` → `setup collection` in a terminal, on the new
project's own machine. There's no app-level UX for it, and structurally no
worker can do it on your behalf, because every worker today is permanently
scoped to one `project_id` — there's no way for a worker to act on behalf of
a project that doesn't exist yet.

## Requirements

**REQ-1: Worker type**
- `ALTER TABLE workers ADD COLUMN type TEXT DEFAULT 'project'`. Valid
  values: `'project'` (default, unchanged behavior), `'manager'`.
- A `'manager'` worker is otherwise a completely normal worker (still has a
  `project_id`, still syncs/polls/dispatches like any other) — the *only*
  difference is it additionally polls for and can claim system-wide dispatch
  actions that a `'project'`-type worker ignores.

**REQ-2: CLI flag**
- `lc worker start --manager` — registers with `type: 'manager'` in
  `POST /worker/register`. Omitting the flag registers `type: 'project'`
  (default, backward compatible — existing workers/scripts unaffected).
- Combinable with existing flags (`--sync-only`, `--worker-number` from
  1084).

**REQ-3: `create-project` dispatch action**
- Reuses [1085](../1085-manual-worker-dispatch/index.md)'s `worker_dispatch`
  table: `action: 'create-project'`, `worker_id: <a manager worker>`,
  `track_number: null`, `payload: { repo_source: {type: 'path'|'git', value: string}, scaffold_context: {...} }`.
  `scaffold_context` mirrors `conductor/.setup-scaffold-context.json`'s
  existing shape (project name, scan signals, brainstorm_summary/answers).
- API validates `worker_id` refers to a `type: 'manager'` worker before
  enqueueing; rejects otherwise with a clear error.
- Worker-side dispatch loop: a `type: 'project'` worker never claims
  `create-project` entries even if somehow addressed to it (defense in
  depth alongside the API-level check).

**REQ-4: Scaffold execution (reused, not rebuilt)**
- On claiming a `create-project` entry, the manager worker:
  1. Resolves the repo location from `payload.repo_source` (existing local
     path, or clones from a git URL).
  2. Writes `conductor/.setup-scaffold-context.json` there from
     `payload.scaffold_context`.
  3. Runs `/laneconductor setup scaffold generate` against that location —
     the existing skill command, unmodified, already does the actual file
     generation (`product.md`, `tech-stack.md`, `design-language.md`,
     `workflow.md`, `kpis.md`, `user-stories.md`, `tracks/`,
     `code_styleguides/`, symlinks the skill).
  4. Registers the new project (`INSERT INTO projects`) and a first
     `workers` row for it — `type: 'project'` (the default), not
     `'manager'`: the worker that *did* the creating stays `'manager'`; the
     newly created project's own worker is a completely normal project
     worker going forward (or triggers 1089-style provisioning if
     `repo_source` indicates a different target machine than the manager
     worker's own).

**REQ-5: UI**
- "New Project" entry point (top-level, not inside an existing project) —
  collects: project name, repo source (existing path or git URL to clone),
  and the same scaffold questions the CLI's interactive brainstorm asks
  today (what it does, tech stack, KPIs, etc.) — form-style, exact
  interaction pattern (form vs. conversational) still open (see track's
  "Open question").
- Dispatches to a manager worker (picker, if more than one is available)
  and shows creation progress/result — reuses the dispatch-status UI
  pattern established in 1085/1089.

## Acceptance Criteria

- [ ] `workers.type` migration applied; existing workers default to `'project'`
- [ ] `lc worker start --manager` registers a worker with `type: 'manager'`
- [ ] A `create-project` dispatch is rejected by the API if the target
      worker isn't `type: 'manager'`
- [ ] A `type: 'project'` worker never claims a `create-project` entry even
      if one somehow exists addressed to it
- [ ] End-to-end: submitting the New Project UI flow results in a scaffolded
      project (all standard `conductor/` files present) and a registered
      `projects` + `workers` row, without any manual terminal command
- [ ] Existing single-worker, `lc setup`-based onboarding is completely
      unaffected (this is a new, additional path, not a replacement)
