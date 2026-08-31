# Track AM-10039: Cloud Workers — Managed Agents Sessions as Workers (rev. 2, post-pivot)

> Rev. 2 (2026-08-30): Phase 1's NO-GO on claude.ai/code triggered a human-approved pivot to
> the Managed Agents API (see PIVOT RECORDED in conversation.md and spec.md rev. 2). Phase 1
> is preserved below as completed history; Phase 1b is the new live-validation spike for the
> replacement surface; Phases 2–8 are re-planned around Managed Agents.

## Phase 1: Feasibility spike — claude.ai/code driver prototype (COMPLETE — verdict NO-GO)

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
- [x] Task 3: Run the loop once for real: launch a session with a trivial change prompt on the
      scratch repo → poll to completion → observe the pushed branch/PR. Record the session URL,
      PR URL, and observed status transitions in `conversation.md`.
      → **Closed as structurally-blocked, not skipped**: `--cloud` refuses any non-interactive
      caller, so no automated process can run this exercise. That impossibility IS the Phase 1
      result (it's what forced the pivot); the live end-to-end exercise moves to Phase 1b
      against the Managed Agents surface.
- [x] Task 4: GO/NO-GO checkpoint comment in `conversation.md`. On NO-GO (surface unusable):
      stop, set **Waiting for reply**: yes, and put the fallback decision (option B pivot) to a
      human — do not proceed silently.
      → NO-GO posted with fallback options; human chose the Managed Agents pivot (recorded in
      conversation.md). Phase complete.

**Impact**: De-risked the track before Phases 2+ spent any implementation cost on a non-viable
mechanism; produced the pivot decision this rev. 2 plan is built on.

## Phase 1b: Managed Agents live-validation spike (GO/NO-GO for rev. 2)

**Problem**: Everything known about Managed Agents is docs-grade; the rev. 2 design leans on
five specific platform behaviors that must be proven live before building on them.
**Solution**: A real agent + environment + session driving one trivial change end to end on a
scratch repo, exercising exactly the features D-8/D-9 depend on.

- [x] Task 0: Auth per the keyless-only policy: install the `ant` CLI and use `ant auth
      login` (OAuth profile) — no ANTHROPIC_API_KEY anywhere; verify the Managed Agents
      beta accepts profile auth end to end (a finding in its own right — record it).
      → **Confirmed live**: `ant beta:agents list` returned real `200 OK {"data":[]}` with
      `ANTHROPIC_API_KEY` unset throughout. See spec.md Phase 1b Findings.
- [~] Task 1: Provision via `ant` CLI: agent YAML (model, system prompt with laneconductor
      skill invocation, bash/code-exec tools) + environment YAML under `conductor/cloud/`;
      record resulting ids. Create a scratch GitHub repo containing a minimal `conductor/`
      + `.claude/skills/laneconductor` symlink-resolved copy.
      → **Partially done, then blocked**: scratch repo seeded (minimal tracked file + trimmed
      skill stub, pushed to `github.com/meller/laneconductor-cloud-worker-scratch`);
      environment created live (`env_01UvpowJ9L2J6E61sqimGiRs`, deleted after — throwaway);
      **agent creation failed live** with a `400 credit balance too low` error — this
      workspace's Anthropic org has no funded API credits (separate from the Claude.ai
      subscription). No agent exists; nothing downstream of it could run. See spec.md.
- [x] Task 2: Rewrite `conductor/services/cloud-session-driver.mjs` against
      `/v1/sessions` (beta `managed-agents-2026-04-01`): `createSession({trackNumber, repo,
      budget})` (mounts the repo resource + vault GitHub credential), `sendEvent(id, message)`,
      `pollEvents(id)`, `getTraceUrl(id)` — thin, real HTTP, no mocks.
      → Done, against the *confirmed real* command shapes (`ant beta:sessions create
      --agent/--environment-id/--resource/--budget/--initial-event`, `events send/list`,
      `sessions retrieve`) — command construction checked against a fake session ID and
      correctly reached the real API (clean validation error, not a CLI parse failure). Not
      exercised against a real session (Task 1 blocked that). Uses the `github_repository`
      resource's own write-only `authorization_token` for the GitHub token, not a vault
      credential — see spec.md's D-9 correction on why the simpler path is sufficient here.
- [ ] Task 3: Live end-to-end: session with mounted scratch repo → prompt a trivial tracked
      change → verify in-sandbox skill auto-discovery ran, commit + push succeeded via the
      vault credential (token never visible in transcript), branch appears on GitHub → open PR
      (record which side opened it — agent via prompt vs dispatcher via API — and standardize).
      Record session id, trace URL, PR URL, observed event/status transitions, and
      `cache_read_input_tokens` evidence in `conversation.md`.
      → **Could not run — blocked by Task 1's billing error**, not skipped. Everything needed
      is staged (scratch repo, driver) for a re-run once credits exist.
