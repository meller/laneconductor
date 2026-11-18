# quality-gate lane (bundled guide)

Goal of the lane: an independent last check before the track is considered done. Evaluate; do not fix.

What has worked:
1. Run the project's quality-gate.md checklist (get_context shows it if the project has one) and the full test commands.
2. Confirm the acceptance criteria in spec.md are met by observation, not by the absence of failures.
3. Record `Verdict` with update_track and a short result in conversation.md. A pass moves the track toward done; it does not merge it.

Why: this lane exists to catch what the implementer and reviewer both assumed.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `verification-before-completion`: running the check this time and reading the real output before marking anything done. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"quality-gate"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
