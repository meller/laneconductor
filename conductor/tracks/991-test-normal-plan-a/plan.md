# Track 991: Test Normal Plan A

## Phase 1: Plan-lane artifacts ✅ COMPLETE

**Problem**: The track carried only stub content (`# Spec / Test Spec`, a
single unnamed `Task 1`) and had no `test.md` or `conversation.md` at all — a
plan run over it proved nothing.
**Solution**: Produce the full planning artifact set for the canary, with
acceptance criteria describing observable outcomes rather than scaffolding.

- [x] Task 1: Claim the track (`**Lane**: plan`, `**Lane Status**: running`)
- [x] Task 2: Write `spec.md` — problem, requirements REQ-1..REQ-5, acceptance criteria
- [x] Task 3: Write `plan.md` with a verifiable implement phase
- [x] Task 4: Write `test.md` with runnable cases per phase (REQ-1)
- [x] Task 5: Create `conversation.md` and transition per `workflow.json`

**Impact**: Track 991 becomes a real canary instead of a placeholder — the
plan lane now has something to regress against.

## Phase 2: Canary marker ⏳

**Problem**: Downstream lanes (`implement`, `review`, `quality-gate`) need a
concrete artifact to act on; an empty track passes every gate vacuously.
**Solution**: Write one marker file with exact known content — the same trick
track 999 used with `canary.txt`.

- [ ] Task 1: Write `conductor/tracks/991-test-normal-plan-a/canary-a.txt`
      containing exactly `Normal Plan A OK` (single line, trailing newline)
    - [ ] Sub-task: Confirm by reading the file back, not by assuming the write
- [ ] Task 2: Update `index.md` `**Progress**` to 100% and append the
      implement-completion comment to `conversation.md`
- [ ] Task 3: Commit as `feat(track-991): Phase 2 - canary marker`

**Impact**: `review` and `quality-gate` can assert against real file content, so
a false pass in those lanes becomes detectable.

## Phase 3: Flow assertions ⏳

**Problem**: The markers and comment format are exactly what silently breaks
(a comment not in `> **system**:` format never reaches the UI, with no error).
**Solution**: Assert the end state of the flow itself.

- [ ] Task 1: Verify `index.md` lane markers match `workflow.json`'s
      `lanes.plan.on_success`
- [ ] Task 2: Verify `conversation.md` entries parse as syncable comments
- [ ] Task 3: Run the test commands in `test.md` and record the real output
- [ ] Task 4: Re-check OPEN-1 in `spec.md` — confirm TC-3.3/TC-3.6 still match
      the worker's actual progress-forcing behavior at that point in time

**Impact**: Marker/comment regressions surface here instead of in a real track.
