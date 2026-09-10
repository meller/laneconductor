# Track AM-10086: Auto-resume parked (lane_action_status: waiting) tracks once their blocking condition clears

**Lane**: done
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implemented
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: A track that parks itself at lane_action_status 'waiting' (e.g. blocked on a `Depends On` dependency, or any other agent-reported blocker) never gets automatically re-checked once the blocking condition actually resolves — autoLaunchLocalFs's own dependency gate (Track AM-1119 Phase 3) only evaluates tracks sitting in 'queue', never ones already parked in 'waiting'. Confirmed live: livingwork's AM-1003 parked with `Waiting Reason`: 'AM-1000 unmerged; Phase 4 done; awaiting merge order' and `Depends On`: 1000; AM-1000 merged to main shortly after, but AM-1003 sat parked indefinitely — nothing noticed the dependency had cleared. Unblocking it required a human to manually call POST /api/projects/:id/tracks/:num/resume (the same endpoint a human would use for a genuinely-different blocker) once they happened to notice and investigate. A plain comment on the track does NOT resume a parked track — confirmed live, posting a comment left lane_action_status at 'waiting' with no change; only the dedicated /resume endpoint (ui/server/index.mjs) transitions it back to 'queue'. This is the same class of bug as the PR-reconciler fix from this same session (conductor/laneconductor.sync.mjs's reconcilePrTracks — a resolved condition that nothing ever re-polls once a track stops being actively watched) but for dependency-gated parks instead of PR merges. Requested: a periodic reconciliation pass (likely alongside or inside the existing auto-launch cycle) that scans tracks currently at lane_action_status 'waiting' whose park reason references a `Depends On` track, checks whether that dependency has since reached lane 'done', and calls the equivalent of the /resume transition automatically when it has — instead of requiring a human to notice and manually intervene. Open question for planning: whether this should special-case the 'blocked on Depends On' reason specifically (parseable, mechanically checkable) versus other park reasons (a genuine question needing human judgment, which should NOT auto-resume) — the fix must not blindly auto-resume every parked track, only ones whose specific, mechanically-verifiable blocking condition has resolved.
**Summary**: A track that parks itself at lane_action_status 'waiting' (e.g. blocked on a `Depends On` dependency, or any other agent-reported blocker) never gets automatically re-checked once the blocking…
