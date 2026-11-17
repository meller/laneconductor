# review lane (bundled guide)

Goal of the lane: judge the implementation against spec.md and test.md. Evaluate; do not fix.

What has worked:
1. Re-run the commands in test.md yourself and read the real output; do not trust a ticked box.
2. Check each requirement and acceptance criterion against the code and the diff, and look for what the plan did not mention (error paths, data loss, leaked processes).
3. Record the verdict (`Verdict`: pass or fail) with update_track and the findings, each with a file and a reason, in conversation.md via append_conversation.
4. On fail, the findings should be specific enough that the implement lane can act on them without asking.

Why: a review that fixes things hides what was wrong; one that only restates the diff adds nothing.
