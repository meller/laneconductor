# Tests: Track 10137

- [x] TC-1 defaults.on_success / on_failure used when the lane omits the field; lane value wins; explicit null stays no move
- [x] TC-2 stay and stop in an old workflow.json resolve to no automatic move (legacy read), for the lane and for defaults
- [x] TC-3 otralingo legacy fixture rows unchanged
- [x] TC-4 outcome in review/quality-gate writes Verdict pass / fail; other lanes leave Verdict alone
- [x] TC-5 Verdict other than pass or fail is refused; null clears
- [x] TC-6 outcome clears Waiting Reason and Waiting On Tracks
- [x] TC-7 bundled review.md and quality-gate.md carry the clear-at-claim line
- [x] TC-8 `cd connector && npm test` green (425), KC-8 passes, build-plugin --check clean
