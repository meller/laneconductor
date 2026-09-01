# Spec: Bounded Session Resume — Cap Context Growth on Long-Lived Track Sessions

## Problem Statement

`resolveTrackSession()` (`conductor/laneconductor.sync.mjs:5766`) has no upper bound.
Once a `claude_session_id` is persisted for a `(track_number, worker_id)` pair, **every**
subsequent lane-action dispatch resumes it via `--resume`, carrying the entire prior
tool-call/reasoning trace forward. The only thing that ever clears a session today is a
*reactive* invalidation after the CLI has already failed to resume it
(`laneconductor.sync.mjs:5239-5242`, track 1086 Phase 4). Nothing stops a session that is
merely enormous.

### Confirmed live — the failure signature

Measured across all 363 stream-json logs in `conductor/logs/` that carry assistant-level
token usage. "Inherited context" = the first `assistant` event's
`cache_read_input_tokens + cache_creation_input_tokens`, i.e. what the run started with
before doing any work of its own.

Six consecutive `auto-complete-implement` runs on track 1102:

| Log | Inherited context | Peak context | assistant msgs |
|-----|------------------:|-------------:|---------------:|
| `auto-complete-implement-1102-1787613065920.log` | 721,339 | 723,317 | 3 |
| `auto-complete-implement-1102-1787613564023.log` | 724,052 | 724,328 | 3 |
| `auto-complete-implement-1102-1787614803143.log` | 724,367 | 724,367 | 2 |
| `auto-complete-implement-1102-1787614873041.log` | 724,477 | 724,763 | 3 |
| `auto-complete-implement-1102-1787614918524.log` | 724,807 | 724,807 | 2 |
| `auto-complete-implement-1102-1787615021962.log` | 725,077 | 933,313 | 490 |

Peak ≈ inherited and 2–3 assistant messages means the run resumed a ~724K-token session and
then did *essentially nothing* before ending. This is the dead zone the track exists to keep
sessions out of. Claude's own auto-compaction is not a sufficient mitigation: it fired in
only 12 of 363 runs, and did not rescue any of the runs above.

## Three corrections to the track's originally-stated design

The premises recorded in `index.md` at intake were checked against the code and against the
real logs. Three of them are wrong, and the design below reflects the corrected versions.
These are recorded explicitly because two of them would each have silently broken the
feature while appearing to work.

### Correction 1 — resumed runs do NOT get file-based context (premise was inverted)

`index.md` states: *"every spawn (fresh OR resumed) ALREADY injects rich file-based context
on every turn"*. This is false. `laneconductor.sync.mjs:4958` gates the full injection:

```js
if (contextPrompt && session?.isFresh !== false) {   // full project + track docs
} else if (session && session.isFresh === false) {   // resumed: ONLY the unanswered human tail
```

A resumed run receives **only** `extractUnansweredHumanTail(conversation.md)` — not
`index.md`, `spec.md`, `plan.md`, `test.md`, or the 30KB conversation tail. So on a resumed
turn `--resume` is not a redundant second continuity mechanism layered on a working one; it
is the *only* one.

**This does not invalidate the track** — it changes why it is safe. A proactive cap returns
`isFresh: true`, which flips that same gate back on, so the cold-started run gets the full
file-based context injection. The safety argument is "the cap re-enables the file-based
mechanism," not "the file-based mechanism was already running anyway."

### Correction 2 — the proposed 150–200K threshold would disable session resume entirely

Distribution of **peak** context within a *single* lane action, same 363 logs:

| | value |
|---|---|
| p50 peak | 164,159 |
| p90 peak | 498,594 |
| max peak | 932,930 |
| runs exceeding 150K in one action | 209/363 (57%) |
| runs exceeding 200K in one action | 142/363 (39%) |
| runs exceeding 400K in one action | 50/363 (13%) |

A 150–200K cap would fire after nearly every single lane action, meaning a session would
essentially never survive to be resumed — silently reverting track 1086 to cold-start-always
while looking like a working feature. The threshold must sit above the normal single-action
working range. **Default: 400,000 tokens of inherited context** (see REQ-4).

### Correction 3 — resume *count* is a poor primary signal

`index.md` offers "an equivalent resume-count cap (~8-10)" as interchangeable with a token
cap. It is not equivalent. Growth is dominated by a run's own tool output, not by how many
times it has been resumed: track 1102 hit ~724K within a handful of resumes, while other
sessions stay under 150K across many. Resume count is retained only as a **fallback** for
when token data is unavailable (REQ-5), never as the primary signal.

### Correction 4 — read `assistant` events, never `result` events

Both event types carry a `usage.cache_read_input_tokens` field and they mean different
things. On `local-fs-review-10044-1788260734688.log` the final `assistant` event reports
148,710 (the true context size) while the `result` event reports **2,152,229** — a
cumulative sum across all turns. Reading the `result` event would trip any threshold on the
very first measurement.

## Solution

