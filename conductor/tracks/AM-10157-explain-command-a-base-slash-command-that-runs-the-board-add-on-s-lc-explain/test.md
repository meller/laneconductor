# Tests: AM-10157

## Test Commands
- `cd connector && npm test` (look for `# fail 0`)
- `node scripts/build-plugin.mjs --check`
- `claude plugin validate . --strict`
- By hand: `node plugins/laneconductor-board/server/bin/lc-explain.mjs --repo . --track 10154 --no-write`, then the command on the same track

## Test Cases
### Phase 1: The command
- [x] TC-1 (REQ-1): the catalog has `explain` in group `board`; the help list shows it with an example phrase
- [x] TC-2 (REQ-2, D2): the procedure text handles a track number, `statistics`, `summary` and `project` (the same thing) and an empty argument (asks which track)
- [x] TC-2b (D2): the generated `commands/explain.md` accepts `statistics`, `summary` and `project`, says the summary only covers tracks already explained, says how many it summarized and that a missing track needs `explain <number>` first, and offers no `all` argument (asked for all it says to go one by one, then run the summary)
- [x] TC-3 (REQ-3, REQ-5): the generated `commands/explain.md` names the script glob under the plugin cache and, for a missing add-on, shows `claude plugin marketplace add meller/laneconductor` and `claude plugin install laneconductor-board@laneconductor` each in its own block

### Phase 2: Tests, docs, validation
- [x] TC-4 (REQ-6): the command text says numbers only, no prompt, message or file content
- [x] TC-5 (REQ-7): the base plugin has no script, package file or MCP server after the build; strict validation passes; the build check passes
- [x] TC-6 (REQ-8): `docs/plugin-map.md` and the base README list the command

### Phase 3: Real use (owner)
- [ ] TC-7: the command on track 10154 shows the same short plan as the script

## Acceptance Criteria
- [x] All unit tests pass and the build check is clean
- [x] Base plugin still Markdown only
