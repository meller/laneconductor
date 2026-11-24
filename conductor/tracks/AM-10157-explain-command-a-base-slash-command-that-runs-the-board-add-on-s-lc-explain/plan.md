# Track AM-10157: /laneconductor:explain

## Phase 1: The command
**Problem**: no slash command starts lc-explain.
**Solution**: a catalog entry whose procedure reuses the board add-on's script lookup.

- [x] Task 1 (test first): the catalog test lists `explain` with group `board` and `needsBoardScript`, and the help list shows it with an example phrase (REQ-1)
- [x] Task 2: add the catalog entry and its procedure text: argument handling, script lookup, run, show the short plan and suggestions, the privacy line, the add-on-missing branch with the install commands (REQ-2 to REQ-6)
- [x] Task 3: add `explain` to `BOARD_SCRIPT_COMMANDS` in `scripts/plugin-references.mjs` so the command keeps its one read outside the project on purpose, like `board`
- [x] Task 4: regenerate with `node scripts/build-plugin.mjs`; the base plugin gains `commands/explain.md` and its version moves to the next free one (REQ-1, REQ-7)

**Impact**: one new Markdown file in the base plugin; no code ships in it.

## Phase 2: Tests, docs, validation
- [x] Task 5 (test first): a test checks the generated `commands/explain.md` names the script glob, both install commands, the privacy line, and contains no `node` invocation of a file inside the base plugin
- [x] Task 6: `docs/plugin-map.md` lists the command (generated); the base README lists no command by name (only "every slash command"), so it needs no line and claims nothing (REQ-8)
- [x] Task 7: `cd connector && npm test` (look for `# fail 0`), `node scripts/build-plugin.mjs --check`, `claude plugin validate . --strict` (REQ-7)

## Phase 3: Real use and release (owner)
- [ ] Task 8 (HUMAN): the owner runs `/laneconductor:explain 10154` after reloading the plugin from this branch, and says whether the output is clear
- [ ] Task 9 (HUMAN): the owner decides when to release the new base version and whether it waits for the Anthropic review of the current version (D1)

## Phase 4: The post
- [ ] Task 10: update LinkedIn post 9 and the site post to name `/laneconductor:explain` only after Task 9 (the post waits for the command, owner decision 2026-11-24)
