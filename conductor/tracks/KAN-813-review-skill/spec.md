# Spec: Review Skill

## Problem Statement
Tracks that reach the `review` lane have no structured evaluation step. Work could be incomplete, violate guidelines, or miss acceptance criteria — with no automated check before marking done. The conductor reference project has `conductor:review` for this. We need the equivalent in LaneConductor.

## Requirements

- REQ-1: `/laneconductor review [track-number]` — skill command that runs a structured review
- REQ-2: Reads `conductor/tracks/NNN-*/plan.md` — knows what was planned, phase by phase
- REQ-3: Reads `conductor/product-guidelines.md` — knows the quality/style standards
- REQ-4: Reads relevant source files changed in the track (inferred from plan.md task descriptions or git diff if available)
- REQ-5: Produces structured review output with three sections:
  - ✅ What was completed and meets the plan + guidelines
  - ⚠️ Gaps — things planned but not clearly completed
  - ❌ Violations — things that contradict product-guidelines.md
- REQ-6: Posts the full review as a Claude comment on the track (requires track 006 comment system)
- REQ-7: If review is clean (no ❌, no ⚠️) → pulses track to `done`
- REQ-8: If review has ❌ or ⚠️ → leaves in `review` lane, human decides next step
- REQ-9: Review can be re-run after fixes — each run posts a new comment

## Acceptance Criteria
- [ ] `/laneconductor review 005` on a done track → posts a structured review comment visible in UI
- [ ] Review catches a missed task from plan.md → shows in ⚠️ section
- [ ] Review catches a guidelines violation → shows in ❌ section
- [ ] Clean review → track auto-moves to done
- [ ] Review comment includes timestamp and "reviewed by Claude [model]" attribution

## Notes
- Reference: https://github.com/gemini-cli-extensions/conductor (conductor:review skill)
- Track 006 (comment system) is a dependency — review posts its output as a track comment
- If track 006 comment system isn't done, review output can be printed to terminal only (fallback)
