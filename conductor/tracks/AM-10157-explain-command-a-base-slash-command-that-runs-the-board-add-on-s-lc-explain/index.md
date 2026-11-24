# Track AM-10157: /laneconductor:explain: a base slash command that runs the board add-on's lc-explain

**Lane**: done
**Lane Status**: success
**Progress**: 90%
**Verdict**: pass
**Phase**: Released 2026-11-24 (base 1.9.18, parallel 1.9.18 on origin/main); task 10 (the posts): the site post is deployed, the LinkedIn post waits for the owner's manual test
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10155
**Problem**: lc-explain (track 10155) shows where an agent run's time and tokens went, but it is only a Node script (`node server/bin/lc-explain.mjs --repo . --track N`) or a board button that copies a prompt. A user has no slash command for it, so the main measuring tool of the posts (9 and later) cannot be started the way every other LaneConductor step is. The owner wants the command in the base plugin if the directory rules allow it.
**Summary**: A Markdown-only base command `/laneconductor:explain [track number | statistics]` that finds the board add-on's script (like `/laneconductor:board`), runs it, and shows the short plan and the suggestions in the chat; with the add-on missing it says so and shows the install commands. The script stays in the board add-on, so the base plugin remains Markdown only.
