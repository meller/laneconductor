# Track AM-10150: Next base release: advisor catalog for the skill packs, the board.auto_update settings row, a skill-from-code pointer, and the after-release skill checks

**Lane**: implement
**Lane Status**: waiting
**Progress**: 80%
**Phase**: Built and verified on 2026-11-20 as base 1.9.12 (not pushed): 891 tests, strict and directory validation, drift check; the pack offers were checked in a scratch Firebase and a scratch Gemini project. Waiting for the owner to say go to push (a new base version is a new directory version). Then: the owner steps (GitHub topic, npx check) and the site follow-up.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Owner Action**: Say go to push base 1.9.12 (it creates a new directory version)
**Owner Action Due**: 2026-11-21
**Depends On**: 10148
**Problem**: Four small changes to the base plugin were deliberately held back while its directory review runs, plus two small owner steps left over from the skills track (10129). Together they are the "next base release".
**Summary**: One base release after the directory decision: advisor catalog entries for the packs, the `board.auto_update` row, a `skill-from-code` pointer in `suggest-skills`, the board command creating a missing board without a second question, and the two after-release skill checks.