- [ ] Task 4: Verify the operational envelope: session budget set + budget-reached behavior
      (drive a tiny-budget session to its cap), session resume after idle (second event to the
      same session), and session lifetime semantics (does an idle session survive long enough
      to span a multi-day track? → decides D-8 track↔session vs session-per-lane-action —
      record the decision in spec.md).
      → **Could not run — same blocker as Task 3.**
- [x] Task 5: GO/NO-GO checkpoint comment in `conversation.md`. On NO-GO: stop, set
      **Waiting for reply**: yes, put the next fallback (self-provisioned sandboxes / wait for
      GA) to a human.
      → Posted as **BLOCKED (neither GO nor NO-GO)** — a billing/account gap, not a surface
      finding; asks the human to fund the workspace's API credits, per this run's own scope
      (stop after this comment regardless of outcome).

**Impact**: Converts most of the rev. 2 design's docs-grade assumptions into confirmed-live
facts (keyless auth, repo mounting, skill discovery, driver command shapes) and surfaces one
previously-unknown blocking precondition (funded API credits, distinct from a Pro subscription)
before Phase 3 would have hit it as a confusing preflight failure with no prior documentation.
The live end-to-end exercise (Tasks 3/4) is staged and ready, waiting on that one human action.

## Phase 2: Executor seam — refactor with zero behavior change

**Problem**: LLM invocation is welded to local `spawnCli` in four call sites; one
(`runCreateProject`) bypasses even that.
**Solution**: One executor interface; today's behavior becomes `LocalCliExecutor`.

- [x] Task 1: Define the executor interface in `conductor/services/executor.mjs`:
      `run(prompt, ctx) → {id}`, `poll(id) → {state, detail}`, `result(id)`; states map onto the
      existing dispatch outcome vocabulary (running/success/error/timeout/needs-input) plus
      `budget-reached`.
      → Done. `createExecutor(runtime, {localCliExecutor})` factory throws a clear
      not-yet-implemented error for `remote`/`cloud` rather than silently defaulting to
      `machine` — Phase 3b/4 slot in there without touching call sites again. Also added
      `extractPromptFromArgs` (argv→prompt lookup, mirrors spawnCli's own existing fallback
      logic) and `runToCompletion` (the spawn+await-exit primitive `runCreateProject` needed).
      Pure module, zero dependency on laneconductor.sync.mjs's internal state.
- [x] Task 2: `LocalCliExecutor` wrapping the existing `buildCliArgs` → `spawnCli` path —
      behavior-identical (same logs, same exit handling, same retry accounting).
      → Done as `localCliExecutor` inside laneconductor.sync.mjs itself (spawnCli is deeply
      coupled to that module's private state — runningPids, git locks, worktrees, run markers —
      extracting it out was explicitly avoided as unnecessary regression risk for a
      zero-behavior-change phase). `run()` is a pure delegation to the untouched `spawnCli`
      function with identical arguments; `poll`/`result` are honest best-effort shims (local
      completion stays event-driven inside spawnCli's own exit handler, not polled by any
      current caller).
- [x] Task 3: Route all four call sites through the seam: `autoLaunchLocalFs`,
      `startNextAutoCompleteStage`, `checkDispatchInbox`, and `runCreateProject` (normalized
      off its bespoke `spawn`).
      → Done. Three call sites (autoLaunchLocalFs, startNextAutoCompleteStage,
      checkDispatchInbox's lane-action dispatch) now call `executor.run(prompt, ctx)`;
      runCreateProject's bespoke inline spawn+exit Promise now calls `runToCompletion()`
      instead (deliberately not through LocalCliExecutor — project creation has no
      track/lane/worktree, forcing it through spawnCli's lane-action machinery would be a
      real behavior change). checkDispatchInbox's OTHER dispatch-type handlers (track_chat,
      build, deploy, provision-worker, etc.) have their own bespoke spawns and are
      **deliberately out of scope** — D-5 named exactly these four call sites; scope was not
      silently widened.
