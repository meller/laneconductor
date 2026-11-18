# plan lane (bundled guide)

Goal of the lane: turn a request into documents only (spec.md, plan.md, test.md). No code.

What has worked:
1. Read the project context first (get_context, then the files it points at: product, tech-stack, workflow). Specs that skip this tend to contradict a fundamentals doc.
2. Reuse before creating: call list_tracks with a query for the feature's words. A near-duplicate track is more useful extended than duplicated.
3. New work: create_track (it makes all five files and a valid index.md). Existing track: get_track, then update_track with the `base` you were given.
4. spec.md: problem, requirements (numbered), acceptance criteria that can be observed. Name what is out of scope. plan.md: phases, each with a problem, a solution and checkbox tasks small enough to verify one at a time. test.md: exact commands and one test case per requirement, written so a different session could run them.
5. Mark facts you checked versus things you assume; put each assumption in the plan as a task that tests it.
6. Questions for the human go in conversation.md through append_conversation, and set `Waiting for reply` to `yes` with update_track.
7. When the documents are done, set `Lane Status` to `success` (the project's workflow.json says where the track goes next; its on_success for plan is in get_context).

Why: a plan that a stranger can execute and check is the whole product of this lane.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `brainstorming`, `writing-plans`: `brainstorming` for unclear requirements, `writing-plans` for phases with small checkable tasks. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"plan"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
