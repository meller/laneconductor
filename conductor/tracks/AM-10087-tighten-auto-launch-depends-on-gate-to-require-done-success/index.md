# Track AM-10087: Tighten autoLaunchLocalFs's **Depends On** queue-gate to require done:success, not lane done alone

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Recorded as a recommended follow-up during Track AM-10086's planning (see its spec.md's "Out of Scope" item 1). `autoLaunchLocalFs`'s existing `**Depends On**` gate (Track AM-1119 Phase 3, `conductor/laneconductor.sync.mjs`) only requires a named dependency to be at lane `done` before letting a `queue`d track auto-launch — it does NOT additionally require `lane_action_status: success`. Since Track 10035 made merging itself a `done`-lane action, a dependency sitting at `done:queue` is only "quality-gate passed, not yet merged" — the gate currently treats that as satisfied anyway. Track AM-10086 deliberately built its own, stricter `done:success` rule for the analogous case (a track parked at `<lane>:waiting` whose park names a dependency) specifically to avoid a park-resume-park loop, and documented in its own `conductor/services/dependency-resume.mjs` header why it diverges from this existing, looser gate rather than silently reusing or changing it. This track is the recommended follow-up to bring the two into alignment, if the wizard-generated track-set use case (the gate's original purpose — gating a final "Deploy to <provider>" track behind its feature tracks) doesn't actually need the looser behavior.
**Summary**: The pre-existing **Depends On** queue-gate in autoLaunchLocalFs accepts lane `done` alone as "dependency satisfied," unlike Track AM-10086's own, stricter `done:success` rule for its analogous waiting-park case — worth tightening for consistency, but deliberately out of scope for AM-10086 itself since it changes behavior for every wizard-generated track set.
