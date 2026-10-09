# Tests: Track AM-10105 — New-project flow gaps found building Dual Reader

## Test Commands

```bash
# Worker / service unit + E2E tests (node:test — spawns real processes)
node --test conductor/tests/track-10105-resume-idempotency.test.mjs
node --test conductor/tests/track-10105-run-marker-collision.test.mjs
node --test conductor/tests/track-10105-park-routing.test.mjs
node --test conductor/tests/track-10105-migration-status.test.mjs
node --test conductor/tests/track-10105-remote-sync-folder.test.mjs

# Mocked unit/integration suite (Vitest)
cd ui && npx vitest run

# Live schema check
PGPASSWORD=postgres psql -h localhost -U postgres -d laneconductor -tAc \
  "select column_name from information_schema.columns
    where table_name='projects' and column_name like 'file_manifest%';"
```

> **Test-hygiene rules for this repo** (learned the hard way, see the incidents
> referenced in `plan.md`'s Notes):
> - After any `node --test` or full `vitest run`, check `ps aux | grep
>   laneconductor.sync.mjs` for leaked workers. Before calling one a leak, run
>   `readlink /proc/<pid>/cwd` — there is normally one worker per project.
> - Do **not** run worker-spawning `node --test` files from inside a track
>   worktree. They silently redirect to the primary checkout. A run where every
>   subtest times out on "worker registered" is this, not a regression — grep
>   the log for `which is not the primary checkout`.
> - **Restart the worker and API server before verifying any phase.** Neither
>   hot-reloads; verifying against a stale process is a false pass.

---

## Test Cases

### Phase 5: Migration runner + pending-migration detection

- [ ] TC-5.1: `migrationStatus()` with applied `[...20260825120000]` and nine
      later files on disk — expected: `behind: 9`, `pending` lists exactly those
      nine in version order.
- [ ] TC-5.2: `migrationStatus()` with an up-to-date DB — expected:
      `behind: 0`, `pending: []`.
- [ ] TC-5.3: A migration file present on disk but with a *lower* version than
      an applied one (an out-of-order merge) — expected: reported as pending, not
      silently skipped.
- [ ] TC-5.4: Worker start against a behind DB — expected: a warning naming each
      pending migration and the apply command; worker **still starts** (warn,
      never block).
- [ ] TC-5.5: Worker start against an up-to-date DB — expected: no new output.
- [ ] TC-5.6 *(live, post-apply, post-restart)*: `psql` shows
      `file_manifest`, `file_manifest_digest`, `file_manifest_updated_at` on
      `projects` — expected: all three present.
- [ ] TC-5.7 *(live)*: `PATCH /worker/file-manifest` — expected: 2xx, and a full
      worker startup log containing zero `file_manifest ... does not exist`
      errors. **AC-8, AC-9.**

### Phase 1: Idempotent `resume()`

- [ ] TC-1.1: 10 concurrent `POST .../resume` on one parked track — expected:
      exactly one row transition (assert via a DB-side counter or by observing a
      single dispatch), zero 5xx, and every response a success. **AC-1.**
- [ ] TC-1.2: Sequential resume on a track already at `queue` — expected: 200
      with `noop: true, already_resumed: true`, and no second transition.
- [ ] TC-1.3: Resume on a track at `running` — expected: 200 `noop: true`; no
      second dispatch.
- [ ] TC-1.4: Two calls with the **same** `Idempotency-Key`, separated by a real
      re-park in between — expected: second returns
      `noop: true, duplicate_request: true`; exactly one transition total.
- [ ] TC-1.5: Two calls with **different** `Idempotency-Key`s, separated by a
      real re-park — expected: both resume. Idempotency must not become
      "resume once, ever". **AC-2.**
- [ ] TC-1.6: Resume on a track at `success` — expected: 409 retained (a
      genuinely stale caller view).
- [ ] TC-1.7: Resume on a nonexistent track — expected: 404, unchanged.
- [ ] TC-1.8: Resume with **no** `Idempotency-Key` header — expected: today's
      behaviour plus the atomic CAS; no client change required for AC-1.

### Phase 2: Cross-process claim collision guard

- [ ] TC-2.1: Write a run marker for track N while an existing marker's PID is
      live (injected `isPidAlive` → true) — expected: write refused, existing
      marker byte-unchanged. **AC-3.**
- [ ] TC-2.2: Same, with the existing marker's PID dead — expected: marker
      replaced, replacement logged.
- [ ] TC-2.3: `scanLiveRunsForTrack()` when the marker was clobbered but a real
      process for track N is still running — expected: the live run is detected
      anyway (this is the case a marker-only check misses).
- [ ] TC-2.4: `scanLiveRunsForTrack()` with no live process — expected: no
      false positive; dispatch proceeds.
- [ ] TC-2.5: PID-reuse guard — marker PID alive but its command no longer
      matches — expected: treated as not-live, consistent with
      `isRunMarkerLive()`'s existing semantics.
- [ ] TC-2.6: Each dispatch entry point (auto-queue claim, `worker_dispatch`,
      conversation reply) refuses a second dispatch for a track with a live run —
      expected: all three refuse. A guard on only one path does not satisfy AC-3.
- [ ] TC-2.7 *(live)*: Start a real run on a track, attempt a second dispatch —
      expected: refusal in the log, and `ps aux` shows exactly one agent process
      for that track. **AC-3.**

### Phase 3: Answered-park routing + repeat-park guard

- [ ] TC-3.1: A `review:waiting` park with a human answer in `conversation.md` —
      expected: the track routes to `workflow.json`'s `review.on_failure`
      (`implement:queue`), not back into `review`. **AC-4.**
- [ ] TC-3.2: The routed run receives the human's answer — expected: the answer
      text is present in the run's context. A fresh session that never sees it is
      the exact live failure.
- [ ] TC-3.3: Regression for the live loop — park, answer, park, answer —
      expected: the same question is **not** re-asked by a fresh review session.
      **AC-4.**
- [ ] TC-3.4: Park streak counter increments on a repeat park with the same
      cause — expected: count 1 → 2 → 3.
- [ ] TC-3.5: Streak resets on a **different** park cause — expected: back to 1
      (matches `prespawn-block-counter.mjs`'s cause-change semantics).
- [ ] TC-3.6: Streak resets on a human resume — expected: back to 0.
- [ ] TC-3.7: Streak reaching threshold — expected: track lands at
      `<lane>:failure` with a `❌` comment naming the repeated cause. **AC-5.**
- [ ] TC-3.8: A park on a lane with **no** configured `on_failure` — expected:
      handled without throwing; no silent infinite loop.

### Phase 4: `remote-sync` folder resolution + DB/file drift

- [ ] TC-4.1: `remote-sync` against tracks in `INITIALS-NNN-slug` folders —
      expected: all resolve; zero `Track folder not found`. **AC-6.**
- [ ] TC-4.2: `remote-sync` against legacy `NNN-slug` folders — expected: still
      resolve (no regression).
- [ ] TC-4.3: Mixed-convention project — expected: both resolve in one run.
- [ ] TC-4.4: Ambiguous case (both `10105-x/` and `AM-10105-y/` exist) —
      expected: resolves identically to `lc track-dir 10105`. The two must not
      disagree; that divergence is what this bug class is.
- [ ] TC-4.5: Genuinely missing folder — expected: `Track folder not found`
      still warns (the warning is correct here; only the false positives were wrong).
- [ ] TC-4.6: Repo-wide grep for the legacy-only pattern — expected: no
      remaining `/^(\d+)-/` track-folder matcher outside the canonical resolver.
- [ ] TC-4.7: Hand-edit a track's `index.md` on disk (lane + progress), wait one
      worker tick — expected: the UI shows the real lane and progress, **or** a
      visible warning names the drifted track and fields. A silently stale card
      fails. **AC-7.**

### Phase 6: Deployment conventions doc

- [ ] TC-6.1: `conductor/deployment-conventions.md` exists and states the
      one-shared-GCP-project (`laneconductor-site`) rule explicitly. **AC-10.**
- [ ] TC-6.2: It contains a concrete `.firebaserc` / `firebase.json` example for
      adding a new product as a Hosting site + Functions codebase.
- [ ] TC-6.3: It states plainly that a dedicated GCP project per product is
      **wrong** here, and why (quota exhaustion) — the wrong default must be
      named, not merely omitted.
- [ ] TC-6.4: The scaffold path references it — a newly scaffolded project's
      `deployment-stack.md` stub points to it. **AC-10.**
- [ ] TC-6.5: The track-10052 Hosting rewrite gap (`/prefix**` vs `/prefix/**`)
      is noted.

### Phase 8: Plan→implement auto-advance decision

- [ ] TC-8.1: A track reaching `plan:success` in a fresh project — expected: the
      UI shows an explicit paused state with a reason and a resume affordance,
      not a silently inert card. **AC-12.**
- [ ] TC-8.2: The resume affordance actually advances the track to
      `implement:queue` — expected: one transition, one dispatch (and, per
      Phase 1, safe to double-click).
- [ ] TC-8.3: `SKILL.md` and `workflow.md` state that `Auto Run` governs queue
      claiming only and never implies lane auto-advance. **REQ-13.**
- [ ] TC-8.4: `workflow.md` documents `plan.on_success` as the knob and names
      `POST /api/projects/:id/workflow` as the correct way to change it (a plain
      file edit is reverted by the next DB→file sync).
- [ ] TC-8.5: No existing project's effective `plan.on_success` changes —
      expected: byte-identical behaviour for every project that already exists.
- [ ] TC-8.6: The author's decision among Options A/B/C is recorded in
      `plan.md`. Options A and C are not implemented without it.

### Phase 7: Neon MCP auth diagnosis

> Diagnosis phase. A documented, unfixed root cause is an acceptable pass here
> and **only** here.

- [ ] TC-7.1: The MCP config for `Neon` and `plugin:github:github` has been
      inspected for an unexpanded `${VAR}` placeholder and a missing `Bearer `
      prefix — expected: a stated finding either way.
- [ ] TC-7.2: A stated root cause distinguishing "stale token" from "malformed
      header" — expected: one or the other, with evidence. Not "possibly either".
- [ ] TC-7.3: Either the Neon MCP server connects successfully, **or**
      remediation steps and the responsible party are documented. **AC-11.**
- [ ] TC-7.4: Whether the GitHub MCP failure shares the same root cause is
      stated — the hypothesis is one shared config defect, so confirm or reject it.

---

## Acceptance Criteria

- [ ] All twelve ACs in `spec.md` verified against real, observed output —
      not inferred from a diff.
- [ ] Every test command above executed, with its actual output reviewed.
- [ ] Worker and API server restarted before any live verification.
- [ ] No orphaned `laneconductor.sync.mjs` processes left behind
      (`ps aux` + `readlink /proc/<pid>/cwd` before declaring a leak).
- [ ] Stub scan clean in every code path this track marks `[x]`:
      `grep -rniE "not yet implemented|TODO|FIXME|FFU" conductor ui bin | grep -v node_modules`
- [ ] No regression in the existing suites: `node --test conductor/tests/` and
      `cd ui && npx vitest run`.
- [ ] Phase 8's Option A/C decision recorded, or Option B shipped alone with the
      decision explicitly still open.
- [ ] Phase 7's outcome stated — fixed, or documented with remediation steps.
