# Track AM-10039: Cloud Workers — Claude Cloud Instances as Workers

## Phase 1: Feasibility spike — cloud session driver prototype (GO/NO-GO)

**Problem**: The programmatic surface for claude.ai cloud sessions (create/drive/poll/link) and
the credential artifact it needs are unverified — everything else depends on them.
**Solution**: Build a throwaway-quality but real prototype driver and prove the loop once.

- [x] Task 1: Research the current programmatic surface for Claude cloud sessions (API/SDK/CLI
      `claude` cloud capabilities as of now) — document findings in `spec.md` under a new
      "Phase 1 findings" section: how a session is created with a prompt, how status is polled,
      what credential is required and how a user obtains it, the deep-link URL format, session
      limits/expiry semantics.
      → Done. See spec.md "Phase 1 Findings". Two unrelated surfaces exist (claude.ai/code vs.
      the Managed Agents API); claude.ai/code has no headless creation path (confirmed live —
      `claude --cloud` hard-requires a TTY, and `claude setup-token`'s headless-capable
      credential explicitly can't reach connector-backed sessions either).
- [x] Task 2: Prototype `conductor/services/cloud-session-driver.mjs`: `createSession({prompt,
      repo, credential})`, `getSessionStatus(id)`, `getSessionUrl(id)` — exercised by a manual
      script against a scratch GitHub repo with the Claude GitHub App installed.
      → Written, but incomplete by necessity, not oversight: `createSession` shells to the real
      `claude --cloud` and reproduces the exact blocking error live (verified — see spec.md).
      `getSessionStatus`/`getSessionUrl` are left explicitly unimplemented (throw with a pointer
      to spec.md) because no documented or discovered API surface exists for either — writing a
      guessed implementation would misrepresent what Phase 1 actually established.
- [ ] Task 3: Run the loop once for real: launch a session with a trivial change prompt on the
      scratch repo → poll to completion → observe the pushed branch/PR. Record the session URL,
      PR URL, and observed status transitions in `conversation.md`.
      → **Could not run, structurally, not just practically**: `--cloud` refuses any
      non-interactive caller, including this one — there is no TTY to give it from an automated
      session. No scratch repo was set up for the same reason (no point provisioning one against
      a mechanism confirmed blocked at the invocation step). This absence is itself part of the
      Phase 1 finding, not a skipped step.
- [x] Task 4: GO/NO-GO checkpoint comment in `conversation.md`. On NO-GO (surface unusable):
      stop, set **Waiting for reply**: yes, and put the fallback decision (option B pivot) to a
      human — do not proceed silently.
      → NO-GO posted, with fallback options, per this run's explicit scope (Phase 1 only, stop
      after this comment regardless of outcome).

**Impact**: De-risked the track earlier than a full build would have — the specific mechanism
D-1/D-5 assumed (headless dispatcher shelling to `claude --cloud`) is confirmed non-viable
before any of Phases 2-7's implementation cost was spent. A human decision on the fallback path
is needed before this track can continue (see conversation.md).

## Phase 2: Executor seam — refactor with zero behavior change

**Problem**: LLM invocation is welded to local `spawnCli` in four call sites; one
(`runCreateProject`) bypasses even that.
**Solution**: One executor interface; today's behavior becomes `LocalCliExecutor`.

- [ ] Task 1: Define the executor interface in `conductor/services/executor.mjs`:
      `run(prompt, ctx) → {id}`, `poll(id) → {state, detail}`, `result(id)`; states map onto the
      existing dispatch outcome vocabulary (running/success/error/timeout/needs-input).
- [ ] Task 2: `LocalCliExecutor` wrapping the existing `buildCliArgs` → `spawnCli` path —
      behavior-identical (same logs, same exit handling, same retry accounting).
- [ ] Task 3: Route all four call sites through the seam: `autoLaunchLocalFs`,
      `startNextAutoCompleteStage`, `checkDispatchInbox`, and `runCreateProject` (normalized
      off its bespoke `spawn`).
- [ ] Task 4: Full existing suite green (`node --test conductor/tests/`), plus the local-fs and
      local-api E2E suites — this phase must be invisible to machine workers (REQ-9/AC-7).

**Impact**: The single seam that makes every LLM-triggering path cloud-capable later.

## Phase 3: Credentials, preflight, and the `runtime` field

**Problem**: Nowhere to store/validate Claude credentials or express "this worker is cloud".
**Solution**: Schema + storage + preflight checks + creation UX.

- [ ] Task 1: Migration: `workers.runtime` (default `'machine'`); `tracks.cloud_session_id`,
      `tracks.cloud_session_url`. (Prisma schema + Atlas migration per tech-stack workflow.)
- [ ] Task 2: Credential storage per Phase 1 findings, following 1118/1033 patterns (env/secret
      store; never in `.laneconductor.json`/git). Include live validation (`validateClaude
      Credential()` doing a cheap real check, not presence-only).
- [ ] Task 3: Preflight module `conductor/services/cloud-preflight.mjs` implementing REQ-4's
      four checks (Claude credential live check; GitHub remote; Claude GitHub App installed on
      repo; dispatcher GitHub token) — each failure returns a machine-usable reason + fix-it
      guidance string.
- [ ] Task 4: Creation UX: `lc worker start --runtime cloud` (and setup wizard question where
      worker creation already exists) runs preflight and refuses to register on failure,
      printing the guidance. UI: workers list shows a CLOUD runtime badge (same pattern as the
      1042 mode badge).
- [ ] Task 5: Tests: preflight matrix (each check failing alone), credential validation
      mocked-live, migration idempotence, machine-worker default untouched.

**Impact**: AC-1; the trust groundwork for every dispatch.

## Phase 4: CloudSessionExecutor + implement lane in the cloud

