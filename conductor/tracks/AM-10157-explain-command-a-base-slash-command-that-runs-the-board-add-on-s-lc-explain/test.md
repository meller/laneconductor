# Tests: AM-10157

## Test Commands
- `cd connector && npm test` (look for `# fail 0`)
- `node scripts/build-plugin.mjs --check`
- `claude plugin validate . --strict`
- By hand: `node plugins/laneconductor-board/server/bin/lc-explain.mjs --repo . --track 10154 --no-write`, then the command on the same track

## Test Cases
### Phase 1: The command
- [ ] TC-1 (REQ-1): the catalog has `explain` in group `board`; the help list shows it with an example phrase
- [ ] TC-2 (REQ-2): the procedure text handles a track number, `statistics` and an empty argument (asks which track)
- [ ] TC-3 (REQ-3, REQ-5): the generated `commands/explain.md` names the script glob under the plugin cache and, for a missing add-on, shows `claude plugin marketplace add meller/laneconductor` and `claude plugin install laneconductor-board@laneconductor` each in its own block

### Phase 2: Tests, docs, validation
- [ ] TC-4 (REQ-6): the command text says numbers only, no prompt, message or file content
- [ ] TC-5 (REQ-7): the base plugin has no script, package file or MCP server after the build; strict validation passes; the build check passes
- [ ] TC-6 (REQ-8): `docs/plugin-map.md` and the base README list the command

### Phase 3: Real use (owner)
- [ ] TC-7: the command on track 10154 shows the same short plan as the script

## Acceptance Criteria
- [ ] All unit tests pass and the build check is clean
- [ ] Base plugin still Markdown only
