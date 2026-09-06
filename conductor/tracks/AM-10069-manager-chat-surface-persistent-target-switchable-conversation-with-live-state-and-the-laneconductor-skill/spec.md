# Spec: Manager chat surface — persistent, target-switchable conversation with live state and the /laneconductor skill

## Problem Statement

There is no persistent surface for "what is any target doing right now, and can I steer
it." What exists is three partial answers, none of which is the thing:

| Surface | What it gives | What it can't do |
|---|---|---|
| `TrackDetailPanel` Conversation/Logs tabs | one track's comments + transcript | per-track, modal, not a place you sit |
| `WorkerChatPanel` (track 10037) | one worker's transcript + composer | modal, resolves to a *track*, hard-disabled for managers |
| `WorkerActivityLatch` (track 1087) | worker list + selected worker's transcript | same track-scoped resolver, same manager hole |

And the manager is excluded from all three by one line: `workerTaskInfo.js:34` —
`if (!worker || worker.type === 'manager') return null;` — with
`WorkerChatPanel.jsx:85` disabling the composer on the same condition.

The deeper gap is what a chat turn *is* today. `worker_adhoc_chat` / `track_chat`
(`laneconductor.sync.mjs:8550`) run the CLI with plain `--print` text, deliberately not
`buildClaudeArgs`, with the reasoning written into the code: stream-json "raw JSONL is
unreadable as a chat reply." The consequence is that a chat turn produces **no transcript,
no tool visibility, no token or timing data, and no session events** — the exact opposite
of what this track needs. A chat that can actually run commands and be watched doing it is
not an upgrade to that handler; it is a different execution path.

### What already exists (verified live against this checkout, 2026-09-06)

This matters because it changes the size of the build substantially — most of the hard
parts are present and unwired.

| Fact | Evidence |
|---|---|
| A **skill-loaded, tool-enabled, resumable, streamed** agent turn already exists as a first-class path | `CONVERSATION_REPLY_ACTION` / `label = 'local-fs-answer'` (`laneconductor.sync.mjs:6874`), spawned through `spawnCli` → `buildCliArgs` → `buildClaudeArgs` |
| That path injects the skill | `buildCliArgs`: `` const contextMsg = `Use the /${skill} skill. Skill definition is at: ${skillPath}. ` `` |
| It bypasses the git lock and worktree | `const isConversationRun = action === CONVERSATION_REPLY_ACTION;` then `workspaceMode = isConversationRun ? null : resolveWorkspaceMode(...)` (`:5045`) |
| It resumes the same session | `resolveTrackSession` → `--resume`, bounded by track 10047's cap |
| Every stream-json event is already pushed to the browser, **unfiltered** | worker polls the log every 500ms → `notifyApi('session:event', …)` (`:5532`) → `POST /internal/sync-event` → `broadcast` (`ui/server/index.mjs:175`) |
| The browser then **discards** most of them | `streamTranscript.js`'s reducer handles `assistant` and `user` only; its own comment says "system/stream_event/result/rate_limit_event/etc — not rendered" |
| A dispatched CLI has **no stdin at all** | `spawn(command, args, { detached: true, stdio: ['ignore', out, out], … })` (`:5461`) |
| A reply is already deferred while a run is live | `isRunMarkerLive` → "deferring conversation-reply dispatch — a run is already live for this track" (`:6866`) |

**Live sample of one real run's log** (`conductor/logs/dispatch-plan-10069-*.log`, 862
events), which settles the open question in scope item 7 about which event types carry
token and timing data:

| Event | Carries |
|---|---|
| `assistant` | `timestamp`, `message.usage.{input,output,cache_read,cache_creation}_tokens` |
| `stream_event` / `message_delta` | `usage.output_tokens` (running, per message) |
| `stream_event` / `content_block_start` | `content_block.type` and, for tool calls, `.name` — available *before* the block completes |
| `system` / `status` | the CLI's own status line, e.g. `{"status":"requesting"}` |
| `system` / `thinking_tokens` | `estimated_tokens`, `estimated_tokens_delta` |
| `system` / `init` | `session_id`, `model`, `tools`, `skills`, `cwd` |

