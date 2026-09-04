# Spec: Distinguish an expired Claude CLI login from real capacity exhaustion

## Problem Statement

`checkClaudeCapacity()` (`conductor/laneconductor.sync.mjs:3641`) spawns `claude -p test`
before a dispatch to decide whether the primary provider has capacity. It treats **any**
non-zero exit code as capacity exhaustion, unconditionally:

```js
const available = code === 0;
...
let resetAt = new Date(Date.now() + 60000);   // 1 min default "just in case"
if (output.includes("hit your limit") || output.includes("exhausted") || output.includes("resets")) {
  ...parse a real reset time...
}
providerStatusCache.set('claude', { status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Capacity exhausted' });
await post(url, token, '/provider-status', { provider: 'claude', status: 'exhausted', ... });
```

Every failure reason that is *not* a rate limit falls into the same `exhausted` bucket with a
hardcoded `Date.now() + 60000` guess and the literal string `'Capacity exhausted'`.

**Confirmed live 2026-09-04.** The standalone `claude` CLI's OAuth login had expired
(`Failed to authenticate: OAuth session expired and could not be refreshed`, exit 1) —
completely unrelated to usage or rate limits. This is the plain CLI binary's own OAuth store,
which is **separate** from a Claude Code app session's SDK-hosted auth: the investigation that
found this was itself run from inside a live, working Claude Code session while the worker's
own `claude` CLI calls were all failing.

Three distinct defects follow from that single misclassification:

1. **Wrong signal.** `provider_status` said `exhausted` / `Capacity exhausted`. Nothing in the
   DB, the UI, or the worker log distinguished "rate limited, wait it out" from "logged out,
   a human must act". Auth failures do not self-heal by waiting.
2. **An indefinitely rolling false recovery estimate.** Because the code re-guesses
   `Date.now() + 60000` on *every* probe rather than remembering the failure was unparseable,
   `provider_status.reset_at` kept marching forward each retry cycle (09:34:04 dispatch failed;
   the 09:46:04 probe wrote `reset_at = 09:47:04`; and so on). A human glancing at the DB or
   the board saw a permanent, silently-repeating "1 minute away from recovery".
3. **A burned claim/spawn attempt per cycle.** `isProviderAvailable()`'s reset-time-passed
   branch (`laneconductor.sync.mjs:3713`, `[status] in-memory: provider reset time passed,
   marking available`) fires the moment that rolling 1-minute stamp elapses, deletes the cache
   entry, and reports the provider available — which triggers another real dispatch attempt
   that fails the same way, forever.

Downstream, every dispatch in the project failed with `lane_action_result: 'no provider
available'` — `buildCliArgs()` returning `null` (`laneconductor.sync.mjs:6127` / `:6138`) when
`isProviderAvailable`/`checkClaudeCapacity` both report unavailable and no secondary CLI is
configured. That message names neither the provider nor the reason, so the actual cause went
unnoticed until one specific dispatch was manually chased down. The worker log alone was not
enough.

## Solution

Classify the probe's failure by its actual error text instead of collapsing every non-zero
exit into `exhausted`, carry the classification through the existing `provider_status` plumbing
as its own status value, and surface it on the three places a human actually looks: the board's
LLM Providers card, `lc status`, and the blocked dispatch's own result text.

## Requirements

- **REQ-1** — A new pure module, `conductor/services/provider-probe-classify.mjs`, turns a probe
  result (`{ code, output, nowMs }`) into one of exactly four statuses. Pure, no I/O, in the
  same extraction style as `capacity-probe-throttle.mjs` / `exhaustion-detector.mjs`, so the
  decision is testable without spawning a real CLI process.

  | status | when | `reset_at` | blocks dispatch |
  |--------|------|-----------|-----------------|
  | `ok` | `code === 0` | `null` | no |
  | `auth_required` | output matches an authentication/login failure | **`null`** | yes |
  | `exhausted` | output matches a genuine rate-limit/quota response | parsed reset time, else `+15m` | yes |
  | `probe_failed` | any other non-zero exit | **`null`** | yes |

