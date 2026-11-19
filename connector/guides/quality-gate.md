# quality-gate lane (bundled guide)

Goal of the lane: an independent last check before the track is considered done. Evaluate; do not fix.

What has worked:
0. When you claim the track, clear any `Verdict` marker first (update_track with `markers: {Verdict: null}`, together with `Lane Status: running`), so a run that is cut short never leaves a stale pass or fail behind.
1. Run the project's quality-gate.md checklist (get_context shows it if the project has one) and the full test commands.
2. Confirm the acceptance criteria in spec.md are met by observation, not by the absence of failures.
3. Pass `outcome: "success"` or `"failure"` to update_track (the workflow moves the track; get_track shows the target as `valid.next`); the outcome also writes `Verdict` (`pass` or `fail`). Put the result as one dated line in history.md (append_conversation with author `system`, text starting with the emoji) and any write-up in conversation.md (author `claude`); no status goes into plan.md or spec.md. A pass moves a code track to `done:queue`: passed, not shipped; the merge lane sets `done:success`. A non-dev track (`Type` not `dev`) has no branch and nothing to merge: set `Lane` done, `Lane Status` success and `Verdict` pass with markers (not `outcome`), and write its `Result`.

Why: this lane exists to catch what the implementer and reviewer both assumed.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `verification-before-completion`: running the check this time and reading the real output before marking anything done. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"quality-gate"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
