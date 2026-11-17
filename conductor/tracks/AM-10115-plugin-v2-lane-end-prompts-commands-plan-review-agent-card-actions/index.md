# Track AM-10115: Plugin v2: prompts after a lane ends, commands, a plan-review agent, and board card actions

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10106
**Problem**: Use what a plugin can do and a skill cannot, and make the board a place to act, not only to look.

Verified in the Claude docs (2026-11-17): a plugin can ship hooks, commands and subagents next to its skill and connector; hooks and agents load in Claude Code and Cowork but not in claude.ai chat; a hook can match the plugin's own connector tool by its full name (mcp__plugin_laneconductor_lc-connector__update_track); a published artifact can ask Claude a question of its own (the `sample` capability, a separate memoryless model call, consent on first use) and can call the viewer's connectors (the `mcp` capability, with the viewer's credentials).

Wanted: (1) after a lane finishes, Claude offers the next step: update the board, review the plan, move on; offers only, never actions (second opinion, never a controller), switchable off. (2) Commands for the common asks: /laneconductor:board and /laneconductor:review-plan. (3) A plan-review subagent that reads spec.md and plan.md and reports gaps. (4) On the board, opening a track card shows a "Review the plan" button that asks Claude from inside the page and shows the review (read-only). (5) Later, card buttons that change a track (move lane, set status) through a connector the page can reach: the remote connector once it exists, or possibly the plugin's local one in the Claude desktop app (unverified, needs a spike).

Out of scope here: install and migration documentation (track 10114) and the directory submission (track 10106 Phase 5e).
**Summary**: Plugin extras (lane-end prompts, commands, a plan-review agent) and board card actions (review the plan from the page, act through a connector).
