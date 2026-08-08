# Remote Mode: Worker Identity, Manual Dispatch & Persistent Sessions

**Date:** 2026-08-07
**Status:** Approved design, pending implementation plan

## Problem

In remote mode (app + API connected), every worker registered to a project polls
the same shared queue and races to claim any track in `queue` status. There is no
concept of *which* worker should handle *which* track — pickup is effectively
random across a team's machines.

This causes three related gaps:

1. **No worker affinity.** Multiple developers, each running their own worker on
   their own machine, can't reliably say "this track is mine" — any online worker
   might grab it.
2. **No manual trigger in `sync-only` mode.** A worker in `sync-only` mode (see
   track 1042) does nothing but sync files/heartbeat — there's no way to tell one
   specific worker "run `implement` on track 1042 right now" without flipping it
   back to `sync+poll` and letting the race happen.
3. **No session continuity.** Every lane action (`plan`, `implement`, `review`,
   ...) and every conversation reply is an independent cold `claude -p` process
   with no session state. The skill re-reads `product.md`, `tech-stack.md`,
   `design-language.md`, and the track's `spec.md`/`plan.md`/`test.md`/
   `conversation.md` from scratch on *every single call*, including calls for the
   same track seconds apart. Any exploration Claude did during `plan` is thrown
   away by the time `implement` spawns as a new process.

This design addresses all three, plus a live-transcript UI need that falls out of
fixing #3: since work on a track becomes one continuous session, the UI should be
able to show that session happening live, not just a raw stdout tail.

## Approach

Seven connected pieces, in dependency order — each builds on the one before it:

- **A. Worker identity & assignment** — the foundation. Introduces per-user
  worker pinning (many workers per developer) and per-track assignment, so
  "which worker" becomes a concrete, resolvable answer instead of "whichever
  one polls first," with continuity-first routing enabling real parallelism.
- **B. Manual dispatch** — a per-worker command inbox, so a specific worker can
  be told to run a specific action on a specific track regardless of its
  sync-only/sync+poll mode.
- **C. Persistent sessions** — one resumable Claude session per (worker, track),
  covering the *entire* track lifecycle (lane actions and conversation replies
  alike), so context is built once and reused instead of rebuilt every call.
- **D. Live run transcript** — a collapsible right-side panel that renders that
  session's event stream live, unifying "watching a run happen" and "the track's
  conversation" into one view, since after C they're the same underlying stream.
- **E. Deploy as a dispatchable action** — extends B so the full cycle actually
  ends in a deploy, triggerable from the app via a worker that already has the
  repo, not just from a human's terminal.
- **F. Remote worker provisioning** — extends B again: activating a worker on a
  machine you already control, from the app, delegated through an existing
  worker rather than the API server holding SSH credentials itself.
- **G. Manager worker type & new-project flow** — extends B once more: a
  narrow worker trust tier (`type: 'manager'`) for system-wide actions that
  have no project to scope to yet, starting with creating new projects from
  the app instead of a human running `lc setup` in a terminal.

Rejected alternatives considered and why:

- **Per-track/per-lane worker routing** (finer than per-user pinning) — more
  powerful but not needed yet; per-user pinning with explicit per-track
  reassignment already covers the "route work to a specific machine" need
  without a second routing dimension to design and surface in UI.
- **Unassigned tracks stay an open pool** — rejected in favor of defaulting the
  assignee to the track's creator/project owner, so single-worker projects need
  zero configuration and keep behaving exactly as they do today.
- **Reuse the general queue with a `target_worker_id` column** (for dispatch,
  instead of a separate inbox) — rejected because `sync-only` workers
  deliberately don't poll the general queue at all; a separate per-worker inbox
  keeps that boundary clean instead of adding a special-case exception to queue
  polling.
- **Freeform custom-prompt dispatch** — rejected for v1; dispatch is scoped to
  the same standard lane actions auto-launch already knows how to run, keeping
  this "manual trigger of automation," not a general remote-shell feature.
- **Session-per-conversation, separate from session-per-lane-action** — rejected
  once it became clear both problems (stale conversation context, and
  plan→implement→review re-deriving context) have the same root cause and the
  same fix: one session per (worker, track) used for every call against that
  track.

## A. Worker Identity & Assignment

