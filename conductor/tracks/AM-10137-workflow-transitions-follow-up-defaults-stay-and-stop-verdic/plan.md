# Track 10137: Workflow transitions follow-up

Decisions: (1) `defaults.on_success` / `defaults.on_failure` are the fallback when a lane OMITS the field; an explicit `null` still means no automatic move. (2) `stay` and `stop` are read-only legacy words: an old workflow.json that has them resolves to "no automatic move", the plugin does not write or document them. (3) `outcome` writes `Verdict` (pass on success, fail on failure) in review and quality-gate lanes, and clears Waiting Reason and Waiting On Tracks when it resumes a track. (4) `Verdict` accepts only pass or fail on write.

## Phase 1: shared resolver
- [x] `conductor/services/workflow-transitions.mjs`: defaults fallback, stay/stop read as no target, `source` in the result
- [x] update tests TC-4 and TC-17 (D7, D9) and add table rows on the otralingo legacy fixture

## Phase 2: update_track
- [x] `outcome` writes Verdict in review / quality-gate lanes; marker edits validate Verdict (pass, fail, or null to clear)
- [x] `outcome` clears Waiting Reason and Waiting On Tracks

## Phase 3: guides
- [x] bundled review.md and quality-gate.md: clear-at-claim line, outcome writes Verdict
- [x] KC-8 context-size budget still passes; build plugins; `--check` clean
