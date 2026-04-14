# Track 1017: Three Operating Modes — Docs, Tests and Worker Polish

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
LaneConductor now supports three operating modes but they are undocumented, undertested, and the local-fs mode has noise from git lock/worktree operations that assume a real git remote.

## Solution
Document all three modes clearly, write tests for each, and polish local-fs mode by skipping git operations when in pure filesystem mode.

## Phases
- [ ] Phase 1: Document modes in product.md and landing page
- [ ] Phase 2: Polish local-fs mode (skip git lock/worktree, suppress noise)
- [ ] Phase 3: Tests for Mode 2 (local-api with mock collector)
- [ ] Phase 4: Tests for Mode 3 (remote-api with mock collector)
- [ ] Phase 5: Update SKILL.md quick reference with mode config
