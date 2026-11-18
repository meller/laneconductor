# brainstorm lane (bundled guide)

Goal of the lane: explore options with the human before a plan exists.

What has worked:
1. Restate the problem and ask the smallest set of questions that would change the design; one at a time.
2. Offer two or three options with a recommendation and its reason, including doing nothing.
3. Capture the outcome in conversation.md (append_conversation, author `claude`; author `system` writes the run log history.md instead) so the plan lane starts from it, and when the human picks a direction, search first (list_tracks with include_done, key words of the request): if a track fits, ask "Update track N (title, lane) with this? [default: yes]" and extend it; create_track only on a no or when nothing fits.

Why: a plan written before the problem is agreed gets rewritten.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `brainstorming`, `writing-plans`: `brainstorming` to draw out requirements one question at a time, `writing-plans` once they are clear. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"brainstorm"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
