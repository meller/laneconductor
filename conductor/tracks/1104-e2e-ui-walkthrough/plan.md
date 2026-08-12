# Track 1104: End-to-end walkthrough — UI (browser)

## Phase 1: Walk the path in a real browser against a clean project

**Problem**: The only prior walkthrough (track 1102) was found by accident,
mid-way through a different task, with no deliberate recording. This phase
does it on purpose, end to end, for the UI specifically.
**Solution**: Drive a real browser session (Playwright browser tools) against
a clean, newly-created project, following exactly the UI-specific path listed
in `index.md`, recording the *observed* result of every step.

- [ ] Set up a clean throwaway project directory (not an existing
      LaneConductor project) to walk the New Project wizard against
- [ ] Confirm the LaneConductor UI (`:8090`) and API (`:8091`) are running
      locally before starting
- [ ] Step through the New Project wizard (`+ Project`) end to end; record
      the actual screens, fields, and responses observed
- [ ] Confirm project registration (`repo_path` set, appears in project
      selector) and check the resulting directory's git-repo state (link
      to 1102 F7 if it's not a repo / has no commits)
- [ ] Confirm all 9 context files were generated for the new project
- [ ] Confirm whether/which worker started, and what the UI shows about its
      machine and mode (manual/automatic) — record if this is not shown
- [ ] Use the Project selector to select the new project
- [ ] Use `+ Track` modal to create a track; confirm all 5 files
      (`index`, `spec`, `plan`, `test`, `conversation`) are scaffolded with
      a real, non-stub `test.md`
- [ ] Trigger the Plan lane action from the track card's own controls (not
      curl/API); watch the Activity panel live while it runs
- [ ] Confirm the track reaches `plan/success`, or record the exact failure
      mode observed (cross-reference 1102 F5/F8 if it matches)
- [ ] Open the track detail drawer afterward and confirm the transcript /
      conversation is readable
- [ ] Walk the Inbox and record what it shows for this session's activity
- [ ] Walk the CI/CD tab and deploy wizard through to (but not including)
      an actual deploy; record each screen
- [ ] Deliberately trigger at least one failure (e.g. a lane action on a
      project known to be broken) and record whether/how the UI surfaces it
- [ ] Keep a single running session log of every step's OBSERVED result
      (not the intended result) — this log is the source for Phase 4

**Impact**: Produces the first deliberate, recorded run of the UI path —
raw material for Phases 2-5.

## Phase 2: File/fix what breaks

**Problem**: Findings discovered during Phase 1 need to land somewhere
durable instead of staying in a session log, and duplicating track 1102's
already-known bugs wastes effort.
**Solution**: Cross-reference every observed break against 1102's F1-F8
findings; link rather than duplicate. File genuinely new findings. Fix what's
small and local to this track's own scope.

- [ ] Cross-reference every Phase 1 break against 1102 F1-F8; link matches
      directly rather than re-describing them
- [ ] File new findings (F9, F10, ...) in 1102 (or here, cross-linked) for
      anything not already covered
- [ ] Fix anything trivial and local to this track's scope directly; leave
      larger fixes referenced in 1102 rather than scope-creeping this track

**Impact**: Findings from this specific walkthrough are captured without
duplicating track 1102's tracking.

## Phase 3: Note every state the UI fails to represent

**Problem**: Track 1103's design (Phase 4: UI affordances) needs a concrete
list of exactly which states the UI currently leaves invisible, not a vague
sense that "some things are unclear."
**Solution**: Enumerate the specific unrepresented states hit during Phase 1
and hand them to 1103 as design input.

- [ ] Enumerate: no worker running, project not a git repo, a lane action
      failed, which machine a worker is on — for each, note exactly what
      the UI showed instead (nothing changes indicator? stale success
      state? generic error?)
- [ ] Record each as an explicit gap in this file, tagged for track 1103
      Phase 4
- [ ] Reference this list from track 1103 (comment or note) so the design
      track can consume it directly

**Impact**: Track 1103 Phase 4 has real, observed input instead of
speculation.

## Phase 4: Write the walkthrough up as the wiki's UI guide

**Problem**: A guide written from memory can describe steps that don't
actually work; the point of this track is that it can't.
**Solution**: Transcribe the Phase 1 session log into the wiki UI guide
(feeds track 1103 Phase 5), preserving the rough edges that survived.

- [ ] Turn the Phase 1 session log into the wiki UI walkthrough guide
      (track 1103 Phase 5's location)
- [ ] Include real commands/screens/outputs, not idealized versions
- [ ] Cross-link findings (Phase 2) and unrepresented states (Phase 3)
      inline where relevant to the step that surfaced them

**Impact**: A wiki guide that is provably accurate because it's a
transcription, not a description.

## Phase 5: Encode it as a Playwright spec in track 1100's fast tier

**Problem**: A guide, however accurate today, rots the moment the UI
changes underneath it with no automated check.
**Solution**: Turn the documented path into a Playwright spec added to
track 1100's fast tier so it runs on every change.

- [ ] Confirm track 1100's fast tier is green and usable before adding to
      it (this phase depends on 1100)
- [ ] Write a Playwright spec walking the Phase 4 documented UI path
- [ ] Add the spec to the fast tier

**Impact**: The walkthrough becomes a regression test, not just documentation.
