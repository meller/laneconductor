# Tests: AM-10150

Run command: `cd connector && npm test`, `node scripts/build-plugin.mjs --check`, `claude plugin validate --strict plugins/laneconductor` and `--profile directory`.

- [ ] TC-1 (REQ-1): the catalog has the four packs with the right stack tags, checked date refreshed, and the catalog test (every entry's source exists in the marketplace) passes
- [ ] TC-2 (REQ-1): in a scratch Firebase project and a scratch Gemini project, `suggest-skills` offers the matching pack (headless `claude -p`), at most two items, and installs nothing
- [ ] TC-3 (REQ-2): with nothing that fits and a problem then solved, the pointer to `laneconductor-skill-from-code` appears once
- [ ] TC-4 (REQ-3): `ops/settings.md` lists `board.auto_update` with its default
- [ ] TC-5 (REQ-4): the size-ceiling tests pass with no ceiling raised, the base README is at or under 900 words, and the base has no hooks, scripts or servers
- [ ] TC-6 (REQ-5): the released base passes both validations and carries the new version only in the base manifest
- [ ] TC-7: `npx skills add meller/laneconductor --list` finds the skills (with the owner's yes)
