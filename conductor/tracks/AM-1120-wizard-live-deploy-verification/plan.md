# Track AM-1120: Wizard Real-Deploy Verification (Digger Game, Live Firebase)

## Phase 1: Confirm/provision a disposable deploy target

**Problem**: The only credentials on this machine point at real production Firebase/GCP projects.
**Solution**: Human confirms or creates a throwaway project, records its id/region here.

- [ ] Task 1: Run `firebase projects:list` / `gcloud projects list`, confirm a disposable
      project exists or create one (`firebase projects:create` / `gcloud projects create`)
- [ ] Task 2: Record the chosen project id and provider in this file

**Impact**: A safe target exists so Phase 2 cannot touch the four named production projects.

## Phase 2: Live wizard run

**Problem**: The wizard → auto-tracks → deploy chain has never run against real infrastructure.
**Solution**: Launch the wizard with a real "digger game" description and the Phase 1 target; watch it run.

- [ ] Task 1: Complete the wizard (Basics → Product & KPIs → Design & Stack → Deployment →
      Review & Launch) with a real digger-game description and the disposable project
- [ ] Task 2: Observe the generated Auto-Run tracks in `FollowBuildView` as they move through
      plan → implement → review → quality-gate → done without manual intervention
- [ ] Task 3: Record any track that stalls, fails, or needs a retry, and what resolved it

**Impact**: Proves REQ-3 — the pipeline runs unattended end to end on a real target.

## Phase 3: Verify reachability

**Problem**: A recorded `app_url` string is not proof the app is actually live.
**Solution**: Fetch it for real once the deploy track reports done.

- [ ] Task 1: `curl -I $app_url` (or open in a browser) once the deploy track reaches `done`
- [ ] Task 2: Record the HTTP status and a screenshot/transcript in `conversation.md`
- [ ] Task 3: Update track 1119's spec.md to check off AC-4/AC-5 with a link back to this
      track's evidence

**Impact**: Closes the loop — track 1119's originally-deferred TC-16/AC-4/AC-5 become verified.