**Schema:**
- `worker_pins (project_id, user_uid, worker_id)` — a developer can pin
  *multiple* workers to one project, not just one. This is what allows a
  single developer to run plan and implement in parallel across different
  machines instead of serializing everything through one pinned worker.
- `tracks.assignee_uid` — nullable. The *developer* responsible for this
  track (not a specific machine). Defaults to the track's creator when
  unset. There is deliberately no separate "which worker" field on the
  track — that's resolved dynamically (below), using session continuity
  from Section C.

**Claiming logic** (`autoLaunchLocalFs` and the API-mode claim path in
`conductor/laneconductor.sync.mjs`), continuity-first routing:
- Resolve the track's assignee (explicit `assignee_uid`, or creator if
  unset, or project owner if creator unknown), then resolve all of that
  assignee's pinned workers via `worker_pins` — zero, one, or several.
- **Continuity check:** if `track_sessions` (Section C) already has a row
  for this track on one of those candidate workers, only that worker may
  claim it — it already holds the session/context.
- **No prior session:** any idle candidate worker may claim it
  (first-idle-wins among the assignee's pinned workers). This is what
  enables parallel work: two tracks assigned to the same developer, neither
  with a session yet, can land on two different idle workers at once.
- If the assignee has no pin at all, fall back to today's open-claim
  behavior (any online worker for the project may claim it) — the
  zero-config path for single-worker projects.

This creates a soft two-way dependency between Sections A and C: A's
continuity check reads C's `track_sessions` table, so that specific piece of
A's claim logic can't land until C's schema exists, even though the rest of
A (pinning, assignment, UI) doesn't need C at all.

**UI:** track card/detail panel gets an "Assignee" control (defaults to
creator, reassignable to any project member), showing the resolved worker and
its live status (idle/busy/offline) next to the name. Workers list gets a
"Pin as mine" action per project.

**Failure mode:** assignee's pinned worker is offline — track sits visibly in
`queue` (not silently stuck) until the worker reconnects or someone reassigns
it.

## B. Manual Dispatch

**Schema:** `worker_dispatch (id, worker_id, track_number, action, status,
created_at)` — a per-worker command inbox, separate from the general
auto-launch queue.

**Worker loop:** on every sync tick (same interval as heartbeat, ~10s),
regardless of `sync-only`/`sync+poll` mode, the worker checks
`worker_dispatch WHERE worker_id = me AND status = 'pending'`. A match runs
immediately through the same `spawnCli` path auto-launch uses, then marks the
row `claimed`/`done`. In `sync-only` mode, this inbox check plus file sync is
the *only* work-launching activity — the general queue is still never
touched.

**UI:** track detail panel gets `Run on worker: [assignee's worker ▾]
[action ▾] [Run Now]`, scoped to actions valid for the track's current lane
(the same set auto-launch already offers). Works in any worker mode.

## C. Persistent Sessions

**Schema:** `track_sessions (track_number, worker_id, claude_session_id,
created_at, last_used_at)` — one row per (worker, track) pair.

**Mechanism:** the first time a worker acts on a track (any lane action, or a
conversation reply), `spawnCli`/`buildCliArgs` generates a UUID, passes
`--session-id <uuid>` to `claude -p`, and stores it. Every subsequent
invocation for that same (worker, track) — a later lane transition, or the
next conversation reply — passes `--resume <uuid>` instead of a fresh
`--session-id`.

**SKILL.md impact:** the "load all context" steps (read
`product.md`/`tech-stack.md`/`design-language.md`/`spec.md`/`plan.md`/
`conversation.md`) only need to run on the *first* call for a given (worker,
track) pair. On a resumed session the prompt is just the delta — "now
implement the plan you just wrote," or the user's new message — since Claude
already has everything loaded from earlier in the session. `buildCliArgs`
chooses which prompt shape to build based on whether `track_sessions` already
has a row for this (worker, track).

**Resilience:**
- Claude's local session store lives on the worker's machine and isn't
  portable. If a track is reassigned to a different worker (Section A), that
  worker has no session row and naturally cold-starts — correct behavior, not
  a bug.
- If `--resume` fails (session pruned/corrupted on disk), fall back to a
  cold-start "load all context" call and mint a fresh session. No manual reset
  UI needed for v1.

**`conversation.md` after this change:** the session transcript becomes the
live source of truth for a track's conversation (see Section D), but the
worker still appends a human-readable entry to `conversation.md` *after* each
session turn completes, derived from that turn's content — not by re-reading
the file cold before every call, which is the part that goes away. This keeps
`conversation.md` git-diffable and readable offline/without DB access, as it
is today.

## D. Live Run Transcript

**Worker side:** for `cli === 'claude'` spawns, add `--output-format
stream-json --include-partial-messages`. (Other CLIs — gemini, antigravity —
don't support this and keep today's plain-text log tailing as a fallback.)
Stdout is still written to the existing log file in `conductor/logs/`
(unchanged as the persisted, git-independent audit trail), but each line is
now a structured JSON event: assistant text deltas, tool-use calls, tool
results.

**Transport:** reuse the existing WebSocket (`ui/src/hooks/useWebSocket.js`)
rather than build new plumbing. As the worker parses new JSONL lines from the
log file, it pushes each event to the collector API (replacing today's 5s raw
`last_log_tail` PATCH with more frequent structured pushes), and the API
relays it over the existing WS channel to any UI client currently watching
that track. No new persistence layer — the JSONL log file remains the source
of truth; on load, the UI fetches and parses the full log to reconstruct
history, then the WS feed carries live continuation.

**UI:** a collapsible panel on the right side of the track detail view,
auto-expanding when a run starts on the track currently being viewed (lane
action, manual dispatch, or a chat/conversation turn — all the same
underlying session per Section C) and collapsible manually. It renders the
event stream as a continuous transcript — assistant text as chat-style
blocks, tool calls as collapsible "Used tool: Read(spec.md)" entries — rather
than a raw `<pre>` dump. This applies uniformly across auto-launched runs,
manually-dispatched runs, and worker chat sessions, because after Section C
there is exactly one kind of event stream, not several.

Given C and D together, the track's "conversation" and "live run log" stop
being two separate UI concepts fed by two separate mechanisms — both are
views onto the same per-(worker, track) session.

**Cross-worker activity view:** because Section A lets one developer pin
multiple workers, several can be running different tracks in parallel with
no way today to monitor them at a glance. The Workers list gets a live,
truncated current-activity snippet per worker (last tool call or assistant
text fragment), sourced from the same event stream as the per-track drawer
— not a full transcript, just enough situational awareness across parallel
runs. Clicking a worker's snippet opens that track's full drawer.

## E. Deploy as a Dispatchable Action (extends Section B)

Closing the loop on the full `plan → implement → review → quality-gate →
done` cycle means it should actually end in a deploy, not just a `done`
status. Today `lc deploy <env>` only runs from whoever's terminal has the
repo checked out — there's no app-level UX for it at all.

Rather than a separate deploy-triggering mechanism, this reuses Section B's
dispatch inbox directly: `action: 'deploy'` with `track_number: null`
(deploy is project-level, not tied to one track's lane) and a `payload`
field (`{"environment": "prod"}`). This is also the reason Section B's
`worker_dispatch` schema uses a generic `payload JSONB` column rather than a
dedicated `environment` column — it's the first of at least two action
types (deploy, and Section F's worker provisioning) that need their own
parameters, and a generic payload avoids a schema migration per action type.

The worker-side handler extracts the existing `lc deploy` execution logic
from `bin/lc.mjs` into a shared function both the CLI and the worker call,
so the two paths run identical deploy.json execution rather than duplicate
implementations. UI: a project-level `Deploy: [worker ▾] [environment ▾]
[Deploy Now]` control (Workers list or a project actions panel), not on a
track detail panel, since deploy isn't scoped to any one track.

## F. Remote Worker Provisioning (also extends Section B)

**Problem:** every worker today has to be started manually via `lc worker
start` on whatever machine it runs on. There's no way to say "start a new
worker on that other machine" from the app itself — the closest analog to
how Claude Code/Antigravity let you open a new agent session with one
click.

**Scoped-down approach:** not actual cloud compute provisioning (spinning up
new VMs/containers) — that's a materially bigger, different feature
(cloud account, billing, image/container build, security hardening) and
explicitly out of scope here. This is about activating a worker on a
machine the user already controls and already has LaneConductor installed
on, remotely, via a machine they can already control.

**Data model:** new table `provision_targets (id, project_id, user_uid,
host, label, created_at)` — a lightweight registry of "machines I could
start a worker on," distinct from `workers` (which only exist once a
worker has actually registered by running). This is separate from Section
A's `worker_pins`, which pins *existing* workers.

**Mechanism — delegated, not direct:** the Collector API can't SSH anywhere
itself (that would mean it holding its own SSH credentials, a new and more
sensitive responsibility for what's otherwise just a REST API + DB layer).
Instead, this reuses Section B/E's dispatch inbox again: a `provision-worker`
action, sent to an already-running *launcher* worker that has SSH access
configured to reach the target host (via that worker's own `~/.ssh`
config/agent — no new credential storage anywhere in this design). This
means bootstrapping requires at least one worker already running to launch
the rest from — acceptable, since that's already the state of any project
using this feature.

**UI:** Workers list gets `+ New Worker` → pick a target host (from
`provision_targets`, or add a new one) + pick a launcher worker (one of the
user's already-pinned, online workers) → `Provision`. Creates a
`worker_dispatch` row: `action: 'provision-worker'`, `worker_id: <launcher>`,
`payload: {"target_host": ..., "worker_number": <next available>}`
(depends on Section A's `--worker-number` stable identity — provisioning
needs to assign the new worker a distinct slot).

**Explicitly deferred (FFU) in this pass:** the actual SSH execution. The
launcher worker's handler for `provision-worker` is a stub: it logs
`"[provision-worker] SSH execution not yet implemented — target: <host>,
would run: lc worker start --worker-number <n>"` and marks the dispatch
`failed` with that message, visible in the UI. Everything else —
the registry, the UI flow, the dispatch entry shape — is built for real in
this pass; only the last step (actually SSHing and running the remote
command) is deferred to a follow-up.

## G. Manager Worker Type & New-Project Flow (also extends Section B)

**Problem:** every worker so far (Sections A-F) belongs to exactly one
project. There's no way to create a *new* project from the app — onboarding
one today means a human running `lc setup` → `setup scaffold` → `setup
collection` manually in a terminal. Nothing in the design so far can act
"before a project exists," because the whole worker model assumes one
already does.

**Worker type, not a special worker kind:** `workers.type` (`'project'`
default, `'manager'`). A manager worker is otherwise completely normal —
still has a `project_id`, still syncs/dispatches like any other — the only
difference is it additionally polls for and can claim system-wide dispatch
actions a project-type worker ignores. `lc worker start --manager` sets it.
This is a narrower trust tier than Section F's `provision-worker` (open to
any pinned worker, since it still acts within an *existing* project) —
`create-project` has no project to scope permission to yet, which is
exactly why it needs its own tier.

**`create-project` dispatch, reusing Section B again:** `worker_dispatch`
with `action: 'create-project'`, `track_number: null`,
`payload: {repo_source, scaffold_context}`, claimable only by a manager
worker (API-enforced, plus defense-in-depth at the worker's own dispatch
loop). The scaffold generation itself is **not new work** —
`/laneconductor setup scaffold generate` already writes `product.md`/
`tech-stack.md`/etc. from a context blob; this just triggers it via
dispatch instead of a human running it in a terminal, fed by a UI wizard
instead of the CLI's interactive brainstorm. The manager worker then
registers the new project and its first worker row (`type: 'project'`,
default — the *creating* worker stays `'manager'`, the *created* project's
worker is a normal one).

**Ripple effect on Section D:** `deploy` (Section E) and `create-project`
both dispatch with no associated track, so Section D's transcript panel
(originally track-only) generalizes to key its live transcript on
`worker_dispatch.id` instead of `track_number` for these, reusing the same
renderer in a standalone view rather than a track's drawer.

## Out of scope for this design

- Track-agnostic ("chat with a worker, not tied to any track") sessions were
  discussed and explicitly folded into the per-track model instead — every
  session in this design is scoped to a track. A track-agnostic worker chat
  remains a plausible future extension but is not designed here.
- Automatic session invalidation when `product.md`/`tech-stack.md`/etc. change
  significantly — not handled in v1. The resume/fallback behavior in Section C
  is the only staleness handling; if this proves insufficient in practice, a
  manual "reset session" action is the likely follow-up, not built now.
- Finer-than-per-user worker routing (e.g. per-lane routing to different
  machines) — rejected above; not designed here.
- Freeform custom-prompt dispatch — rejected above; not designed here.
