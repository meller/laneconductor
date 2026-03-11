# Plan: Track 1047 — Super LaneConductor

## Phase 1: SKILL.md — MIT Attribution + TDD Protocol in implement

**Problem**: implement can read tests.md but doesn't enforce test-first order.
**Solution**: Add attribution comment + TDD protocol block inside the implement command section.

- [ ] Add MIT attribution comment near top of SKILL.md (after frontmatter)
- [ ] In `/laneconductor implement` → "Read existing context" step, strengthen the tests.md instruction:
  - Replace current vague "use test cases as implementation targets" with explicit TDD protocol:
    1. If tests.md exists, find test cases for the current phase
    2. Write the test code first (before any implementation)
    3. Run the test — confirm it fails (feature missing, not a typo)
    4. Write minimal implementation to make it pass
    5. Run again — confirm green
    6. Phase is not complete until its test cases pass
- [ ] Commit: `feat(track-1047): Phase 1 - TDD protocol in implement + attribution`

## Phase 2: SKILL.md — Failure Protocol in quality-gate

**Problem**: quality-gate Self-Healing allows guessing without root cause investigation.
**Solution**: Add a failing-test-first requirement to the Self-Healing block.

- [ ] In `/laneconductor quality-gate` → Self-Healing section, add before "you MAY do so":
  - Write a minimal failing test that reproduces the bug first
  - Only then implement the fix
  - The failing test becomes part of the committed fix
- [ ] Commit: `feat(track-1047): Phase 2 - failing test before fix in quality-gate`

## Phase 3: SKILL.md — brainstorm command

**Problem**: No pre-implementation dialogue to deepen spec/plan.
**Solution**: Add `/laneconductor brainstorm [track]` command to SKILL.md.

- [ ] Add full command documentation in SKILL.md (after `/laneconductor plan`):
  ```
  ### `/laneconductor brainstorm [track-number]`
  Optional deepening step before implement. Reads all context, asks questions via conversation.md.
  ```
- [ ] Document the full protocol (see spec.md)
- [ ] Add to Quick Reference table
- [ ] Commit: `feat(track-1047): Phase 3 - brainstorm command in SKILL.md`

## Phase 4: CLI — lc brainstorm command

**Problem**: No `lc brainstorm` CLI entry point.
**Solution**: Add brainstorm subcommand to `bin/lc.mjs`.

- [ ] Find brainstorm/plan command pattern in `bin/lc.mjs`
- [ ] Add `brainstorm` case:
  - Reads track number argument
  - Locates track folder
  - Appends brainstorm trigger to `conversation.md`:
    ```
    > **system**: Brainstorm requested via CLI. Read all context files and begin clarifying questions.
    ```
  - Sets `**Waiting for reply**: yes` in index.md
  - Prints: `✅ Brainstorm started for Track NNN. Reply in conversation.md or the UI inbox.`
- [ ] Add `lc brainstorm <track>` to help text
- [ ] Commit: `feat(track-1047): Phase 4 - lc brainstorm CLI command`

## Phase 5: UI — Brainstorm button

**Problem**: No UI entry point for brainstorm.
**Solution**: Add Brainstorm button to track detail panel alongside Bug/action buttons.

- [ ] Find TrackDetailPanel component (or equivalent) in `ui/src/`
- [ ] Add "Brainstorm" button next to existing action buttons
- [ ] On click: POST to API to append brainstorm trigger to conversation.md + set waiting_for_reply
- [ ] Button state: disabled if track is in `done` lane
- [ ] Commit: `feat(track-1047): Phase 5 - Brainstorm button in UI`
