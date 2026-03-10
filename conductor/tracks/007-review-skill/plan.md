# Track 007: Review Skill

## Phase 1: `/laneconductor review [NNN]` skill command ✅ COMPLETE

**Problem**: No review command exists in SKILL.md.
**Solution**: Add the command definition with full review logic.

- [x] Task 1: Add `review` to SKILL.md Quick Reference table
- [x] Task 2: Write `/laneconductor review [track-number]` section in SKILL.md
    - [x] Step 1: Read `.laneconductor.json` → project_id + model
    - [x] Step 2: Find `conductor/tracks/NNN-*/plan.md` → load planned tasks + acceptance criteria
    - [x] Step 3: Read `conductor/product-guidelines.md` → load quality standards
    - [x] Step 4: Read `spec.md` → load requirements and acceptance criteria
    - [x] Step 5: Identify source files (git diff or plan.md inference) → read + verify
    - [x] Step 6: For each planned task → verify done in source
    - [x] Step 7: For each guideline → check for violations
    - [x] Step 8: Build structured review (✅ / ⚠️ / ❌ sections)
- [x] Task 3: Define review output format (markdown template with header, sections, verdict footer)

**Impact**: `review` command exists and produces structured output.

---

## Phase 2: Review output + comment posting ✅ COMPLETE

**Problem**: Review output needs to persist and be visible in the UI.
**Solution**: Post review as a track comment via the comment API (track 006).

- [x] Task 1: Format review as markdown comment body
    - [x] Header: `## Review — Track NNN — [date]`
    - [x] Reviewed by: `claude [model-id]`
    - [x] Three sections: ✅ Completed / ⚠️ Gaps / ❌ Violations
    - [x] Footer: overall verdict (PASS / NEEDS WORK / FAIL) with legend
- [x] Task 2: POST comment via curl to `/api/projects/:id/tracks/:num/comments` (author='claude')
    - [x] Fallback: if API unreachable, print to terminal only
- [x] Task 3: Print one-line summary to terminal regardless

**Impact**: Review is permanent, visible in track Conversation tab.

---

## Phase 3: Auto-lane transition ✅ COMPLETE

**Problem**: After review, lane should reflect outcome automatically.
**Solution**: Pulse lane based on review result.

- [x] Task 1: If verdict = PASS → `PATCH lane_status=done, progress_percent=100`
- [x] Task 2: If verdict = NEEDS WORK → leave in current lane, print actionable message
- [x] Task 3: If verdict = FAIL → `PATCH lane_status=review`, print actionable message
- [x] Task 4: Document review→done and review→stay flows in verdict table

**Impact**: Lane transitions automatically based on review outcome.

## Verification
Self-reviewed on 2026-02-24 using `/laneconductor review 007` — verdict PASS.
Review comment posted as track comment (id=2). Track auto-moved to done via PATCH.

## ✅ REVIEWED

## ✅ REVIEWED

## ✅ REVIEWED

## ✅ REVIEWED

## ✅ REVIEWED

## ✅ REVIEWED

## ✅ REVIEWED
