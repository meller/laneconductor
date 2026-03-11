# Tests: Track 1047 — Super LaneConductor

## Test Commands
```bash
# SKILL.md content checks (grep-based)
grep -n "Write the test code" .claude/skills/laneconductor/SKILL.md
grep -n "Jesse Vincent" .claude/skills/laneconductor/SKILL.md
grep -n "brainstorm" .claude/skills/laneconductor/SKILL.md
grep -n "failing test" .claude/skills/laneconductor/SKILL.md

# CLI
lc brainstorm --help
node bin/lc.mjs brainstorm --help

# UI (manual)
# Open track detail panel → confirm Brainstorm button visible
```

## Test Cases

### Phase 1: TDD Protocol in implement
- [ ] TC-1: SKILL.md implement section contains "Write the test code" before "implement" step
- [ ] TC-2: SKILL.md implement section contains "confirm it fails" instruction
- [ ] TC-3: TDD protocol is inside the implement command block (not a top-level section)
- [ ] TC-4: Attribution comment references "Jesse Vincent" and "MIT License"

### Phase 2: Failure Protocol in quality-gate
- [ ] TC-5: SKILL.md quality-gate Self-Healing contains "failing test" before fix
- [ ] TC-6: Protocol requires writing the test before implementing the fix

### Phase 3: brainstorm command in SKILL.md
- [ ] TC-7: `/laneconductor brainstorm [track-number]` section exists in SKILL.md
- [ ] TC-8: Command lists all context files it reads (product.md, tech-stack.md, spec.md, plan.md, test.md, conversation.md)
- [ ] TC-9: Command appears in Quick Reference table
- [ ] TC-10: Protocol mentions `**Waiting for reply**: yes` after posting question

### Phase 4: lc brainstorm CLI
- [ ] TC-11: `lc brainstorm --help` exits 0 and shows usage
- [ ] TC-12: `lc brainstorm 1047` (dry run) writes trigger to conversation.md
- [ ] TC-13: `lc brainstorm` without track number prints helpful error

### Phase 5: UI Brainstorm button
- [ ] TC-14: Brainstorm button visible in track detail panel
- [ ] TC-15: Button disabled for tracks in `done` lane
- [ ] TC-16: Clicking button appends trigger to conversation thread

### Phase 6: E2E — lc brainstorm + conversation.md
- [ ] TC-17: `lc brainstorm <track>` writes trigger line to `conversation.md` containing "Brainstorm requested"
- [ ] TC-18: After `lc brainstorm`, `index.md` has `**Waiting for reply**: yes`
- [ ] TC-19: Running `lc brainstorm` on a non-existent track exits non-zero with helpful error
- [ ] TC-20: Running `lc brainstorm` without a track number exits non-zero with usage message

### Phase 7: E2E — skill brainstorm reads context + posts to conversation.md
- [ ] TC-21: After a brainstorm trigger in `conversation.md`, re-running `/laneconductor plan NNN` reads `conversation.md` and reflects its content in updated `spec.md`
- [ ] TC-22: `conversation.md` brainstorm trigger format is parseable by the sync worker (contains `> **system**:` prefix)
- [ ] TC-23: A `conversation.md` with an unanswered brainstorm question has `**Waiting for reply**: yes` in `index.md`

## E2E Test File
```
conductor/tests/brainstorm-e2e.test.mjs
```
Run: `node --test conductor/tests/brainstorm-e2e.test.mjs`

Covers: CLI writes trigger → conversation.md format → index.md waiting marker → plan reads conversation context

## Acceptance Criteria
- [ ] All SKILL.md grep checks pass
- [ ] `lc brainstorm --help` works
- [ ] UI button present and functional
- [ ] No regressions in existing lc commands
- [ ] brainstorm-e2e.test.mjs passes (all 7 cases)
