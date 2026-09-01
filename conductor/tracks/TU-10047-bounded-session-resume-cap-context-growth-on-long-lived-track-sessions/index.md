# Track TU-10047: Bounded Session Resume — Cap Context Growth on Long-Lived Track Sessions

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Auto Run**: no
**Author**: TU
**Created By**: test@example.com
**Summary**: resolveTrackSession() (laneconductor.sync.mjs:5766) has no cap: once a claude_session_id is persisted for a track, every subsequent lane-action dispatch resumes it via --resume, carrying forward the…

Key finding that makes this cheap to fix: every spawn (fresh OR resumed) ALREADY injects rich file-based context on every turn -- index.md, spec.md, plan.md, test.md, and a 30KB tail of conversation.md (the 'Context Injection Preparation' block, laneconductor.sync.mjs:4864). This is the durable, authoritative continuity record the codebase already relies on elsewhere (index.md is documented as 'the absolute authority for the track's state'). --resume layers a second, much more expensive continuity mechanism (the full raw tool-call/reasoning trace) on top of one that already works. A session that starts fresh past some threshold is not starting blind.

Proposed design: before resuming, check the session's actual size (from its own last turn's cache_read_input_tokens, or a simple resume-count) against a threshold -- something in the 150-200K cached-token range, well before the failure zone observed on 10045, or an equivalent resume-count cap (~8-10). Past it, invalidate the session (reuse invalidateTrackSession's existing code path) and cold-start instead of resuming, exactly as already happens today after a genuine resume-failure -- just triggered proactively instead of reactively.
