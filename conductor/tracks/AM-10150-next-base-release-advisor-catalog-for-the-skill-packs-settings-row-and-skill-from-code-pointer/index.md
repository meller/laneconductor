# Track AM-10150: Next base release: advisor catalog for the skill packs, the board.auto_update settings row, a skill-from-code pointer, and the after-release skill checks

**Lane**: implement
**Lane Status**: waiting
**Progress**: 90%
**Phase**: Released: base 1.9.12 is on main (3ef13c3c, 2026-11-20), with the packs in the advisor catalog, the skill-from-code pointer, the board.auto_update row and the board command that creates a missing board. Left: the two owner steps (GitHub topic `agent-skill`; yes to the `npx skills add --list` check) and the README/site follow-up (deploy only on the owner word).
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Owner Action**: Add the agent-skill topic to the GitHub repository meller/laneconductor, and say yes or no to the npx skills add check
**Owner Action Due**: 2026-11-27
**Depends On**: 10148
**Problem**: Four small changes to the base plugin were deliberately held back while its directory review runs, plus two small owner steps left over from the skills track (10129). Together they are the "next base release".
**Summary**: One base release after the directory decision: advisor catalog entries for the packs, the `board.auto_update` row, a `skill-from-code` pointer in `suggest-skills`, the board command creating a missing board without a second question, and the two after-release skill checks.
