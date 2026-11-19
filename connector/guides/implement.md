# implement lane (bundled guide)

Goal of the lane: execute plan.md phase by phase, with evidence.

What has worked:
1. Read spec.md, plan.md, test.md and the tail of conversation.md first; a human comment there overrides the plan.
2. Per phase: write the test, watch it fail, write the minimal code, watch it pass, then tick the task in plan.md. Ticking a box before running the verification is the most common way phases ship half-done.
3. Commit per phase with the track number in the message. Keep track state (the track folder) separate from code: state belongs on the state branch, code on a branch or worktree.
4. Update `Progress` and `Phase` in index.md with update_track (markers), bundled with the plan.md tick in one call.
4b. When the last phase is verified, finish the lane with update_track and `outcome: "success"` (or `"failure"`): the workflow decides where the track goes (get_track shows it as `valid.next`; only the quality gate moves a track to done). Do not set Lane and Lane Status by hand to a target you worked out from workflow.json.
4c. Status, commit hashes, deploys and incidents of this run are one dated line each in history.md (append_conversation with author `system` writes it), never a section of plan.md or spec.md.
4d. A non-dev track (`Type` marketing, sales, support or other) is supervised: no code, no worktree, no sub-agent. Show the `## Draft`, then one `update_track` writes `Owner Action`, `Owner Action Due`, `Lane Status: waiting` and `Waiting for reply: yes` (the Owner Action is the reason; no Waiting Reason).
5. If you cannot finish, leave `Lane Status` as queue and say what is left in conversation.md; do not report success.
6. Never end a turn on a command you started in the background.

Why: the lane's value is the verified plan.md checkboxes; they are what the next lane trusts.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `test-driven-development`, `systematic-debugging`, `subagent-driven-development`, `using-git-worktrees`: the test-first order, finding the cause of a failing test, handing independent tasks to subagents, an isolated checkout. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"implement"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
