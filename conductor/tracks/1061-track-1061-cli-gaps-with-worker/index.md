# Track 1061: Track 1061: CLI gaps with worker

**Lane**: implement
**Lane Status**: running

**Progress**: 10%
**Phase**: Planning & Research
**Summary**: Adding --run flag to lc CLI to directly execute track actions using the configured AI agent.

## Problem
The `lc` CLI only marks tracks for the background worker, which is inconvenient for non-Claude LLMs or users who prefer direct CLI interaction.

## Solution
Implement flag parsing and agent spawning logic directly in the `lc` CLI.

## Phases
- [x] Phase 1: Planning & Research
- [ ] Phase 2: Refactoring Core Logic
- [ ] Phase 3: Implement --run Flag
- [ ] Phase 4: Verification