Add a proactive, bounded check at the single choke point where a session is selected, and
reuse the invalidation path that already exists for reactive resume-failures.

`resolveTrackSession()` is the only place that decides resume-vs-fresh. Everything
downstream derives from its `isFresh` flag:

```
resolveTrackSession()  ──▶ { claude_session_id, isFresh }
        │
        ├─ buildCliArgs:5808  sessionArgs = isFresh ? ['--session-id', id] : ['--resume', id]
        ├─ buildCliArgs:5809  freshnessMarker = `FRESH_SESSION: ${isFresh}`
        └─ spawnCli:4958      full context injection iff isFresh !== false
```

So a cap decision made inside `resolveTrackSession` — delete the row, mint a fresh UUID,
return `isFresh: true` — automatically and correctly produces a cold start with `--session-id`,
`FRESH_SESSION: true`, and full file-based context re-injection. **No other call site
changes.** This is what makes the fix small.

The measurement is taken at the *end* of each run and stored, so it is available at the
*start* of the next one. End-of-run context predicts next-run inherited context closely
(track 1102: 724,328 out → 724,367 in).

```
run N ends ──▶ extract last assistant event's context size from the stream-json log
                          │
                          ▼
            POST /track/:num/session { claude_session_id, context_tokens }
                          │  (resume_count++ when the id is unchanged, reset to 0 when it changes)
                          ▼
                   track_sessions row
                          │
run N+1 starts ──▶ GET /track/:num/session → { claude_session_id, last_context_tokens, resume_count }
                          │
                          ▼
              shouldCapSession(...) ── cap? ──▶ DELETE session, mint new UUID, isFresh: true
                          │                      (cold start WITH full context injection)
                          └── no ──────────────▶ --resume as today
```

## Requirements

- **REQ-1** — New pure module `conductor/services/session-cap.mjs` exporting
  `shouldCapSession({ lastContextTokens, resumeCount, maxContextTokens, maxResumes })`
  returning `{ cap: boolean, reason: string|null }`. Pure and side-effect free, matching this
  codebase's established pattern for logic extracted out of `laneconductor.sync.mjs` for
  direct unit-testing (see `context-cap.mjs`, `workspace-mode.mjs`, `merge-mode.mjs`).
  `reason` is one of `'context-tokens'`, `'resume-count'`, or `null`.

- **REQ-2** — New export `extractSessionContextTokens(logContent)` in
  `conductor/stream-json-tail.mjs` (alongside the existing `extractFinalAssistantText` /
  `extractBlockedQuestion`, which follow the same last-event-wins shape). Returns the **last
  `assistant` event's** `cache_read_input_tokens + cache_creation_input_tokens`. It MUST
  ignore `result` events entirely (Correction 4). Returns `null` when the log has no
  assistant-level usage at all (non-claude CLI, empty or killed run) — `null` means "unknown",
  never `0`.

- **REQ-3** — `track_sessions` gains two nullable/defaulted columns via a new Atlas
  migration: `last_context_tokens INTEGER` (null = never measured) and
  `resume_count INTEGER NOT NULL DEFAULT 0`.

- **REQ-4** — Thresholds are configurable, with defaults derived from the measurements above:
  - `worker.session_max_context_tokens`, default **400000**. Sits above the p90 single-action
    peak working range and well below the observed 620K–725K dead zone.
  - `worker.session_max_resumes`, default **12** (fallback only, REQ-5).
  - Env overrides `LC_SESSION_MAX_CONTEXT_TOKENS` / `LC_SESSION_MAX_RESUMES` take precedence,
    matching the existing `LC_SPAWN_TIMEOUT_MS` pattern at `laneconductor.sync.mjs:5035`.
  - Setting either to `0` disables that check.

- **REQ-5** — `lastContextTokens` is the primary signal. `resumeCount` is consulted **only**
  when `lastContextTokens` is null/unknown, so a collector that never reports tokens still
  gets a bound rather than none.

- **REQ-6** — Collector API:
  - `GET /track/:num/session` returns `{ claude_session_id, last_context_tokens, resume_count }`.
  - `POST /track/:num/session` accepts an optional `context_tokens`. On conflict,
    `resume_count` increments when `claude_session_id` is unchanged and resets to `0` when it
    changes; `last_context_tokens` is only overwritten when `context_tokens` is supplied
    (a POST without it must not erase a previous measurement).

- **REQ-7** — `conductor/tests/mock-collector.mjs` mirrors REQ-6 exactly, including the
  per-token scoping already in place (`sessionsByToken`, track 1113) — the mock is what the
  worker E2E tests run against, so a mock that lacks these fields cannot exercise the cap.

- **REQ-8** — `resolveTrackSession()` applies the cap: on `cap === true`, call the existing
  `invalidateTrackSession(trackNumber)` and return a freshly minted UUID with `isFresh: true`.
  It must NOT introduce a second invalidation code path.

