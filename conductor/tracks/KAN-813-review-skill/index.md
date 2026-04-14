# Track 007: Review Skill

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
After a track reaches the `review` lane, there is no structured way to evaluate the work. The conductor reference implementation (gemini-cli-extensions/conductor) has a `conductor:review` skill that reads plan.md and product-guidelines.md and checks completed work against both. We have no equivalent.

## Solution
Add `/laneconductor review [track-number]` to the SKILL.md that:
1. Reads the track's plan.md (what was planned)
2. Reads conductor/product-guidelines.md (quality standards)
3. Reads the actual code/files changed in the track
4. Produces a structured review: ✅ passed / ⚠️ gaps / ❌ violations
5. Posts the review as a comment on the track (via the comment system from track 006)
6. Optionally moves the track to `done` if review passes, or back to `in-progress` if not

## Phases
- [x] Phase 1: `/laneconductor review [NNN]` skill command (SKILL.md update)
- [x] Phase 2: Review output format + comment posting
- [x] Phase 3: Auto-lane transition based on review outcome
