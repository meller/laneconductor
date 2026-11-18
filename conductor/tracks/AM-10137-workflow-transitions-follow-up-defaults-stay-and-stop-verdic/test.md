# Tests: Track 10137

- [ ] TC-1 defaults.on_success / on_failure used when the lane omits the field; lane value wins; explicit null stays no move
- [ ] TC-2 stay and stop in an old workflow.json resolve to no automatic move (legacy read), for the lane and for defaults
- [ ] TC-3 otralingo legacy fixture rows unchanged
- [ ] TC-4 outcome in review/quality-gate writes Verdict pass / fail; other lanes leave Verdict alone
- [ ] TC-5 Verdict other than pass or fail is refused; null clears
- [ ] TC-6 outcome clears Waiting Reason and Waiting On Tracks
- [ ] TC-7 bundled review.md and quality-gate.md carry the clear-at-claim line
- [ ] TC-8 `cd connector && npm test` green, KC-8 passes, build-plugin --check clean
