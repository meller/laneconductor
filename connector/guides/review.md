# review lane (bundled guide)

Goal of the lane: judge the implementation against spec.md and test.md. Evaluate; do not fix.

What has worked:
1. Re-run the commands in test.md yourself and read the real output; do not trust a ticked box.
2. Check each requirement and acceptance criterion against the code and the diff, and look for what the plan did not mention (error paths, data loss, leaked processes).
3. Record the verdict (`Verdict`: pass or fail) with update_track, together with `outcome: "success"` or `"failure"` so the workflow moves the track (get_track shows the target as `valid.next`), and the findings, each with a file and a reason, in conversation.md via append_conversation.
4. On fail, the findings should be specific enough that the implement lane can act on them without asking.

Why: a review that fixes things hides what was wrong; one that only restates the diff adds nothing.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `requesting-code-review`, `receiving-code-review`: framing what to check, and checking each point of feedback before acting on it. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"review"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
