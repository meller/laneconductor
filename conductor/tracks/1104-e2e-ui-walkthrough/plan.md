# Track 1104: End-to-end walkthrough — UI (browser)

## Phase 1: Walk the path in a real browser against a clean project

**Problem**: The only prior walkthrough (track 1102) was found by accident,
mid-way through a different task, with no deliberate recording. This phase
does it on purpose, end to end, for the UI specifically.
**Solution**: Drive a real browser session (Playwright browser tools) against
a clean, newly-created project, following exactly the UI-specific path listed
in `index.md`, recording the *observed* result of every step.

- [x] Set up a clean throwaway project directory (not an existing
      LaneConductor project) to walk the New Project wizard against
- [x] Confirm the LaneConductor UI (`:8090`) and API (`:8091`) are running
      locally before starting
- [x] Step through the New Project wizard (`+ Project`) end to end; record
      the actual screens, fields, and responses observed — see
      `session-log.md` Steps 0-1
- [x] Confirm project registration (`repo_path` set, appears in project
      selector) and check the resulting directory's git-repo state — is a
      real git repo with an initial commit (1102 F7 confirmed **fixed**)
- [x] Confirm all 9 context files were generated for the new project — all
      9 present and non-empty
- [x] Confirm whether/which worker started, and what the UI shows about its
      machine and mode (manual/automatic) — **works well**: hostname,
      `SYNC-ONLY` badge, project scope, model all shown in the WORKERS bar
- [x] Use the Project selector to select the new project
- [x] Use `+ Track` modal to create a track; confirm all 5 files
      (`index`, `spec`, `plan`, `test`, `conversation`) are scaffolded with
      a real, non-stub `test.md` — confirmed on disk
- [x] Trigger the Plan lane action from the track card's own controls (not
      curl/API); watch the Activity panel live while it runs — dispatch
      created and claimed correctly (1102 F5 confirmed **fixed**)
- [x] Confirm the track reaches `plan/success`, or record the exact failure
      mode observed — **did not reach plan/success**: the dispatched agent
      completed the plan successfully inside its worktree, but the result
      never merged back to the tracked files/DB, leaving the track stuck at
      `running` forever with `lane_action_result: stuck_timeout`. New
      finding filed as **1102 F9** (distinct root cause from F8, same
      symptom)
- [x] Open the track detail drawer afterward and confirm the transcript /
      conversation is readable — Transcript panel is excellent; Logs tab is
      readable but raw JSONL; Conversation tab correctly empty
- [x] Walk the Inbox and record what it shows for this session's activity —
      "No active conversations" (accurate, no finding)
- [x] Walk the CI/CD tab and deploy wizard through to (but not including)
      an actual deploy; record each screen — reached wizard step 1
      (Provider selection), stopped there
- [x] Deliberately trigger at least one failure (e.g. a lane action on a
      project known to be broken) and record whether/how the UI surfaces it
      — the stuck plan run (above) served as this; the UI shows only an
      ever-escalating "stale Ns" timer, never an actual failure state
- [x] Keep a single running session log of every step's OBSERVED result
      (not the intended result) — this log is the source for Phase 4 — see
      `conductor/tracks/1104-e2e-ui-walkthrough/session-log.md`

**Impact**: Produces the first deliberate, recorded run of the UI path —
raw material for Phases 2-5.

## Phase 2: File/fix what breaks

**Problem**: Findings discovered during Phase 1 need to land somewhere
durable instead of staying in a session log, and duplicating track 1102's
already-known bugs wastes effort.
**Solution**: Cross-reference every observed break against 1102's F1-F8
findings; link rather than duplicate. File genuinely new findings. Fix what's
small and local to this track's own scope.

- [x] Cross-reference every Phase 1 break against 1102 F1-F8; link matches
      directly rather than re-describing them — F5 and F7 re-verified live
      and marked **fixed** in 1102; the one break found (stuck worktree
      merge-back) shares F8's *symptom* but has a distinct *cause*
- [x] File new findings (F9, F10, ...) in 1102 (or here, cross-linked) for
      anything not already covered — filed **1102 F9** (worktree plan run
      succeeds but never merges back; UI shows only an escalating "stale"
      timer, no failure state)
- [x] Fix anything trivial and local to this track's scope directly; leave
      larger fixes referenced in 1102 rather than scope-creeping this
      track — F9's fix (reconciling orphaned worktrees on worker
      startup/heartbeat) is not trivial/local; left for 1102, not
      attempted here

**Impact**: Findings from this specific walkthrough are captured without
duplicating track 1102's tracking.

## Phase 3: Note every state the UI fails to represent

**Problem**: Track 1103's design (Phase 4: UI affordances) needs a concrete
list of exactly which states the UI currently leaves invisible, not a vague
sense that "some things are unclear."
**Solution**: Enumerate the specific unrepresented states hit during Phase 1
and hand them to 1103 as design input.

- [x] Enumerate: no worker running, project not a git repo, a lane action
      failed, which machine a worker is on — for each, note exactly what
      the UI showed instead
- [x] Record each as an explicit gap in this file, tagged for track 1103
      Phase 4 — see table below
- [ ] Reference this list from track 1103 (comment or note) so the design
      track can consume it directly — pending; post a comment on 1103
      pointing here once this track's lane action can be triggered through
      the UI per the dogfooding rule

### Unrepresented-state inventory (input for track 1103 Phase 4)

| State | What the UI shows today | Gap |
|---|---|---|
| No manager worker registered | A clear, blocking modal with the exact fix command and target machine name | **None — this one is done right.** Good reference for how the others should look. |
| Which machine / mode a worker is on | WORKERS bar: hostname, `MANAGER`/`SYNC-ONLY` badge, project scope, model | **None — also done right** (reference-outcome point #4, confirmed working live). |
| Project is not a git repo | N/A in this session — 1102 F7 is now fixed, so this state is no longer reachable via the wizard. Still worth 1103 designing for, since a project added via "Git URL to clone" pointing at a bad/empty remote, or a manually-authored `.laneconductor.json`, could still hit it — 1102's original F7 evidence (a `git worktree add` failure buried in worker logs, invisible in the UI) is the last known observation of this state. | The UI has no rendering for "this project isn't a repo" at all — worth a dedicated design even though the common trigger is now closed off. |
| A lane action is running vs. stuck | A `stale Ns` counter that counts up and shifts yellow → red, forever, with no ceiling and no resulting state change | **Confirmed gap (1102 F9).** "Stale" never resolves into "failed" — there is no terminal error state a user can act on (retry / see why / dismiss). The counter itself is a good *signal*; it just never leads anywhere. |
| A lane action failed (exception during setup, e.g. F8's worktree-lock case) | Board keeps showing `running`; Activity panel shows the worker `idle` — the two panels contradict each other | **Confirmed gap (1102 F8, re-observed via F9's different trigger).** No error text, no distinction between "still working" and "broken," surfaced anywhere in the UI. |
| A lane action succeeded but didn't sync back (F9's specific case: work is complete and sitting in a worktree) | Indistinguishable from the stuck/running case above — the UI has no way to know or show that the *real* output exists and is just unmerged | **New gap.** Worth a distinct state from "stuck with no output" — if 1103 designs a recovery affordance, it should be able to say "the work finished, here it is" vs. "this genuinely broke, here's why." |

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
