# Track AM-10146: Track file roles: plan, spec, test, a tracked history.md for the run log, and a lint for a plan that holds a log

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Found 2026-11-18 on the otralingo project, track AM-1259: its plan.md is 97 KB with about 25 dated STATUS, RELEASE and INCIDENT sections mixed in, and it has no spec and no conversation file. The plugin defines nothing about what belongs in each track file (the plan guide only says the plan lane writes spec.md, plan.md and test.md), so agents append status to the file they are already editing. Also, conversation.md is gitignored (decision D5), so moving a run history into it would keep it on one machine only.

Owner decision (2026-11-18): history.md, tracked in git, holds the run log; conversation.md stays untracked for dialogue.

The contract (ships in the skill and in the scaffolded conductor/workflow.md):
- index.md: overview (the PM view): what and why, markers, one line on where it stands. No logs.
- spec.md: detailed design (the architect view): requirements, dated decisions, data model and APIs, acceptance criteria, risks. No status.
- plan.md: high-level plan: phases, order, gates, design approach, checkboxes only. No dated status, releases or incidents.
- test.md: test plan: test cases and commands. No status.
- history.md (new, tracked, append-only): one dated line per event: what ran, commit hashes, deploys, incidents.
- conversation.md (untracked, unchanged): dialogue between people and agents, may be private.

Scope:
1. Contract text: a section 'What goes in each track file' in the skill (ops/tracks.md, SKILL.md pointer, lanes/plan.md and the other lane guides, connector/guides), the scaffold's workflow.md template, and the generated command texts; the plan guide says to move any dated status out of plan.md.
2. history.md: create_track and the scaffold create an empty history.md (header line only); the lane completion line and the 'Classified as Track Kind' note go to history.md as one dated line each; append_conversation routes author `system` to history.md (tracked and committed with the track) while human, claude and gemini stay in conversation.md; no new tool and no tool-description text (KC-8 budget), the guides and the response say where the line went; .gitignore lines stay as they are (conversation ignored, history tracked).
3. Lint: a warning `plan_has_log` when plan.md has two or more dated or STATUS, RELEASE, INCIDENT, UPDATE, LOG headings, or is over 60 KB; shown by get_track, as one aggregate line in list_tracks and in the summary lint; a procedure in ops/tracks.md for splitting a plan that holds a log (move the dated sections into history.md and the design decisions into spec.md, ask first, never delete). Do not touch ops/next.md here (the What's next work is editing it; the `next` display of this lint comes after).
4. Pilot: otralingo AM-1259 is restructured by otralingo's own agent using this contract (the lead tells it); this repo's own tracks are not rewritten.
5. Tests: create_track creates history.md; system entries land in history.md and are committed, human entries in conversation.md and are not; the lint on fixtures (clean plan, dated sections, oversized); text tests that the guides name the contract; base stays Markdown-only and free of daemon-era words.
**Summary**: Found 2026-11-18 on the otralingo project, track AM-1259: its plan.md is 97 KB with about 25 dated STATUS, RELEASE and INCIDENT sections mixed in, and it has no spec and no conversation file. The plug
