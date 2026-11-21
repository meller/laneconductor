# Tests: AM-10150

Run command: `cd connector && npm test`, `node scripts/build-plugin.mjs --check`, `claude plugin validate --strict plugins/laneconductor` and `--profile directory`.

- [x] TC-1 (REQ-1): the catalog has the four packs with the right stack tags, checked date refreshed, and the catalog test (every entry's source exists in the marketplace) passes
- [x] TC-2 (REQ-1): in a scratch Firebase project and a scratch Gemini project, `suggest-skills` offers the matching pack (headless `claude -p`), at most two items, and installs nothing
- [x] TC-3 (REQ-2): with nothing that fits and a problem then solved, the pointer to `laneconductor-skill-from-code` appears once
- [x] TC-4 (REQ-3): `ops/settings.md` lists `board.auto_update` with its default
- [x] TC-5 (REQ-4): the size-ceiling tests pass with no ceiling raised, the base README is at or under 900 words, and the base has no hooks, scripts or servers
- [x] TC-6 (REQ-5): the released base passes both validations and carries the new version only in the base manifest
- [x] TC-7: `npx skills add meller/laneconductor --list` finds the skills (with the owner's yes)
- [ ] TC-8 (REQ-6): in a scratch project with the add-on installed and no stored board, `/laneconductor:board` publishes a board, stores `board.artifact_url`, opens it, and its reply names the privacy facts and any withheld file; it asks only about the `.gitignore` line when the file is not listed; with a stored board it still only opens it; the board is never shared
- [ ] TC-9 (REQ-6): without the add-on, `/laneconductor:board` says to install the plugin first, shows the two commands, and creates and publishes nothing
