# Track 1091: Manager Worker Type & New-Project Flow

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
**Type**: dev
**Summary**: A distinct 'manager' worker type that can act system-wide (create new projects) instead of being scoped to one project like every worker today.

## Problem

Every worker today belongs to exactly one project (`workers.project_id`) and
only ever acts within it. There's no way to create a *new* project from the
app — onboarding one today means a human manually running `lc setup` →
`setup scaffold` → `setup collection` in a terminal on that project's own
machine. There's no UX for it, and no worker capable of doing it, because
"do something before a project exists" doesn't fit the current
one-worker-belongs-to-one-project model at all.

## Solution

- `workers.type TEXT DEFAULT 'project'` — a new column, values `'project'`
  (today's normal worker, unchanged) or `'manager'`. Only `'manager'`-type
  workers poll/accept system-wide dispatch actions. This is a narrower trust
  tier than [1089](../1089-remote-worker-provisioning/index.md)'s
  `provision-worker` (which stays open to any pinned worker, since it's
  still scoped to an *existing* project) — `create-project` has no project
  to scope to yet, which is exactly why it needs its own tier.
- CLI: `lc worker start --manager` registers with `type: 'manager'` instead
  of the default `'project'` (alongside the existing `--sync-only`/
  `--worker-number` flags from [1084](../1084-worker-identity-and-assignment/index.md)).
- `create-project` dispatch action — reuses
  [1085](../1085-manual-worker-dispatch/index.md)'s `worker_dispatch` table
  and generic `payload` column (repo path/git URL + scaffold answers), only
  claimable by a `type: 'manager'` worker.
- **Scaffold generation is reused, not rebuilt**: `/laneconductor setup
  scaffold generate` already does the actual file-writing (`product.md`,
  `tech-stack.md`, `design-language.md`, etc.) from a context blob
  (`conductor/.setup-scaffold-context.json`). The new pieces are: (a)
  triggering it via dispatch instead of a human running it in a terminal,
  and (b) a UI wizard collecting the same answers the CLI's interactive
  brainstorm collects today, instead of a conversational prompt loop.
- A manager worker registers the new project + its first worker row once
  scaffolding completes (or hands off to 1089-style provisioning if the new
  project's repo lives on a different machine than the manager worker).

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md) — this track extends that design's dispatch mechanism (Section B) but was scoped and written up separately since it introduces a new worker trust tier, not just a new action type.

## Phases
- [ ] Phase 1: Schema — `workers.type` column, `create-project` dispatch validation (manager-only)
- [ ] Phase 2: CLI — `lc worker start --manager` flag
- [ ] Phase 3: Worker-side handler — run `/laneconductor setup scaffold generate` non-interactively from dispatched context, register the new project + first worker row
- [ ] Phase 4: UI — "New Project" wizard (repo path/git URL, scaffold Q&A as a form) dispatching to a manager worker
- [ ] Phase 5: Tests — manager-only claim enforcement, end-to-end new-project creation, non-manager worker correctly ignores `create-project` entries

## Depends on
[1085](../1085-manual-worker-dispatch/index.md) — reuses its dispatch inbox and generic `payload` column directly. [1084](../1084-worker-identity-and-assignment/index.md) — worker identity conventions (`--worker-number` pattern extends naturally to `--manager`).

## Open question
Whether the new-project UX should stay conversational (Q&A, mirroring the
CLI's interactive brainstorm) or be a form-style wizard collecting the same
answers upfront — not yet decided.
