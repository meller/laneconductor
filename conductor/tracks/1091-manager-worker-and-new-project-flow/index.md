# Track 1091: Manager Worker Type & New-Project Flow

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Quality gate PASSED — done. Both gaps found during review (TC-31 onboarding regression, TC-34 missing test) closed for real, not waived: git-history check + live evidence for TC-31, new 4/4-passing…
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
  `provision-worker` (which stays open to any of the developer's own
  workers, `workers.user_uid`, since it's still scoped to an *existing*
  project) — `create-project` has no project
  to scope to yet, which is exactly why it needs its own tier.
- **Multiplicity differs by type**: `'project'` workers keep 1084's model —
  multiple per project/folder. `'manager'` workers are a machine-level
  singleton — at most one per hostname, globally, enforced by a partial
  unique index — and `project_id` is nullable for them (a manager isn't
  "for" any one project). `lc worker start --manager` fails clearly if one's
  already running on that machine, rather than silently registering a
  second.
- CLI: `lc worker start --manager` registers with `type: 'manager'`,
  `project_id: null` (alongside the existing `--sync-only`/`--worker-number`
  flags from [1084](../1084-worker-identity-and-assignment/index.md), though
  `--worker-number` doesn't apply to managers — there's only ever one).
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
- [x] Phase 1: Schema — `workers.type` column, `create-project` dispatch validation (manager-only)
- [x] Phase 2: CLI — `lc worker start --manager` flag, `--projects-dir` config (spec.md REQ-2b, added mid-implementation)
- [x] Phase 3: Worker-side handler — run `/laneconductor setup scaffold generate` non-interactively from dispatched context, register the new project + first worker row
- [x] Phase 4: UI — "New Project" wizard (repo path/git URL, scaffold Q&A as a form) dispatching to a manager worker
- [x] Phase 5: Visual distinction for manager workers — distinct badge in `WorkersList.jsx` and 1087's `WorkerActivityLatch.jsx` (added 2026-08-10, during 1087's Phase 5/6 work; checklist corrected 2026-08-14 — code was already done, box just wasn't checked)
- [x] Phase 5b: Create Manager Worker button — `ProvisionWorkerModal.jsx`/`NewProjectModal.jsx`'s "no manager" dead-ends now have a real button (`POST /api/workers/manager/start`), gated non-cloud-mode, verified live (added 2026-08-14)
- [x] Phase 6: Tests — closed 2026-08-14: TC-31 (onboarding regression) confirmed via git-history check + live evidence; TC-34 (Phase 5b test coverage) closed with `track-1091-manager-start.test.mjs` (4/4 passing)

## Depends on
[1085](../1085-manual-worker-dispatch/index.md) — reuses its dispatch inbox and generic `payload` column directly. [1084](../1084-worker-identity-and-assignment/index.md) — worker identity conventions (`--worker-number` pattern extends naturally to `--manager`). [1087](../1087-live-session-transcript-panel/index.md) — Phase 5's badge work modifies `WorkerActivityLatch.jsx`, and Phase 4's UI dispatch view reuses 1087's non-track dispatch transcript (Phase 6 there) for `create-project` progress.

## Open question
~~Whether the new-project UX should stay conversational (Q&A, mirroring the
CLI's interactive brainstorm) or be a form-style wizard collecting the same
answers upfront — not yet decided.~~ **Resolved 2026-08-10: form-style.**
Dispatch is fire-and-poll (1085's model), not turn-by-turn — a
conversational flow would need new plumbing for a live back-and-forth with
the manager worker that doesn't exist today. A form collects the same
answers upfront into one `scaffold_context` blob and dispatches once on
submit, matching the existing pattern.
**Waiting for reply**: no
**Auto Run**: yes
**PR Number**: 16
**PR URL**: https://github.com/meller/laneconductor/pull/16
**PR Status**: conflicted
