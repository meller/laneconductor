# Track AM-10105: New-project flow gaps found building Dual Reader

Eight findings, one phase each. Phases are independently shippable and
deliberately ordered so that shared infrastructure lands before its consumers:
**Phase 5 (migration runner) precedes Phase 1**, because Phase 1 needs a
migration and Phase 5 decides where migrations go.

Recommended commit order: 5 → 1 → 2 → 3 → 4 → 6 → 8 → 7.

---

## Phase 5: Migration runner + pending-migration detection

**Problem**: Two migration directories, no runner for either. The live DB is
nine Atlas migrations behind; `projects.file_manifest` is absent, so
`PATCH /worker/file-manifest` 500s on every worker start. Track 10060 hit the
same root cause on a different column and worked around the symptom.

**Solution**: Detect and report drift loudly at startup, apply the outstanding
migrations, and settle on one documented source of truth so the next migration
has an unambiguous home.

- [ ] Task 5.1: Decide and document the canonical migration path (REQ-10).
    - [ ] Audit both `migrations/` and `ui/server/migrations/` for overlap and
          for migrations present in one but not the other.
    - [ ] Record the decision and the reasoning in `conductor/tech-stack.md`'s
          Database section, which currently names only Atlas and is therefore
          already incomplete.
- [ ] Task 5.2: Write `conductor/services/migration-status.mjs` — pure, I/O
      injected, returning `{ pending, applied, behind }` (see spec's Data Models).
- [ ] Task 5.3: Report pending migrations on worker start and on API server
      start. Name each pending migration and the exact command to apply them.
      Non-fatal — this must warn, never block a worker from starting.
- [ ] Task 5.4: Apply the outstanding migrations to the local `laneconductor`
      DB, including `20260908120000_add_project_file_manifest.sql`.
- [ ] Task 5.5: Restart the worker and the API server, then confirm
      `PATCH /worker/file-manifest` returns 2xx and startup is clean.
      **Restart is mandatory** — neither process hot-reloads, so verifying
      against the already-running process is a false pass.

**Impact**: The recurring startup 500 stops. Schema drift becomes visible
before it produces its next 500 rather than after.

---

## Phase 1: Idempotent `resume()`

**Problem**: `ui/server/index.mjs:5830` does `SELECT` → check → `UPDATE` with
no atomicity and no request dedupe, which produced two concurrent `claude`
processes on one track in one worktree.

**Solution**: Let Postgres enforce the invariant — a single conditional
`UPDATE ... WHERE lane_action_status = 'waiting'` — plus an optional
`Idempotency-Key` for the cross-re-park case that state alone cannot catch.

- [ ] Task 1.1: Migration adding `tracks.last_resume_key` and
      `tracks.last_resumed_at`, in the canonical location Phase 5 established.
- [ ] Task 1.2: Replace the check-then-act pair with the single conditional
      `UPDATE ... RETURNING` from the spec.
- [ ] Task 1.3: Implement the response contract — 200 no-op for already
      `queue`/`running`, 200 no-op for a repeated `Idempotency-Key`, 409
      retained only for a genuinely stale caller view (REQ-1, REQ-2).
- [ ] Task 1.4: Update the endpoint's own leading comment. It currently argues
      *for* the 409-on-non-waiting behaviour; leaving it would make the new code
      read as a regression to the next person.
- [ ] Task 1.5: Concurrency test — fire N simultaneous resumes at one parked
      track, assert exactly one transition (TC-1.1).

**Impact**: A retried resume can no longer produce a second dispatch.

---

## Phase 2: Cross-process claim collision guard

**Problem**: `conductor/.runs/<track>.json` holds exactly one PID and
`isRunMarkerLive()` only asks whether *that* PID is alive. A second dispatch
overwrites the marker, making the first process invisible to every subsequent
liveness check.

**Solution**: Make the marker a claim rather than a note — refuse to overwrite
a live one — and add a process-scan cross-check so a run whose marker was
already clobbered is still detected.

- [ ] Task 2.1: `O_EXCL`-guarded marker write. Refuse when an existing marker's
      PID is live; replace (and log the replacement) when it is dead (REQ-4).
- [ ] Task 2.2: `scanLiveRunsForTrack(trackNumber)` — cross-reference the
      marker against a real process scan so a clobbered-marker run is still
      found (REQ-3).
- [ ] Task 2.3: Call it from every dispatch entry point, not just the
      conversation-reply path at `laneconductor.sync.mjs:8475` — the auto-queue
      claim path and explicit `worker_dispatch` need the same guard.
- [ ] Task 2.4: Unit tests with injected `isPidAlive` / `readProcessCommand`,
      matching `run-marker.mjs`'s existing injected-probe testing style.
- [ ] Task 2.5: Live verification — start a real run on a track, attempt a
      second dispatch, confirm refusal in the log and that only one process
      exists (`ps aux`).

**Impact**: Removes the precondition (two sessions per track) behind F1's
worst symptom, independently of whether Phase 1 holds.

---

## Phase 3: Answered-park routing + repeat-park guard

**Problem**: An answered `review:waiting` question re-entered the review lane
as a fresh session, re-reached the same conclusion, and re-asked the same
question three times in ten minutes with no error. Only `lc move` escaped.

**Solution**: Two independent fixes — route an answered park by the lane's
configured outcome, and make an unbounded repeat loop impossible regardless.

- [ ] Task 3.1 (F3a): On resuming a park that a human has answered, resolve the
      target from `workflow.json` for that lane's outcome rather than re-entering
      the parking lane (REQ-5). For `review` this yields `implement:queue` —
      the existing `review.on_failure` value, finally reachable from a park.
- [ ] Task 3.2 (F3a): Ensure the answering human's reply is actually delivered
      to the resumed run. A fresh session that never reads the answer is the
      observed failure; the routed run must see it.
- [ ] Task 3.3 (F3b): Park streak counter, reusing
      `prespawn-block-counter.mjs`'s shape exactly — cause-keyed, cause-change
      reset, human resume resets, DB column when available and sibling file
      otherwise (REQ-6).
- [ ] Task 3.4 (F3b): Escalate at threshold to `<lane>:failure` with an
      explanatory `❌` comment naming the repeated cause.
- [ ] Task 3.5: Regression test reproducing the exact live loop — park, answer,
      assert the track routes forward and the same question is not re-asked.

**Impact**: The loop that needed manual `lc move` to escape resolves itself,
and any *future* park loop terminates visibly rather than silently.

---

## Phase 4: `remote-sync` folder resolution + DB/file drift

**Problem**: `conductor/remote-sync.mjs:124` matches only `/^(\d+)-/`, so
`lc worker sync` reports `Track folder not found` for every prefixed-convention
track — i.e. every track in every new project. Separately, hand-edited track
files never reach the DB, leaving the UI actively misleading with no signal.

**Solution**: Use the canonical resolver, and make drift either self-correcting
or loud.

- [ ] Task 4.1 (F4a): Replace `findTrackFolder()` with
      `resolveTrackFolderFs()` from `conductor/services/track-folder-fs.mjs`,
      the same resolver `lc track-dir` and the worker use (REQ-7). Do not write
      a third regex — that is what produced this bug.
- [ ] Task 4.2 (F4a): Audit for further copies of the legacy-only
      `/^(\d+)-/` pattern. This is the second recurrence of track 10040's
      Finding 6; assume it is not the last.
- [ ] Task 4.3 (F4b): Detect file↔DB drift on the worker's periodic tick and
      either reconcile it or emit a visible warning naming the drifted track and
      fields (REQ-8).
- [ ] Task 4.4 (F4b): Document the hand-edit → resync path in `SKILL.md`, and
      make that path actually work — Task 4.1 is a precondition, since the
      documented command was broken.
- [ ] Task 4.5: Verify against a project using `INITIALS-NNN-slug` folders —
      zero spurious `Track folder not found` (AC-6).

**Impact**: The documented recovery command works. A stale card stops being
invisible.

---

## Phase 6: Deployment conventions doc

**Problem**: Every LaneConductor-built product shares one GCP project
(`laneconductor-site`) as its own Hosting site + Functions codebase. Nothing
says so. The natural assumption — a dedicated project per product — is wrong
and exhausts GCP project quota.

**Solution**: Write it down where a scaffolding new project will actually see it.

- [ ] Task 6.1: Write `conductor/deployment-conventions.md`: the shared-project
      rule, how a new product gets its Hosting site and Functions codebase,
      naming conventions, and why a dedicated GCP project is wrong here.
- [ ] Task 6.2: Capture the concrete evidence — the actual `.firebaserc` /
      `firebase.json` shape a sibling product uses — so a reader does not have to
      re-derive it by hand the way this finding's author did.
- [ ] Task 6.3: Reference it from the scaffold path (`lc setup-deploy` and
      `SKILL.md`'s `deployment-stack.md` stub) so it is reachable without
      knowing it exists (REQ-11).
- [ ] Task 6.4: Note the existing track-10052 Firebase Hosting rewrite gap
      (`/prefix**` vs `/prefix/**`) here too — it is the same surface and a new
      product will hit it.

**Impact**: A new product's deployment topology stops being folklore.

---

## Phase 8: Plan→implement auto-advance decision

**Problem**: Canonical `conductor/workflow.json` sets
`plan.on_success: "plan:success"`, a terminal resting state. Every track in a
fresh project stops after planning. `Auto Run: yes` does not change this, and
nothing explains the pause.

**Decision required from the author — three options:**

| | Option | Effect | Risk |
|---|---|---|---|
| A | Change canonical `plan.on_success` to `implement:queue` | Fresh projects flow plan→implement automatically | Every new project auto-implements unattended; contradicts `workflow.md`'s safe-default stance for unattended runs |
| **B** | **Keep the pause; make it legible + one-click resumable, and document `Auto Run`'s real scope** | **"Stuck" becomes "paused, here's why, click to continue"** | **None — behaviour-preserving for every existing project** |
| C | Make it a scaffold-time prompt | Explicit per-project choice at creation | One more setup question; does not help existing projects |

**Recommendation: B**, optionally plus C later. A is a real safety regression:
`conductor/workflow.md` is explicit that `branch`/unattended defaults stay
conservative, and A makes every fresh project autonomously implement every
planned track with nobody watching. B removes the actual reported harm — the
silence — without taking that risk, and is reversible.

- [ ] Task 8.1: Implement Option B — surface `plan:success` in the UI as an
      explicit paused state with the reason and a resume affordance (REQ-13).
- [ ] Task 8.2: Correct the `Auto Run` documentation in `SKILL.md` and
      `workflow.md` to state plainly that it governs *queue claiming only* and
      never implies lane auto-advance. Half this finding is a documentation
      defect.
- [ ] Task 8.3: Note in `conductor/workflow.md` that `plan.on_success` is the
      knob, and how to change it correctly — via
      `POST /api/projects/:id/workflow`, because a plain file edit is silently
      reverted by the next DB→file sync.
- [ ] Task 8.4: **Do not proceed past 8.1 with Option A or C without the
      author's explicit decision.** Record whichever is chosen here.

**Impact**: The universal "stuck after planning" symptom becomes a legible,
one-click state — without silently enabling unattended autonomy.

---

## Phase 7: Neon MCP auth diagnosis

**Problem**: `Neon (AUTH_HEADER_REJECTED)` — HTTP 401 `invalid_token`, with the
server reporting "No authorization provided" *despite* the client having sent an
`Authorization` header (which is what disabled OAuth fallback). Reproduced in
this planning session.

**Solution**: Diagnose to a stated root cause. The self-contradiction points at
a malformed or unsubstituted header value rather than an expired token —
reinforced by `plugin:github:github` failing in the same session with
`Authorization header is badly formatted`, suggesting one shared MCP config
defect rather than two independent stale credentials.

- [ ] Task 7.1: Inspect the MCP config for both servers. Check specifically for
      an unexpanded `${VAR}` placeholder or a missing `Bearer ` prefix — the two
      defects that produce exactly this error pair.
- [ ] Task 7.2: Determine whether the token is stale or the header is malformed.
      These need opposite fixes; do not guess.
- [ ] Task 7.3: Fix if the cause is a config defect the agent can correct.
- [ ] Task 7.4: If it requires a credential the agent does not hold, document
      the exact remediation steps and who must perform them (REQ-12).
      **This is an acceptable terminal outcome for this phase**, stated
      explicitly so it is not mistaken for an unfinished task — but it must be a
      stated finding, not silence.

**Impact**: Either the integration works, or its breakage is a known,
actionable item instead of an unexplained 401.

---

## Notes

- **Phase ordering is load-bearing**: Phase 5 before Phase 1 (migration home),
  Task 4.1 before Task 4.4 (the documented command must work before it is
  documented).
- **Restart long-running processes before verifying.** The worker and API
  server do not hot-reload. This has produced several false passes in this repo
  and is directly relevant to Phases 1, 2, 3, and 5.
- **Phase 7's scope is diagnosis.** It may legitimately end without a fix. No
  other phase may.
- Per this repo's own test-hygiene history, check `ps aux | grep
  laneconductor.sync.mjs` for orphaned workers after any full test run, and
  `readlink /proc/<pid>/cwd` before calling any of them a leak — there is
  normally one worker per project.