So item 7 needs **no new instrumentation anywhere** — not in the CLI invocation, not in
the worker, not on the wire. It is a client-side reducer extension over data that is
already arriving and being thrown away.

## Solution

One persistent top-level **Chat** view, with a target switcher. Two target tiers, one
surface, one renderer.

- **Manager target (default)** — a full `/laneconductor`-skill session against the
  supervision pseudo-track track 10067 provides (a directory — everything interactive on top
  of it is built here, D7). Free-form input, real tool access, live
  transcript with tool calls, on-demand instance state, and a conditional setup wizard.
- **Worker target** — the track-scoped conversation and transcript `WorkerChatPanel`
  already resolves (10037's `resolveWorkerChatTarget`), rendered in the same persistent
  pane instead of a modal.

Plus the two things that make either tier usable: honest queued-intervention semantics,
and the live-turn affordances (elapsed, tokens, changing status) on **any** target's turn.

And, since the boundary with track 10067 was revised on 2026-09-06 (D7), the chat plumbing
underneath the manager tier: the chat-target resolver returning a manager target instead of
`null`, the composer enabled for it, a filesystem-backed conversation adapter for a
pseudo-track that has no `tracks` row, the reply-pickup trigger (D8), and the worker-side
skip that stops `syncConversation` mis-parsing the reserved folder name as a track number.

## Decisions

### D1 — Intervention model: **(3a) queued intervention. (3b) is out of scope, and not for cost reasons**

A message sent while the target is mid-turn is **queued**, lands in `conversation.md`, and
is picked up at the target's next turn — with the UI saying exactly that, not pretending
it landed.

This is not a preference. A dispatched CLI is spawned with `stdio: ['ignore', out, out]`
(`:5461`): the child has **no stdin file descriptor**. There is no channel to inject into,
so (3b) is not "harder", it is *absent*. Delivering it would mean piping stdin, adopting
`--input-format stream-json`, keeping a writable handle per live run keyed by run marker,
and reworking the deferral at `:6866` that currently exists precisely to prevent two
concurrent sessions on one track (track AM-10046's whole subject). That is its own track.

What v1 owes the user instead is honesty: a message sent during a live turn shows as
**queued**, with what it is waiting on, and flips to sent when the turn ends. A silent
"Send" that appears to work and does nothing for four minutes is the actual defect here.

### D2 — Chat execution: **route through `spawnCli`'s conversation-reply path; do not extend the `--print` chat handler**

Scope items 2 (tool output visible as it happens), 6 (real tool access, skill loaded) and
7 (live affordances) are all properties the `local-fs-answer` path already has and the
`track_chat` handler structurally cannot have. Upgrading `track_chat` to stream-json would
mean re-deriving session resume, transcript log naming, run markers, and event push —
four mechanisms that exist and work — and would break the thing that handler is good at
(returning a short text reply into `worker_dispatch.result` for the Activity panel).

So: **a chat message is a comment.** The composer posts to
`POST /api/projects/:id/tracks/:num/comments` exactly as `TrackChatComposer` does today;
the worker picks it up and answers with a real session. `track_chat` is left untouched and
keeps serving the Activity panel's quick-question bar.

### D3 — Live state: **a digest in the prompt, the full snapshot on demand**

Rejected: dumping board state into every turn. A single project's `index.md` set is
already tens of KB, and most of it is irrelevant to any given question.

Rejected: state only on demand, with nothing in the prompt. The session would not know
what it does not know, so it would either never look or look every turn.

Adopted: a **state digest** — one compact header block (counts per lane, worker
up/down counts, open gap ids, ~200 tokens, deterministic, no LLM) injected on the turn
that opens a session, plus a line telling the session that `lc state --json` returns the
full snapshot whenever it needs detail. The session already has tool access, so this costs
nothing to grant and is paid for only when actually used.

`lc state --json` is new but thin: it is the same read `lc status` already performs,
serialized instead of drawn, plus worker rows and D4's gaps.

### D4 — "Genuinely incomplete setup": **a deterministic, server-computed gap list — never an LLM judgement**

The wizard message must not cost a turn to decide not to show. So the gate is a pure
function, `conductor/services/setup-gaps.mjs`, over facts already available:

| Gap id | Condition | Severity |
|---|---|---|
| `no-projects` | zero rows in `projects` | blocking |
| `no-workers` | project has no worker row with a heartbeat inside the staleness window | blocking |
| `no-manager` | no `type: 'manager'` worker on this machine | advisory |
| `no-provider` | `project.primary.cli` unset, or unreachable per `provider_status` | blocking |
| `no-conductor-context` | `conductor/product.md` or `tech-stack.md` missing or still template-stubbed | advisory |
| `no-quality-gate` | `create_quality_gate` true but `conductor/quality-gate.md` absent | advisory |
| `no-tracks` | project has zero tracks | advisory |

**The wizard opens only when at least one `blocking` gap is present.** Advisory gaps are
listed inside the pane's header, never as an unprompted opening message. A fully
configured returning user gets an empty gap list, no wizard, and no dispatched turn —
which is the whole point of computing this outside the model.

### D5 — Worker targets stay simpler than the manager target, deliberately

The manager target gets the skill session, state digest and wizard. A **worker** target
gets the existing track-scoped conversation and transcript, moved into the persistent
pane. Reason: a worker is already *doing* a track; the useful question is "what are you
doing on track N", which the existing resolver answers correctly. Giving every worker its
own free-roaming skill session would create N concurrent agent sessions competing for the
same git locks — the failure class track AM-10046 exists to prevent.

A worker target's composer therefore posts into that worker's resolved track conversation,
unchanged from 10037. The **live-turn affordances (D6) apply to both tiers** — they are a
property of the renderer, not the target.

### D6 — Live-turn affordances are a client-side reducer extension, nothing more

Per the table in the Problem Statement, every field item 7 asks for already arrives over
the existing WS `session:event` channel and is dropped by `reduceStreamEvent`. So the work
is: extend the reducer to also carry a `turn` object alongside `blocks`, and render it.
No worker change, no CLI-invocation change, no new endpoint, no new event type.

Consequence worth stating: this improves **every** existing transcript surface
(`TrackDetailPanel`, `WorkerActivityLatch`, `WorkerChatPanel`) at once, because they all
already share `useTrackTranscript` and `streamTranscript.js`.

### D7 — Revised dependency boundary (changed 2026-09-06, commit `aa5e0958`)

The split with track 10067 was rewritten by hand after this track's first planning pass, and
the change is not cosmetic — it moves roughly a phase of work into this track. 10067 now
ships **visibility only**.

Every REQ number in the table below is **10067's**, not this track's — this track's own
numbering for the moved-in work is REQ-25..REQ-31.

| Consumed from 10067 (unchanged) | Built here (previously assumed from 10067) |
|---|---|
| REQ-14 — `conductor/tracks/manager/` exists per supervised project, with `index.md` and `conversation.md` | REQ-15 — `resolveWorkerChatTarget()` returning a manager target |
| REQ-21 — the reserved folder name contains no digit in any position | REQ-16 — the composer enabled for a manager worker |
| REQ-17 — the live transcript path working for a supervision session, with no new renderer | REQ-18 — a human reply in that conversation being picked up |
| | REQ-22 — the comments routes' filesystem-backed reserved-name branch |
| | REQ-23 — the worker's `syncConversation` skipping the pseudo-track |

The reason recorded on both tracks: this track has to build resolver and composer-enabling
logic for every target type it supports anyway, so a manager-specific slice of the same
logic in 10067 risked two different answers to "how does chat find its target."

**What survives from 10067's planning and is reused rather than re-derived** — its D5 and
D7, each re-verified against this checkout on 2026-09-06:

- The pseudo-track is addressed as track number `manager` and is invisible to claiming, to
  `tracks.md`, and to the auto-launch scan because every folder consumer requires a digit —
  `isTrackDirName` is `/\d+/.test(name) && !name.startsWith('_duplicate-')`
  (`laneconductor.sync.mjs:1748`). The reserved name must therefore contain no digit
  *anywhere*, not merely lack a numeric prefix.
- Giving it a real `tracks` row was considered and rejected: every route would work for
  free, but it puts a card on every project's board, which then needs a new exclusion in the
  tracks-list query — the exact cost this design avoids, traded for one branch in two routes.
- `GET /comments` 404s for it (`getTrackId` → `SELECT id FROM tracks`, `ui/server/index.mjs:1604`);
  `POST /comments` writes through `collectorWrite` to a row that does not exist; and the
  worker's `syncConversation` is worse than not running, because `extractTrackNumber`'s
  fallback is `?? trackDir` (`:2090`), so it returns the literal string `manager` and POSTs
  every turn to a nonexistent track.
- A manager's worker row has `project_id: null` and the workers API deliberately returns the
  manager in every project's worker list, so a manager chat target resolves to the project
  whose board the user is currently viewing — `resolveWorkerChatTarget`'s existing
  `fallbackProjectId` argument, no new mechanism.
- `parseConversationComments()` (`conductor/sync-conversation-utils.mjs:13`) is already a
  pure exported parser producing the shape `useTrackComments` renders, so the filesystem
  adapter is a mapping, not a new parser.

**Residual dependency, now genuinely thin.** All this track needs from merged 10067 is a
directory containing two files. Everything in Phase 4 is built and tested against a fixture
folder (REQ-31); only the end-to-end verification in Phase 8 needs the real one. This
removes the blocking risk the first planning pass flagged.

### D8 — Reply pickup on the pseudo-track: a reserved-name allowance in the existing claim scan, gated to conversation replies only

This is the mechanism D7 previously deferred to 10067 as a shared contract. It is now this
track's to choose, and one finding decides it.

**Launch decisions are filesystem-based in every mode, not only local-fs.** At
`laneconductor.sync.mjs:9202`, API mode pulls the workflow and the claimable set from the
collector and then calls the same `autoLaunchLocalFs()` that local-fs mode uses — the
comment there states it outright: "DB is used only for heartbeats and UI sync, not for
concurrency control." So a `**Waiting for reply**: yes` marker in a folder's own `index.md`
is read from disk in every mode. 10067's D7 assumed that flag needed a DB row to carry it,
which is why it leaned toward a manager-owned file poll; it does not.

The pseudo-track is excluded by exactly two guards, both cheap and both explicit: the `dirs`
filter's `isTrackDirName` (no digit → excluded), and
`const trackNumMatch = dir.match(/(\d+)/); if (!trackNumMatch) continue;` at `:6642`.

**Decision: admit the reserved name past both guards only when `**Waiting for reply**: yes`
is set, and force the action to `CONVERSATION_REPLY_ACTION`.** It is never eligible for a
lane action, never claimable from the open queue, and never receives a lane transition.

Everything else then comes for free, and each item is a mechanism this track would otherwise
have to re-derive: the conversation-reply path already bypasses the git lock and the
worktree (`isConversationRun` → `workspaceMode = null`, which is independently 10067's D8
conclusion), resumes the same session, names its log the way the transcript endpoint
expects, writes a run marker, pushes `session:event` to the browser, defers while a run is
live (`:6866`), and refuses to fire when the last human turn was already answered
(`hasGenuineUnansweredHumanComment`, `:6846`).

Rejected — **a poll inside the manager's own sweep loop** (10067's D7 leaning, "the manager
reading the file it owns"). Two problems. It puts the reply path back inside 10067's Phase 3
loop, re-coupling the two tracks the revised split just separated. And it makes chat
unavailable exactly when it is most wanted: a dead or missing manager is the thing a user
opens this pane to ask about. Any non-sync-only worker being able to answer is strictly
better.

Who sets the marker: the POST comments reserved-name branch (REQ-27), as it appends the
turn, since there is no DB row to carry it. The conversation-reply exit handler already
clears it on completion (`:6033`).

**One consequence, stated rather than discovered later.** `track_sessions` is keyed
`PRIMARY KEY (track_number, worker_id)` (`migrations/20260809103807_add_track_sessions.sql`),
so session continuity on the manager thread is per worker. On the normal single-worker
instance, consecutive manager messages resume one session — AC-6 as written. On an instance
with several non-sync-only workers, a second message answered by a *different* worker
cold-starts, because there is no warm session for that pair. That is acceptable, and it is
precisely what REQ-8's continuity notice exists to surface: the pane says the session
restarted instead of the user inferring it from an answer that forgot the last turn. Pinning
the manager thread to one worker was considered and rejected for the same reason the poll
was — it reintroduces a single point of failure into the one surface a user opens when
things are broken.

## Requirements

**Persistent surface (scope 1)**
- REQ-1: A top-level **Chat** nav item sits alongside Projects / Lanes / Workers / CI/CD,
  and is reachable in All-Projects mode as well as with a project selected.
- REQ-2: The view persists its selected target and does not reset it on an unrelated
  re-render or a board refresh.
- REQ-3: The default target is the manager. A target switcher lists every registered
  worker visible to the user, plus the manager, with live status per row.
- REQ-4: Selecting a target swaps the transcript and the composer to that target with no
  full-page navigation and no loss of the other target's scroll position on return.

**Free-form, tool-visible interaction (scopes 2, 6)**
- REQ-5: The composer accepts arbitrary text. Canned actions, if any, are shortcuts that
  fill the composer, never the only way to interact.
- REQ-6: A manager-target message produces a real `/laneconductor`-skill session via the
  existing `spawnCli` conversation-reply path (D2) — not the `--print` `track_chat`
  handler, which is left untouched.
- REQ-7: That session's tool calls (name, input summary, result, error state) are visible
  in the pane as they happen, through the existing `TranscriptView`.
- REQ-8: Session continuity holds across messages to the same target, subject to track
  10047's existing context cap. A capped/reset session is stated in the pane, not silent.

**Intervention (scope 3)**
- REQ-9: Sending to a target with a live run marker queues the message and the UI shows it
  as **queued**, naming what it is waiting on.
- REQ-10: A queued message transitions to sent/answered when the live turn ends and the
  reply turn picks it up, with no further user action.
- REQ-11: Mid-stream injection into a running CLI is explicitly out of scope (D1) and the
  UI never implies otherwise.

**Live state awareness (scope 4)**
- REQ-12: `conductor/services/instance-state.mjs` is a pure module producing an instance
  snapshot (projects, per-lane track counts, workers with health, provider status, gaps)
  from injected I/O.
- REQ-13: `lc state --json` prints that snapshot; `GET /api/state` serves it to the UI.
- REQ-14: A manager session's opening turn carries the compact digest (D3), bounded to a
  stated token budget, and is told how to fetch the full snapshot on demand.
- REQ-15: The digest is **not** re-injected on a resumed turn — same rule the existing
  chat and lane-action paths already apply to track context.

**Conditional wizard (scope 5)**
- REQ-16: `conductor/services/setup-gaps.mjs` is a pure module computing D4's gap list.
- REQ-17: The wizard opening message appears only when at least one **blocking** gap is
  present, and never fires a model turn to decide that.
- REQ-18: With zero blocking gaps, opening the pane dispatches nothing and shows no
  wizard — verified by asserting no dispatch row and no spawned process.
- REQ-19: The wizard's message names the specific gaps found and offers the concrete next
  action for each.

**Live-turn affordances (scope 7)**
- REQ-20: `reduceStreamEvent` additionally derives, without dropping or reordering
  existing block behaviour: turn-active state, first/last event timestamps, cumulative
  output tokens, context tokens, and a current-activity label.
- REQ-21: The activity label changes through a turn, driven by real events —
  `system/status`, `system/thinking_tokens`, and `content_block_start` for tool calls
  (naming the tool) — never a single static "Running".
- REQ-22: The pane shows an elapsed timer that updates while a turn is live and freezes at
  the final value when it ends.
- REQ-23: A running token count is shown and updates during the turn.
- REQ-24: Affordances apply to any target's live turn, manager or worker (D5), and
  degrade to nothing rendered for a non-Claude CLI run that emits no stream-json.

**Manager chat plumbing (moved in from 10067 — D7, D8)**
- REQ-25: `resolveWorkerChatTarget()` returns a usable target for `type === 'manager'`,
  resolving to the reserved track number `manager` in the project whose board is being
  viewed (`fallbackProjectId`), instead of `null` (`ui/src/lib/workerTaskInfo.js:33`).
- REQ-26: `WorkerChatPanel`'s composer is enabled for a manager target, replacing the
  `disabled={isManager || !target}` gate and the "Managers are transcript-only" hint.
- REQ-27: `GET` and `POST /api/projects/:id/tracks/:num/comments` serve the reserved name
  from the filesystem — reading and appending
  `<repo_path>/conductor/tracks/manager/conversation.md` via `parseConversationComments()`,
  bypassing `getTrackId` and `collectorWrite` entirely. The POST branch additionally sets
  `**Waiting for reply**: yes` in that folder's `index.md`, since no DB row can carry it.
- REQ-28: `autoLaunchLocalFs` admits the reserved pseudo-track past its two digit guards
  **only** when that marker is set, dispatches it as `CONVERSATION_REPLY_ACTION`, and never
  as a lane action or an open-queue claim.
- REQ-29: The worker's `syncConversation` skips the reserved pseudo-track by name, without
  changing `extractTrackNumber`'s shared fallback — that fallback has callers well outside
  this track.
- REQ-30: None of this makes the pseudo-track visible to the board: no Kanban card, no
  `tracks.md` entry, no `tracks` row.
- REQ-31: Every requirement in this group is exercisable against a fixture `manager/`
  folder, so the phase does not block on merged 10067.

## Acceptance Criteria

Each is stated as something an operator could observe.

- [ ] AC-1: A **Chat** item is present in the top nav, opens a persistent view, and
      survives switching projects and returning without losing its selected target.
- [ ] AC-2: With the manager selected, typing "which tracks are in review right now?" and
      sending produces an answer grounded in this instance's real tracks — verified by
      comparing against `lc status` output taken at the same moment.
- [ ] AC-3: During that turn, the pane shows the tool calls the session actually makes,
      appearing while it runs rather than only after it finishes.
- [ ] AC-4: During that turn, the elapsed timer advances, the token count increases, and
      the status label changes at least twice, showing at least one tool name.
- [ ] AC-5: When the turn ends, the timer freezes and the final token count matches the
      run's own log (`extractSessionContextTokens` over the same file).
- [ ] AC-6: Sending a second message to the same manager target continues the same
      session — verified by the second turn referencing the first without re-reading the
      same files, and by one `track_sessions` row rather than two. Scoped to one worker
      answering both, which is the single-worker default; where a second worker answers, the
      pane states the restart (REQ-8) rather than hiding it — see D8.
- [ ] AC-7: Sending a message while the target has a live run marker shows the message as
      **queued** with the reason, and it is answered after the live turn ends, with no
      further clicks.
- [ ] AC-8: Switching the target to a busy worker shows that worker's current track
      transcript live, and the composer posts into that track's conversation (10037's
      behaviour, in the persistent pane).
- [ ] AC-9: On an instance with a blocking gap (a project with no live worker), opening
      the pane shows a wizard opening message naming that gap and the action to fix it.
- [ ] AC-10: On a fully configured instance, opening the pane shows no wizard message and
      creates **no** `worker_dispatch` row and no spawned CLI process — verified by
      checking both before and after opening.
- [ ] AC-11: `lc state --json` returns valid JSON whose track counts match `lc status`
      and whose worker list matches `/api/workers` for the same instant.
- [ ] AC-12: The affordances from AC-4 also appear on an ordinary lane-action transcript
      viewed from `TrackDetailPanel`, since the reducer is shared — no regression, and no
      second implementation.
- [ ] AC-13: A non-Claude CLI run (no stream-json) still renders its raw log fallback with
      no broken or zeroed affordance UI.
- [ ] AC-14: `track_chat` / `worker_adhoc_chat` still work unchanged from the Activity
      panel's chat bar — this track does not regress the path it declines to extend.
- [ ] AC-15: With a manager worker selected, the composer is enabled and sending produces a
      turn in `conductor/tracks/manager/conversation.md` — verified by reading the file.
- [ ] AC-16: `GET /api/projects/:id/tracks/manager/comments` returns that turn as JSON
      rather than 404, and no `tracks` row was created — verified by querying the table.
- [ ] AC-17: A human turn there is answered by a running worker within one auto-launch
      cycle, with the reply's transcript visible live in the pane; with the marker absent,
      the same folder is never claimed.
- [ ] AC-18: The pseudo-track appears on no Kanban board and in no `tracks.md`, checked
      before and after a chat exchange.
- [ ] AC-19: While the manager conversation is being written, the worker log contains no
      failed `/track/manager/comment` POSTs — noise that is present without REQ-29's skip.

## Out of Scope (FFU — deliberately deferred, and therefore not acceptance criteria)

- **Mid-stream injection into a running CLI (D1's option 3b).** Needs piped stdin,
  `--input-format stream-json`, a per-run writable handle, and a rework of the
  concurrent-run deferral at `:6866`. A separate track.
- **A free-roaming skill session per worker target (D5).** Worker targets stay
  track-scoped in v1.
- **Rebuilding 10067's REQ-14, REQ-17 and REQ-21** — the pseudo-track's existence, its
  digit-free reserved name, and the read-only live transcript path. Consumed, not
  duplicated (D7). Everything that used to sit behind that boundary is now in scope here.
- **Mobile-first layout for the Chat view.** It gets a More-sheet entry so it is
  reachable, not a redesigned mobile surface.
- **Multi-turn streaming of *partial* assistant text.** `content_block_delta` arrives and
  could drive token-by-token rendering; v1 renders completed blocks as today and uses
  deltas only for the status/token affordances.
- **Cross-machine target switching.** Targets are the workers this collector already
  returns; no new reachability mechanism.

## Data Model Changes

None, and no migration — in either tier, and the manager tier is the reason to say so
explicitly.

A **worker**-target message is a `track_comments` row written through the existing comments
endpoint, plus the matching `conversation.md` turn, exactly as today. A **manager**-target
message is a `conversation.md` turn and nothing else: the supervision pseudo-track has no
`tracks` row by deliberate design (D7), so its comments route reads and appends the file
directly and never reaches `track_comments`. That asymmetry is the whole point of the
filesystem adapter — it buys "no card on any board" for the cost of one branch in two
routes.

Sessions reuse `track_sessions` keyed by the string track number `manager`, which the column
already accommodates (`track_number` is `TEXT`). Transcripts reuse `conductor/logs/*.log`.
The state snapshot and the gap list are computed per request and never stored.