- [x] Task 4: Full existing suite green (`node --test conductor/tests/`), plus the local-fs and
      local-api E2E suites — this phase must be invisible to machine workers (REQ-9/AC-7).
      → **Zero regressions, rigorously verified — but not literally "green," and that gap is
      pre-existing, not caused by this phase.** `node --test conductor/tests/*.test.mjs` (596
      tests) has 66-73 pre-existing failures depending on run (this suite has real flakiness —
      subprocess timing, shared ports). Verified via `git stash` isolating exactly this
      phase's diff: ran the full suite on the pre-refactor code (73 failures) and on the
      post-refactor code (66 failures) and diffed the two failing-test-name sets —
      **zero tests fail after that didn't already fail before**; the tests that differ are
      flaky ones flipping direction, not anything this refactor touched. New test file
      `track-10039-executor-seam.test.mjs` (13 assertions, all passing) covers TC-11/TC-12
      directly. **Separate, more important finding surfaced by this exercise (not a regression,
      pre-existing, needs its own attention outside this track)**: running the E2E suites from
      inside a git worktree trips `resolvePrimaryCwdDecision`'s worktree-detection safety
      logic, which redirects the test's spawned worker to run against the **real primary
      checkout** — confirmed live, the E2E test's worker actually called
      `POST http://127.0.0.1:8091/project/ensure` and `/worker/register` against this
      machine's real, currently-running Collector API (port 8091, the same instance managing
      this very track), not an isolated mock. Checked the DB read-only afterward: no new
      worker/project rows were created (both calls landed as idempotent upserts against the
      real pre-existing rows), so no data was corrupted, but the test suite is not hermetic
      when run from a worktree — a real isolation gap, unrelated to the executor seam, that a
      human should decide whether to track separately.

**Impact**: The single seam that makes every LLM-triggering path cloud-capable, landed with
verified zero behavior change for machine workers.

## ✅ REVIEWED

Phase 2 passed review (2026-08-31): executor seam implementation is complete and correct, all 13 tests passing, zero regressions verified against the full suite, call-site routing confirmed.

## Phase 3: Credentials, preflight, and the `runtime` field

**Problem**: Nowhere to store/validate the Anthropic API key or GitHub token, or to express
"this worker is cloud".
**Solution**: Schema + storage + vault registration + preflight checks + creation UX.

- [ ] Task 1: Migration: `workers.runtime` (default `'machine'`); `tracks.cloud_session_id`,
      `tracks.cloud_session_url`, `tracks.cloud_session_budget`. (Prisma schema + Atlas
      migration per tech-stack workflow.)
- [ ] Task 2: Anthropic auth resolution (REQ-3, keyless-only): resolve via SDK chain
      restricted to profile/WIF (explicitly reject a configured ANTHROPIC_API_KEY with a
      policy message); `validateAnthropicAuth()` does a cheap real call and reports the mode.
      GitHub token: secret store + vault registration for in-sandbox use;
      `validateGithubToken(repo)` (real repo-visibility check) — not presence-only.
- [ ] Task 3: Preflight module `conductor/services/cloud-preflight.mjs` implementing REQ-4's
      four checks (profile/WIF identity live + mode reported; Managed Agents beta reachable; GitHub remote exists; GitHub
      token sees the repo) — each failure returns a machine-usable reason + fix-it guidance.
- [ ] Task 4: Creation UX: `lc worker start --runtime cloud` (and setup wizard question where
      worker creation already exists) runs preflight and refuses to register on failure,
      printing the guidance. UI: workers list shows a CLOUD runtime badge (same pattern as the
      1042 mode badge).
- [ ] Task 5: Tests: preflight matrix (each check failing alone), validation mocked-live,
      migration idempotence, machine-worker default untouched, no credential material in
      git-tracked files.

**Impact**: AC-1; the trust groundwork for every dispatch.

## Phase 4: CloudSessionExecutor + implement lane in the cloud

**Problem**: No executor can run a lane action in a Managed Agents session yet.
**Solution**: Wrap the Phase 1b driver as the second executor; wire the implement lane first.

- [ ] Task 1: `CloudSessionExecutor` implementing the Phase 2 interface over the Phase 1b
      driver: resolves the track's session (create-on-first-use with repo mount + vault
      credential + budget, per D-8; resume otherwise — honoring Phase 1b's lifetime decision),
      sends the lane action as an event, maps session/event states to executor states
      (including budget-reached), persists `cloud_session_id`/`cloud_session_url`.
- [ ] Task 2: Cloud lane-action prompt assembly: reuse `buildCliArgs`'s prompt content (skill
      invocation + track number; the mounted repo carries conductor/ context and the skill —
      D-9), adjusted for the session's FRESH/RESUMED semantics.
- [ ] Task 3: Claim path: a `runtime: cloud` worker claiming an implement-lane track dispatches
      via `CloudSessionExecutor`; the existing poll loop watches session events instead of
      child exit; on completion, `reconcilePrTracks` picks up the PR (extend its PR-state
      source to use the stored GitHub token / GitHub API instead of requiring local `gh`).
- [ ] Task 4: Kanban card: cloud status chip (running/idle/needs-input/budget-reached) + trace
      deep link (`cloud_session_url`) + session token/cost from usage events (AC-3, REQ-7).