- **REQ-9** — The worker reports `context_tokens` after each run. The measurement is taken in
  `spawnCli`'s exit handler, from the same `logContent` already read at
  `laneconductor.sync.mjs:5169`, and sent on the same `persistTrackSession` call shape. It is
  best-effort: a failed extraction or failed POST must never affect the run's outcome.

- **REQ-10** — Backward compatibility. A collector that does not yet return the new fields
  yields `undefined` → treated as unknown → both checks inert → today's behavior exactly.
  Never cap on missing data.

- **REQ-11** — `local-fs` mode is untouched. `resolveTrackSession` already returns `null`
  before reaching any of this (`getIsLocalFs() || !myWorkerId`), so local-fs has no sessions
  to cap and must acquire none.

- **REQ-12** — Observability. A cap fires a single worker log line naming the track, the
  retired session id, the measured value, and the threshold. It deliberately does **not**
  post to `conversation.md`: a cap is not a terminal lane-action outcome, and the Completion
  Comment Convention reserves that file for exactly one comment per run.

- **REQ-13** — `conductor/product.md`'s feature table row *"Session continuity across lane
  actions (`--resume`)"* is updated to state that continuity is bounded, and that past the
  bound a run cold-starts with full file-based context re-injected rather than resuming.

## Acceptance Criteria

- [ ] **AC-1** — Given a track whose stored session reports `last_context_tokens` above the
      threshold, the next lane-action dispatch for that track spawns the CLI with
      `--session-id <new-uuid>` (not `--resume`), and the prior session id is gone from the
      collector.
- [ ] **AC-2** — That same cold-started run receives the full file-based context in its
      prompt (project docs + the track's `index.md`/`spec.md`/`plan.md`/`test.md`/
      `conversation.md`) and `FRESH_SESSION: true` — i.e. it does not start blind.
- [ ] **AC-3** — Given a stored session below the threshold, the next dispatch still resumes
      with `--resume <same-uuid>`, unchanged from today. A track can complete a realistic
      multi-action sequence without being capped.
- [ ] **AC-4** — On a real stream-json log, the extracted context size matches the last
      `assistant` event's cached+created input tokens and is unaffected by the much larger
      cumulative figure in the `result` event.
- [ ] **AC-5** — With `last_context_tokens` unknown (null), a session is capped once
      `resume_count` exceeds `session_max_resumes`, and not before.
- [ ] **AC-6** — Against a collector that returns neither new field, dispatch behavior is
      byte-identical to current `main` — no cap ever fires.
- [ ] **AC-7** — A `local-fs` run neither creates, reads, nor caps a session.
- [ ] **AC-8** — `resume_count` increments across resumes of one session id and resets to 0
      when a new session id is written for the same track.
- [ ] **AC-9** — A `POST /track/:num/session` without `context_tokens` leaves a previously
      stored `last_context_tokens` intact.
- [ ] **AC-10** — The full existing suites for tracks 1086 / 10020 / 1087 still pass
      (`track-1086-session-worker.test.mjs`, `track-1086-session-resilience-worker.test.mjs`,
      `track-10020-resumed-session-unanswered-tail.test.mjs`, `session-resilience.test.mjs`,
      `context-cap.test.mjs`) — this track must not regress session resume, resume-failure
      invalidation, or the unanswered-human-tail injection.

## Data Model Changes

```sql
-- migrations/<ts>_add_session_context_bounds.sql
ALTER TABLE "public"."track_sessions"
  ADD COLUMN "last_context_tokens" integer NULL,
  ADD COLUMN "resume_count" integer NOT NULL DEFAULT 0;
```

Both are additive and defaulted; existing rows read as "never measured, zero resumes so far",
which per REQ-10 caps nothing until the first real measurement lands.

## Files Touched

| File | Change |
|------|--------|
| `conductor/services/session-cap.mjs` | **new** — pure cap policy (REQ-1) |
| `conductor/stream-json-tail.mjs` | `extractSessionContextTokens` (REQ-2) |
| `conductor/laneconductor.sync.mjs` | `resolveTrackSession` cap (REQ-8), `persistTrackSession` signature, exit-handler measurement (REQ-9), config knobs (REQ-4) |
| `ui/server/index.mjs` | GET/POST session endpoints (REQ-6), lines 3333–3366 |
| `migrations/<ts>_add_session_context_bounds.sql` | **new** (REQ-3) |
| `prisma/schema.prisma` | `track_sessions` model kept in sync with REQ-3 |
| `conductor/tests/mock-collector.mjs` | field parity (REQ-7) |
| `conductor/product.md` | bounded-continuity note (REQ-13) |

## Out of Scope

- Mid-session compaction or summarisation. Claude's own auto-compaction already exists; this
  track bounds the session, it does not try to shrink one in place.
- Extending sessions to `gemini`/`antigravity`. `track_sessions` is
  `claude_session_id`-specific by design (`laneconductor.sync.mjs:5804-5806`); those CLIs
  cold-start every call already and need no cap.
- Claim-time model/capability matching, and any change to the reactive resume-failure
  detection in `session-resilience-utils.mjs`.
