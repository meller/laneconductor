# Tests: Track 1078 — Add conductor/design-language.md to project scaffolding

This is a documentation/skill-instruction-only track (no application code) — verification is
grep-based cross-referencing against `.claude/skills/laneconductor/SKILL.md`, not a runnable
test suite.

## Test Commands

```bash
SKILL=.claude/skills/laneconductor/SKILL.md

# TC-1/2/3/4: design-language.md present in generation-related sections
grep -n "design-language.md" "$SKILL"

# TC-5: implement reads all three fundamentals
sed -n '/^### `\/laneconductor implement /,/^### `\/laneconductor review/p' "$SKILL" | grep -E "product-guidelines.md|design-language.md|tech-stack.md"

# TC-6: review reads design-language.md alongside product-guidelines.md
sed -n '/^### `\/laneconductor review /,/^### `\/laneconductor quality-gate/p' "$SKILL" | grep "design-language.md"

# TC-7/8: guardrail present on both plan and implement
sed -n '/^### `\/laneconductor plan /,/^### `\/laneconductor brainstorm/p' "$SKILL" | grep -i "FUNDAMENTALS CONFLICT"
sed -n '/^### `\/laneconductor implement /,/^### `\/laneconductor review/p' "$SKILL" | grep -i "FUNDAMENTALS CONFLICT"
```

## Test Cases

### Feature: design-language.md scaffold generation
- [ ] TC-1: `setup scaffold generate`'s file-generation list includes a
      `conductor/design-language.md` bullet.
- [ ] TC-2: the progress-print block includes a `Writing conductor/design-language.md` line.
- [ ] TC-3: `setup scaffold` Mode A's existing-code inference list includes `design-language.md`.
- [ ] TC-4: the "Both modes create" file tree includes `design-language.md`.
- [ ] TC-4b: a dedicated `design-language.md` template block exists (color tokens, typography
      scale, spacing system, component conventions, iconography/motion) in the same
      presentation style as the existing `kpis.md` template.

### Feature: context-loading wiring
- [ ] TC-5: `/laneconductor implement`'s "Read existing context" step reads
      `product-guidelines.md`, `design-language.md`, and `tech-stack.md` (all three, `if
      present`) — previously read none of them.
- [ ] TC-6: `/laneconductor review`'s "Load Context" step reads `design-language.md` in
      addition to the pre-existing `product-guidelines.md` read.

### Feature: fundamentals-conflict guardrail
- [ ] TC-7: `/laneconductor plan`'s protocol documents the guardrail: don't silently rewrite a
      fundamental doc; post a `⚠️` comment naming the doc + conflict instead.
- [ ] TC-8: `/laneconductor implement`'s protocol documents the same guardrail.
- [ ] TC-9: the guardrail's comment format is explicitly specified (not left to
      interpretation) and marked non-blocking by default.

### Feature: no regressions
- [ ] TC-10: every pre-existing `product-guidelines.md` / `deployment-stack.md` mention in
      SKILL.md still reads correctly after the edits (no accidental deletion/corruption of
      surrounding text — spot-check via `git diff`).

## Acceptance Criteria
- [ ] All test cases above pass (verified via the grep commands, not an automated test runner).
- [ ] `git diff .claude/skills/laneconductor/SKILL.md` reviewed end-to-end for unintended
      changes outside the sections this track touches.
