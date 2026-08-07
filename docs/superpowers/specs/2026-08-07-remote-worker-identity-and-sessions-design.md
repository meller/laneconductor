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

Four connected pieces, in dependency order — each builds on the one before it:

- **A. Worker identity & assignment** — the foundation. Introduces per-user
  worker pinning and per-track assignment, so "which worker" becomes a concrete,
  resolvable answer instead of "whichever one polls first."
- **B. Manual dispatch** — a per-worker command inbox, so a specific worker can
  be told to run a specific action on a specific track regardless of its
  sync-only/sync+poll mode.
- **C. Persistent sessions** — one resumable Claude session per (worker, track),
  covering the *entire* track lifecycle (lane actions and conversation replies
  alike), so context is built once and reused instead of rebuilt every call.
- **D. Live run transcript** — a collapsible right-side panel that renders that
  session's event stream live, unifying "watching a run happen" and "the track's
  conversation" into one view, since after C they're the same underlying stream.

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
- `worker_pins (project_id, user_uid, worker_id)` — a project member's chosen
  worker for that project. One row per (project, user); settable/changeable
  anytime.
- `tracks.assignee_uid` — nullable. The project member responsible for this
  track. Defaults to the track's creator when unset.

**Claiming logic** (`autoLaunchLocalFs` and the API-mode claim path in
`conductor/laneconductor.sync.mjs`):
- A worker only auto-claims a `queue`-status track if the track's resolved
  assignee (explicit `assignee_uid`, or creator if unset, or project owner if
  creator unknown) is pinned to *that* worker via `worker_pins`.
- If the resolved assignee has no pin at all, fall back to today's open-claim
  behavior (any online worker for the project may claim it). This is the
  zero-config path for single-worker projects.

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
