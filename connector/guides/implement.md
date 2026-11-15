# implement lane (bundled guide)

Goal of the lane: execute plan.md phase by phase, with evidence.

What has worked:
1. Read spec.md, plan.md, test.md and the tail of conversation.md first; a human comment there overrides the plan.
2. Per phase: write the test, watch it fail, write the minimal code, watch it pass, then tick the task in plan.md. Ticking a box before running the verification is the most common way phases ship half-done.
3. Commit per phase with the track number in the message. Keep track state (the track folder) separate from code: state belongs on the state branch, code on a branch or worktree.
4. Update `Progress` and `Phase` in index.md with update_track (markers), bundled with the plan.md tick in one call.
5. If you cannot finish, leave `Lane Status` as queue and say what is left in conversation.md; do not report success.
6. Never end a turn on a command you started in the background.

Why: the lane's value is the verified plan.md checkboxes; they are what the next lane trusts.