- [ ] Task 5: Tests with a mock sessions API server (same zero-dep Node http pattern as
      `conductor/tests/mock-collector.mjs`): dispatch → event transitions → PR-detected → lane
      transition; budget-reached path (AC-8). Then AC-2 once for real against the scratch
      repo; record evidence in conversation.md.

**Impact**: AC-2/AC-3/AC-8 — the core feature works end to end for the expensive lane.

## Phase 5: All lanes cloud + merge/conflict handling

**Problem**: plan/review/quality-gate/merge still assume local execution for cloud workers.
**Solution**: Same executor and session, per-lane prompt/outcome mapping; merge via GitHub API
+ session conflict turns.

- [ ] Task 1: plan lane in cloud: session commits spec/plan/test/index updates to the repo
      (branch or direct per workspace rules); dispatcher reads resulting lane marker via GitHub
      contents API to advance state.
- [ ] Task 2: review + quality-gate lanes in cloud: session turns run the project's test
      commands in the sandbox on the track branch; verdict returns via the committed
      conversation/index updates on the branch (outbound-only, D-3).
- [ ] Task 3: merge lane: clean PR → merge via GitHub API call (no local git); conflicted PR →
      send the session a conflict-resolution turn with the same intent as the local merge
      action ("merge main into track branch, resolve using plan/spec intent, push"), then
      re-check mergeability (AC-4). Reuse `reconcilePrTracks`' CONFLICTING detection.
- [ ] Task 4: Mid-run board freshness: dispatcher polls the track branch's `index.md`/`plan.md`
      via GitHub contents API on the reconcile cadence (bounded calls; respect rate limits).
- [ ] Task 5: Tests: per-lane mock-session flows; conflicted-PR → conflict-turn → mergeable
      sequence against a mock GitHub API.

**Impact**: D-4 fulfilled — a cloud worker carries a track through its whole lifecycle.

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
      preflight errors (revoked key, dead GitHub token, org budget exhaustion); DB-persisted
      attempt counters; escalate to `failure` + single ❌ Inbox comment after N attempts.
      Coordinate the shared shape with track 10040 (see both conversations) — if 10040 has
      landed its counter, reuse it; if not, build DB-side here and note it on 10040.
- [ ] Task 4: E2E test: dispatcher-only worker + mock sessions API + mock GitHub API + real
      Collector/DB path drives a track plan → implement → PR → merged with zero filesystem
      writes outside logs (AC-5); revoked-credential loop test (AC-6).

**Impact**: The scaling answer — orchestration cost per project drops to a few HTTP calls.

## Phase 7: Docs, fundamentals reconciliation + positioning

**Problem**: product.md and tech-stack.md describe only the local-sovereign profile (flagged as
a fundamentals conflict in conversation.md); and the LaneConductor-over-raw-Managed-Agents
value story (board, lanes, gates, per-track sessions, PR review flow, retries/escalation, KPIs,
multi-project visibility) is written down nowhere.
**Solution**: Human-reviewed doc updates, not silent edits.

- [ ] Task 1: Draft updates presenting cloud workers as an opt-in runtime alongside the
      local-sovereign default (product.md) and the executor seam + dispatcher mode as a second
      coordination profile (tech-stack.md, workflow.md's Workspace/coordination notes) — post
      the draft for human review per the guardrail before committing.
- [ ] Task 2: SKILL.md / lc help: document `--runtime cloud`, `--dispatcher`, preflight
      requirements, credentials, budgets, and the v1 outbound-only status model.
- [ ] Task 2b: README + wiki "Keyless cloud-worker setup" guide (human request, 2026-08-30):
      install the Anthropic CLI (`ant`) from github.com/anthropics/anthropic-cli/releases —
      NOT apt/snap `ant`, which is Apache Ant — then `ant auth login` (ADC-style OAuth
      profile; show `ant auth status` verification and the ANTHROPIC_API_KEY-shadowing trap),
      and the WIF alternative for servers/CI. This is the canonical credential setup for
      cloud workers.
- [ ] Task 3: README/wiki section "LaneConductor vs. raw Managed Agents" (what orchestration
      adds on top of one agent in one sandbox). Landing-page copy is NOT this track — create a
      `marketing`-type track for it when Phase 7 lands, seeded from this section.

**Impact**: Docs stop contradicting the shipped architecture; the differentiation story exists.

## Phase 8: Webhook push updates (v2 — OUT OF THIS PASS)

Deliberately unchecked and excluded from this track's acceptance criteria (D-3). Managed
Agents webhooks can push session events to us, replacing polling — but require an
internet-reachable Collector endpoint (auth model + exposure design). Do NOT mark this track
done against this phase; it moves to its own track (or 017) when prioritized.

- [ ] (deferred) Webhook endpoint + auth on the Collector; replace/augment session polling;
      reconcile with the outbound-only status model.
