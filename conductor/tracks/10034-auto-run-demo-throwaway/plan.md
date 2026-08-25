# Track 10034: Auto-run demo (throwaway)

> **No product code is written by this track.** Every phase below produces
> observation and evidence. If a phase tempts you to edit
> `laneconductor.sync.mjs`, `claim-scope.mjs`, the UI, or the CLI — stop, write
> the finding into `spec.md`'s *Observations*, and file a separate track.

## Phase 1: Establish the observation setup

**Problem**: A live demo is worthless if you can't see the claim happen or prove
the worker was in the right mode when it did.
**Solution**: Pin down the worker's mode and get all three observation surfaces
(worker log, `lc status`, Kanban board) open before anything is claimed.

- [ ] Task 1.1: Get the worker running in AUTOMATIC mode. `lc worker status` at
      planning time reported **`❌ STOPPED`** with `Mode: AUTOMATIC (sync+poll)`
      — the mode is right but nothing is running, so it must be started with
      `lc worker start --sync-and-work`. **`--sync-and-work` is not optional**:
      the CLI default is MANUAL (`--sync-only`), and a MANUAL worker claims
      nothing, which would make the entire demo a silent false negative.
      Confirm via `lc worker status` (`✅ RUNNING`) and the startup line
      `[LaneConductor] Worker mode: sync+poll`.
- [ ] Task 1.2: Confirm the Kanban UI is up at `localhost:8090` and this track's
      card is visible (`lc ui start` if needed).
- [ ] Task 1.3: Record the starting state: this track's `**Lane**`,
      `**Lane Status**`, `**Auto Run**`, and the matching DB row.

**Impact**: Observation is trustworthy; a claim can't be confused with a
coincidence.

## Phase 2: Demonstrate the positive case (REQ-1, REQ-2)

**Problem**: Show that an opted-in queued track is claimed autonomously.
**Solution**: Put this track into `queue`, then touch nothing and watch.

- [ ] Task 2.1: Set this track's `**Lane Status**: queue` with `**Auto Run**:
      yes` still present, then **stop interacting with it**.
- [ ] Task 2.2: Watch `conductor/.sync.log` for the claim and the actual CLI
      spawn for track 10034. Capture the verbatim lines.
- [ ] Task 2.3: Capture the board state at `localhost:8090` (screenshot) and the
      `lc status` output at the same moment — they must agree (AC-2).
- [ ] Task 2.4: Paste the captured log lines and observed state into
      `conversation.md` as a single `> **system**:` comment.

**Impact**: AC-1, AC-2, AC-4 satisfied with real evidence, not inference.

## Phase 3: Demonstrate the gate (REQ-3)

**Problem**: A spawn alone doesn't prove `**Auto Run**` gates anything — a
worker that claims everything would look identical.
**Solution**: Run the negative case alongside it.

- [ ] Task 3.1: Create a scratch track (`lc new`) left at its default — no
      `**Auto Run**` marker — and put it in `queue`.
- [ ] Task 3.2: Let the worker run through several poll cycles while it claims
      10034, then confirm the scratch track is still `queue` and was never
      spawned (absence in `.sync.log`).
- [ ] Task 3.3: Record the negative result in `conversation.md`; delete the
      scratch track (`lc delete`).

**Impact**: AC-3 satisfied — the demo shows a gate, not just an auto-claimer.

## Phase 4: Write up findings

**Problem**: Live runs surface things mocks don't; those findings are the only
lasting value this throwaway track has.
**Solution**: Capture them before deleting anything.

- [ ] Task 4.1: Append any new defect/rough edge to `spec.md`'s *Observations*
      section, each with a named follow-up track suggestion (AC-5).
- [ ] Task 4.2: Confirm the already-banked observation still stands — the
      repeated-identical `main`-mode blocked notice (19x in this track's own
      `conversation.md`) has no dedup or backoff. Decide with a human whether it
      gets its own track.

**Impact**: The demo leaves knowledge behind even though the track is discarded.

## Phase 5: Teardown (REQ-5)

**Problem**: A throwaway track that isn't thrown away becomes permanent clutter
and keeps getting auto-claimed.
**Solution**: Remove it completely, and verify the removal.

- [ ] Task 5.1: **Do not run this phase until a human confirms** the evidence in
      Phases 2–4 is captured — deletion is irreversible (`lc delete` is a hard
      delete, no undo).
- [ ] Task 5.2: `lc delete 10034` — removes folder, DB row, and git lock.
- [ ] Task 5.3: Verify: `conductor/tracks/10034-*/` gone, no DB row for 10034,
      no `10034` lock file, and `lc worker status` still healthy (AC-6).

**Impact**: The project is left exactly as it was before the demo.
