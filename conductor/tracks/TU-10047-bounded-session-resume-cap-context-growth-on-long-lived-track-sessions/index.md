# Track TU-10047: Bounded Session Resume — Cap Context Growth on Long-Lived Track Sessions

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned — 5 phases defined
**Type**: dev
**Track Kind**: feature
**Auto Run**: no
**Author**: TU
**Created By**: test@example.com
**Summary**: resolveTrackSession() (laneconductor.sync.mjs:5766) has no cap: once a claude_session_id is persisted for a track, every subsequent lane-action dispatch resumes it via --resume, carrying forward the…

CORRECTED AT PLANNING (2026-09-01) — three premises from intake were checked against the code and against 363 real stream-json logs, and are wrong. See spec.md's "Three corrections" section for the full evidence; do not plan or implement from the original wording.

1. Resumed runs do NOT get file-based context. laneconductor.sync.mjs:4958 gates full injection on `session?.isFresh !== false`; a resumed run receives ONLY the unanswered-human tail. On a resumed turn --resume is the only continuity mechanism, not a redundant second one. This does not kill the track: a proactive cap returns isFresh:true, which flips that same gate back on, so a capped run cold-starts WITH full context re-injected. That is the safety argument.

2. The proposed 150-200K threshold would disable session resume entirely. Median PEAK context within a single lane action is 164K; 57% of runs exceed 150K and 39% exceed 200K in one action. A cap there would fire after nearly every action, silently reverting track 1086 while looking like a working feature. Default is 400K of inherited context instead.

3. Resume-count (~8-10) is not an equivalent signal. Growth is dominated by a run's own tool output, not resume count -- track 1102 reached ~724K within a handful of resumes. Retained only as a fallback when token data is unavailable.

Failure mode confirmed: six consecutive auto-complete-implement runs on track 1102 resumed at 721K-725K inherited context with peak ~= inherited and 2-3 assistant messages each -- i.e. the session was so large the run accomplished essentially nothing. Claude's own auto-compaction fired in only 12 of 363 runs and did not rescue any of them.

Design: cap inside resolveTrackSession() (laneconductor.sync.mjs:5766), the single choke point -- everything downstream (--session-id vs --resume, FRESH_SESSION marker, context injection) derives from its isFresh flag, so no other call site changes. Measure the last assistant event's cache_read+cache_creation at run end (NEVER the result event -- it is a cumulative cross-turn sum, 2.15M vs a true 148K on one real log), store it on track_sessions, and consult it before the next resume. Past the threshold, reuse invalidateTrackSession's existing path and cold-start -- proactively instead of reactively.
