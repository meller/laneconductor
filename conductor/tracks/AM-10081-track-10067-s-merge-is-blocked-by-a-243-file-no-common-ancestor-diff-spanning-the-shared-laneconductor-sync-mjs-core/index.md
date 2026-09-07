# Track AM-10081: Track 10067's merge is blocked by a 243-file no-common-ancestor diff spanning the shared laneconductor.sync.mjs core

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Track 10067's real implementation (83/83 tests passing, reviewed, quality-gated) is stuck — its branch shares no common ancestor with main (git history rewrite), and the diff footprint (243 files,…

## Problem

Track 10067 ("Intelligent manager: an always-supervised, AI-capable health
monitor with a watchable transcript") passed review and quality-gate for
real — its own dispatch session confirmed 83/83 tests passing — but its
`done` (merge) lane action cannot complete automatically. The AI session
that ran the merge attempt (2026-09-07, dispatch 4216) diagnosed this
thoroughly rather than forcing anything:

- `main` and `track-10067` share no common ancestor at all (different root
  commits: `6fd1e94a` vs `55653e98`) — the same git-history-rewrite
  discontinuity behind tracks 008/9997/10011/10050/10066 this session, but
  at a much larger scale here.
- The diff footprint is 243 files (down from 926 at an earlier check, as
  main has moved further — this narrows over time but is nowhere near the
  ~3-file scale that made 10066's manual rescue safe).
- The highest-risk file is `conductor/laneconductor.sync.mjs` itself — the
  shared `spawnCli()` codepath every lane action in this entire project
  runs through — differing by +952/-1347 lines with no ancestor available
  to isolate "10067's actual change" from unrelated drift that landed on
  main independently since the branch was created.
- The session correctly declined to force a blind cherry-pick here,
  citing the exact scenario the merge protocol's guardrail exists to
  block, left the track at `done:failure`, and asked for either a
  human-identified safe cherry-pick range or a dedicated reconciliation
  task — the same escalation path track 10077 used for track 10050's
  stuck merge.

**Known complication found live 2026-09-07 while checking on this track**:
after that honest `done:failure` diagnosis, the track's own lane status was
later found back at `done:queue` with result `stuck_timeout` — an
automatic retry (this project runs a `sync+poll` worker) appears to have
re-attempted the same doomed merge and gotten stuck re-computing the same
expensive 243-file/no-ancestor diff, rather than respecting the earlier
session's explicit "needs human reconciliation" conclusion. Retrying an
unwinnable merge automatically burns time for no benefit and produces
confusing, self-contradicting status history (dispatch result said
"waiting", conversation.md said "failure", DB later showed "queue" — three
different pictures of the same track's state within minutes of each
other).

## Scope

1. **Do the actual reconciliation.** Either identify a safe, scoped
   cherry-pick range from `track-10067`'s own commit history (isolating
   its real feature work from unrelated `sync.mjs` drift), or manually
   verify and hand-apply the true net diff the way track 10066's rescue
   worked — at 243 files this likely means going file-by-file or
   phase-by-phase rather than one blind patch, given the core-file
   conflict risk the AI session flagged.
2. **Stop the automatic retry loop for tracks in this specific
   unwinnable state.** A `done:failure` outcome whose own diagnosis says
   "needs human reconciliation, no ancestor, do not force" should not be
   silently re-attempted by the next `sync+poll` cycle the same way an
   ordinary transient failure would be — distinguish "worth retrying" from
   "structurally blocked until a human acts" so this doesn't keep
   burning cycles restating the same diagnosis (or worse, getting stuck
   mid-diff and reporting a misleading intermediate result like
   `stuck_timeout`/`waiting`).
3. **Once landed**, clean up `track-10067` the same way 10066 was: remove
   the worktree and delete the branch once its real content is confirmed
   present on main via the reconciliation in (1).
