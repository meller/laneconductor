# plan lane (bundled guide)

Goal of the lane: turn a request into documents only (spec.md, plan.md, test.md). No code.

What has worked:
1. Read the project context first (get_context, then the files it points at: product, tech-stack, workflow). Specs that skip this tend to contradict a fundamentals doc.
2. Search first, the default is update, not create: call list_tracks with include_done and a query of one key word of the request (repeat with two or three words) so every lane is searched, backlog and done too. If a track fits, ask "Update track N (title, lane) with this? [default: yes]" and extend it; a done track is reopened only on a yes (`update_track` refuses to move a done track out of done unless you pass `reopen: true`, so pass it only after that yes).
3. Create only if the person says no or nothing fits, and say which tracks you looked at: create_track (it makes every track file, history.md included, and a valid index.md; it returns similar_tracks, look at them). Several small gaps go into one fitting track, an epic or one backlog track. Existing track: get_track, then update_track with the `base` you were given.
4. spec.md: problem, requirements (numbered), acceptance criteria that can be observed. Name what is out of scope. plan.md: phases, each with a problem, a solution and checkbox tasks small enough to verify one at a time. test.md: exact commands and one test case per requirement, written so a different session could run them.
4b. What goes in each track file: index.md the overview and markers, spec.md the detailed design (decisions with their date and reason), plan.md the task tracker (phases and the individual tasks as checkboxes, ticked as work proceeds; design detail, requirements and acceptance criteria go to spec.md), test.md the test plan, history.md the tracked run log, conversation.md the dialogue. Status, releases, incidents and any dated entry never go into plan.md or spec.md: they are one dated line in history.md (`- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`); append_conversation with author `system` writes that line and says which file got it, the other authors write conversation.md. If a plan already holds a dated log (get_track warns), ask first, then move the dated sections to history.md and the decisions to spec.md; never delete, and the phases and checkbox tasks stay in the plan.
5. Mark facts you checked versus things you assume; put each assumption in the plan as a task that tests it.
6. Questions for the human go in conversation.md through append_conversation, and set `Waiting for reply` to `yes` with update_track.
7. When the documents are done, finish the lane with update_track and `outcome: "success"`: the project's workflow decides the lane and status (get_track shows it as `valid.next`; some projects park a planned track at `plan:success`, others send it on).

Why: a plan that a stranger can execute and check is the whole product of this lane.

## Skills that help here

Suggestions, never orders. If installed (for example from the Superpowers plugin), consider `brainstorming`, `writing-plans`: `brainstorming` for unclear requirements, `writing-plans` for phases with small checkable tasks. If one is missing, say so in one line and carry on. Also read `conductor/workflow.json`: a top-level `skills` object with a list under `"plan"` names more skills to use in addition, the same way. The key is optional. Where a skill's steps or file locations differ from the track files, the track files win.
