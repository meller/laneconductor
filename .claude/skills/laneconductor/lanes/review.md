# review lane: `/laneconductor review N`

Evaluate the implementation against the plan and the product guidelines, post the verdict as a
comment, and route the track. This lane only evaluates: fixing the bugs it finds hides them from
the implement lane's retry loop, so write them up as gaps instead.

0. **Claim the track first.** Write `**Lane**: review` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: when the command is run directly the track may
   not sit in this lane, and the board would show it running in the wrong column. In the same
   edit, clear any existing `**Verdict**` marker, so a run that is cut short never leaves a stale
   value for a later run's exit handler to misread.
1. **Load context.**
   - Unless `FRESH_SESSION: false` (review often resumes the session implement used), read
     `plan.md`, `spec.md`, `test.md`, and `product-guidelines.md`, `design-language.md`,
     `deployment-stack.md` where present.
   - Always read `conversation.md`: it shows whether earlier review gaps were addressed and
     whether the human gave specific instructions.
2. **Evaluate** the implementation against the requirements and guidelines.
   - Secrets: no hardcoded secrets or secrets in logs; ADC / Secret Manager used as
     `deployment-stack.md` specifies.
   - If `test.md` exists, run its test commands. A failing test case makes the verdict FAIL.
3. **Post the review** as one comment in `conversation.md`, authored `system`, with the emoji as
   the first character of the body: `> **system**: ✅ REVIEW PASSED` or
   `> **system**: ⚠️ REVIEW FAILED`. Put the write-up (test summary, gaps) in `>`-prefixed
   continuation lines under that same comment, not a second one.
4. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `review` (a human moved the card), leave
     `**Lane**` and `**Lane Status**` alone, keep the step 3 comment (the review is still valid),
     and note in it that the transition was skipped.
   - Otherwise read `conductor/workflow.json`.
   - **PASS:** set `**Lane**` to `lanes.review.on_success` and `**Lane Status**` to `queue`,
     append `## ✅ REVIEWED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** set `**Lane**` to `lanes.review.on_failure` and `**Lane Status**` to `queue`, add
     `⚠️ Gaps` to `plan.md`, and in the same edit write `**Verdict**: fail`.
   - Write `**Verdict**` every time, PASS or FAIL (track AM-10087). The harness can tag the same
     turn `blocked` (for example a question surfaced mid-review) although step 4 already reached
     a routable outcome; the sync worker's exit handler reads `**Verdict**` before that tag, so
     a resolved review is routed instead of parked indefinitely.
