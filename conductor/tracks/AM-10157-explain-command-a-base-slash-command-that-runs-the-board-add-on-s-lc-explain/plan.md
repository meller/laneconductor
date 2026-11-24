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
- [x] Task 8 (HUMAN): the command was run for real in headless Claude sessions with this branch's plugins (2026-11-24, owner asked for it to be tested): `statistics` and `10154` both found the script and brought the result into the chat; the owner may re-run it and say whether the output is clear
- [x] Task 9 (HUMAN): the owner decided on 2026-11-24 not to wait for the Anthropic review of the current base version ("it is not happening for a few days, I am continuing in parallel"); the release itself still needs the owner's yes to the push

## Phase 4: The post
- [ ] Task 10: update LinkedIn post 9 and the site post to name `/laneconductor:explain` only after Task 9 (the post waits for the command, owner decision 2026-11-24)