**Problem**: No executor can run a lane action in a cloud session yet.
**Solution**: Wrap the Phase 1 driver as the second executor; wire the implement lane first.

- [ ] Task 1: `CloudSessionExecutor` implementing the Phase 2 interface over the Phase 1
      driver; persists `cloud_session_id`/`cloud_session_url` on the track; maps session states
      to executor states.
- [ ] Task 2: Cloud lane-action prompt assembly: reuse `buildCliArgs`'s prompt content (skill
      invocation + track number) adapted for a session that clones from GitHub (context files
      ship inside the repo already — conductor/ is committed).
- [ ] Task 3: Claim path: a `runtime: cloud` worker claiming an implement-lane track dispatches
      via `CloudSessionExecutor`; the existing poll loop watches session state instead of child
      exit; on completion, existing `reconcilePrTracks` machinery picks up the PR (extend its
      PR-state source so the dispatcher can use the GitHub API token from preflight instead of
      requiring local `gh`).
- [ ] Task 4: Kanban card: show cloud status chip + deep link (`cloud_session_url`) while
      active (AC-3).
- [ ] Task 5: Tests with a mock session API server (same zero-dep Node http pattern as
      `conductor/tests/mock-collector.mjs`): dispatch → poll transitions → PR-detected → lane
      transition. Then AC-2 once for real against the scratch repo; record evidence in
      conversation.md.

**Impact**: AC-2/AC-3 — the core feature works end to end for the expensive lane.

## Phase 5: All lanes cloud + merge/conflict handling

**Problem**: plan/review/quality-gate/merge still assume local execution for cloud workers.
**Solution**: Same executor, per-lane prompt/outcome mapping; merge via GitHub API + cloud
conflict sessions.

- [ ] Task 1: plan lane in cloud: session commits spec/plan/test/index updates to the repo
      (branch or direct per workspace rules); dispatcher reads resulting lane marker via GitHub
      contents API to advance state.
- [ ] Task 2: review + quality-gate lanes in cloud: sessions run the project's test commands in
      the sandbox on the track branch; verdict returns via the committed conversation/index
      updates on the branch (outbound-only, D-3).
- [ ] Task 3: merge lane: clean PR → merge via GitHub API call (no local git); conflicted PR →
      dispatch a cloud merge session with the same intent as the local merge action ("merge
      main into track branch, resolve using plan/spec intent, push"), then re-check
      mergeability (AC-4). Reuse `reconcilePrTracks`' CONFLICTING detection.
- [ ] Task 4: Mid-run board freshness: dispatcher polls the track branch's `index.md`/`plan.md`
      via GitHub contents API on the reconcile cadence (bounded calls; respect rate limits).
- [ ] Task 5: Tests: per-lane mock-session flows; conflicted-PR → merge-session → mergeable
      sequence against a mock GitHub API.

**Impact**: D-4 fulfilled — a cloud worker can carry a track through its whole lifecycle.

## Phase 6: Dispatcher-only worker mode

**Problem**: Even with cloud executors, the worker still starts chokidar/worktree/file-sync
subsystems and expects a repo checkout — the multi-tenant scaling blocker.
**Solution**: A startup mode that runs only the dispatcher loop.

- [ ] Task 1: `lc worker start --dispatcher` (config: `worker.mode: 'dispatcher'`, extending
      the 1042 mode mechanism): skips chokidar watchers, file_sync_queue processing, worktree/
      git-lock subsystems, pull-from-DB file writes; requires `runtime: cloud` executors only.
- [ ] Task 2: DB-as-truth path: claims, lane transitions, retries, stuck detection
      (resetStuckActions), orphan reconciliation (list sessions instead of PIDs), dispatch
      inbox, auto-complete chains — all verified to function with no `conductor/` directory
      present at all.
- [ ] Task 3: Permanent-failure escalation (REQ-8): classify permanent vs transient executor/
      preflight errors; DB-persisted attempt counters; escalate to `failure` + single ❌ Inbox
      comment after N attempts. Coordinate the shared shape with track 10040 (see both
      conversations) — if 10040 has landed its counter, reuse it; if not, build DB-side here
      and note it on 10040.
- [ ] Task 4: E2E test: dispatcher-only worker + mock session API + mock GitHub API + real
      Collector/DB path drives a track plan → implement → PR → merged with zero filesystem
      writes outside logs (AC-5); revoked-credential loop test (AC-6).

**Impact**: The scaling answer — orchestration cost per project drops to a few HTTP calls.

## Phase 7: Docs + fundamentals reconciliation

**Problem**: product.md and tech-stack.md describe only the local-sovereign profile (flagged as
a fundamentals conflict in conversation.md).
**Solution**: Human-reviewed doc updates, not silent edits.

- [ ] Task 1: Draft updates presenting cloud workers as an opt-in runtime alongside the
      local-sovereign default (product.md) and the executor seam + dispatcher mode as a second
      coordination profile (tech-stack.md, workflow.md's Workspace/coordination notes) — post
      the draft for human review per the guardrail before committing.
- [ ] Task 2: SKILL.md / lc help: document `--runtime cloud`, `--dispatcher`, preflight
      requirements, and the v1 outbound-only status model.

**Impact**: The docs stop contradicting the shipped architecture.

## Phase 8: Inbound live-progress callbacks (v2 — OUT OF THIS PASS)

Deliberately unchecked and excluded from this track's acceptance criteria (D-3). Requires an
internet-reachable Collector and scoped short-lived callback keys injected into sessions.
Do NOT mark this track done against this phase; it moves to its own track (or 017) when
prioritized.

- [ ] (deferred) Scoped short-lived callback tokens; Collector exposure model; per-phase live
      progress posting from sessions.