- **REQ-2** — Authentication is matched **before** rate limiting. The matcher is a tight,
  explicitly enumerated list (`Failed to authenticate`, `OAuth session expired`,
  `could not be refreshed`, `Invalid API key`, `authentication_error`, `Unauthorized`,
  `not logged in`, a `/login` remedy prompt) — not a catch-all, and deliberately **not** a bare
  `401` substring, which collides with ordinary log content.

- **REQ-3** — Rate-limit detection reuses the shared `isProviderExhausted(output, 'claude')`
  from `conductor/services/exhaustion-detector.mjs` rather than adding a third private copy of
  the substring list. Because the probe's existing trigger set is broader than the detector's
  (`output.includes('resets')` vs the detector's `/resets\s+\d+(am|pm)/i`), the classifier ORs
  in the probe's own `/\bresets\b/i` and `/\bexhausted\b/i` so no case that is `exhausted`
  today is narrowed into `probe_failed`. Reset-time **parsing** stays in the classifier — it
  handles `resets 10:30pm`, which the detector's boolean regex does not.

- **REQ-4** — `auth_required` and `probe_failed` **never** write a `reset_at`. This is what
  structurally ends the rolling-forward false recovery estimate: with no reset stamp there is
  nothing for `isProviderAvailable()`'s reset-time-passed branch to optimistically expire, so
  it can no longer burn a claim/spawn attempt every cycle.

- **REQ-5** — A shared `isBlockingProviderStatus(status)` predicate replaces every
  `status !== 'exhausted'` comparison that currently means "available". Today there are three:
  `capacity-probe-throttle.mjs:32`, `laneconductor.sync.mjs:3709` (in-memory cache branch of
  `isProviderAvailable`) and `laneconductor.sync.mjs:3738` (its DB branch). Left unchanged, a
  new `auth_required` value would read as **available** at all three sites — strictly worse
  than today's behaviour, so this requirement is not optional polish.

  **Exactly three — do not sweep the file.** A grep for the same comparison also hits
  `laneconductor.sync.mjs:3780` and `:3810`, both inside `checkExhaustion()`. Those two mean
  something different: they are *change-detection* guards ("has this provider already been
  recorded exhausted, so skip the redundant POST"), not availability tests. Swapping them for
  `isBlockingProviderStatus` would suppress the `/provider-status` POST that upgrades a provider
  from `auth_required` to a genuine `exhausted` when a real rate limit shows up in a run log.
  Leave both exactly as they are.

- **REQ-6** — `auth_required` and `probe_failed` are re-probed normally once the existing 60s
  capacity-probe TTL elapses. They are blocking, not sticky: the moment a human runs
  `claude login`, the next probe returns `ok` and work resumes with no manual reset, no cache
  flush, and no worker restart.

- **REQ-7** — `provider_status.last_error` carries a human-actionable message, not the constant
  `'Capacity exhausted'`. For `auth_required` it names the remedy and the distinction that
  caused the confusion: the standalone `claude` CLI's own OAuth session, separate from a Claude
  Code app session. For `probe_failed` it carries the probe's own first line of output
  (truncated) so an unrecognised failure is diagnosable rather than mislabelled.

- **REQ-8** — The worker logs a distinct, actionable line per status. `auth_required` must not
  print the existing `[status] Claude capacity exhausted, marking in DB (cool down until ...)`,
  which is the log line that made this invisible.

- **REQ-9** — The three sites that handle `buildCliArgs()` returning `null`
  (`laneconductor.sync.mjs:6598` local-fs auto-launch, `:6789` auto-complete, `:8443` explicit
  dispatch) report **why** the provider was unavailable instead of the bare
  `'no provider available'`. A `providerBlockReason(cli)` helper formats the reason from the
  same `providerStatusCache` entry the block decision came from.

- **REQ-10** — An **explicit** dispatch blocked by `auth_required` appends one
  `> **system**: ⚠️ ...` comment to the track's `conversation.md`, naming the remedy. Scoped to
  explicit dispatch (`laneconductor.sync.mjs:8443`) only — a human clicked ▶, so the volume is
  bounded by human action. The idle auto-launch tick must **not** comment; it fires every 5s
  across every queued track and would flood every conversation in the project.

- **REQ-11** — The board's LLM Providers card (`ui/src/components/WorkersList.jsx`, **both** the
  strip layout's `ProviderStatus` at line 43 and the grid layout's inline card at line 293)
  renders `auth_required` and `probe_failed` as their own visibly-not-healthy states.
  `auth_required` reads `LOGIN REQUIRED` with the `claude login` remedy and states plainly that
  it will not recover on its own. Both layouts currently compute
  `isExhausted = p.status === 'exhausted'` and fall through to a green dot / `HEALTHY` badge for
  anything else — so without this change an `auth_required` provider renders as healthy.

- **REQ-12** — `lc status` prints a provider-health line in its API-mode branch (next to the
  existing `Worker Status` / `Active Targets` lines, `bin/lc.mjs:2237`), showing any non-`ok`
  provider with its `last_error`. Skipped in local-fs mode, which has no `provider_status` to
  read.

- **REQ-13** — No schema migration. `provider_status.status` is plain `text` with no `CHECK`
  constraint (`migrations/20260227074203_initial.sql:58`), and both collectors
  (`ui/server/index.mjs:3042`, `cloud/functions/index.js:1367`) pass `status` straight through
  to the upsert without validating it. Verified before writing this spec, not assumed.

## Acceptance Criteria

- [ ] AC-1 — A worker whose `claude` CLI login has expired records
      `provider_status.status = 'auth_required'` with `reset_at` **null**, and a `last_error`
      that tells a human to run `claude login`.
- [ ] AC-2 — A worker that is genuinely rate-limited still records `status = 'exhausted'` with a
      parsed (or `+15m` fallback) `reset_at`, exactly as it does today. No regression.
- [ ] AC-3 — Repeated probes against a persistently expired login leave `reset_at` null every
      time. The stored recovery estimate never moves, so the board never claims the provider is
      one minute from recovering.
- [ ] AC-4 — While a provider is `auth_required`, the worker does not optimistically re-mark it
      available and spawn a doomed dispatch each cycle. `isProviderAvailable('claude')` returns
      false for the whole episode.
- [ ] AC-5 — A human opening the board sees the Claude provider as **not** healthy, labelled
      `LOGIN REQUIRED`, with the `claude login` remedy — in both the strip and grid layouts.
- [ ] AC-6 — A dispatch blocked by an expired login fails with a result naming the provider and
      the login remedy, not `'no provider available'`, and the track's conversation carries one
      `⚠️` system comment saying the same.
- [ ] AC-7 — `lc status` on a project whose provider is `auth_required` prints the remedy.
- [ ] AC-8 — After `claude login` succeeds, the next probe (within one 60s TTL) returns `ok`,
      `provider_status` flips back, and dispatches resume — with no worker restart and no
      manual DB edit.
- [ ] AC-9 — An unrecognised non-zero probe exit is recorded as `probe_failed` with its own
      output in `last_error`, and is **not** labelled a capacity exhaustion.

## Non-Goals

- **Auto-recovery of the login.** The worker will not attempt to run `claude login`,
  `claude setup-token`, or refresh a token itself. It reports; a human re-authenticates.
- **Any change to `conductor/agent-runtime.mjs`'s behaviour.** That file carries a
  near-verbatim duplicate of `checkClaudeCapacity`/`isProviderAvailable`/`checkExhaustion`
  (lines 150–320) with the identical bug. Verified during planning that **nothing imports it** —
  a repo-wide grep for `agent-runtime` matches only its own first line. Fixing dead code adds
  risk with no behavioural benefit, so this track only marks it as unused (Phase 6) and leaves
  the logic alone.
- **Claim-time model/provider capability matching.** Out of scope here, same as documented in
  `conductor/workflow.md`'s Model Overrides caveats.

## Data Model Changes

None. See REQ-13.
