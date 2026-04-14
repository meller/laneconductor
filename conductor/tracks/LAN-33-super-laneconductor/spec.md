# Spec: Track 1047 — Super LaneConductor

## Problem Statement

LaneConductor's AI commands (implement, quality-gate) lack structured discipline protocols. Implement can read tests.md but still write code first. Quality-gate can guess-and-fix without understanding root cause. There's also no brainstorm command to deepen a track's spec/plan before jumping to implementation.

Superpowers skills (MIT licensed, © Jesse Vincent) contain battle-tested protocols for these exact problems. We inline the relevant parts directly into SKILL.md and add a brainstorm command powered by conversation.md.

## Requirements

- REQ-1: `implement` must read tests.md first and use it to drive implementation order — write test code before implementation code per phase
- REQ-2: `quality-gate` must write a failing test reproducing a bug before attempting any fix
- REQ-3: New `/laneconductor brainstorm [track]` skill command — reads all context files, asks clarifying questions via conversation.md, updates spec/plan/tests when done
- REQ-4: New `lc brainstorm [track-number]` CLI command — wrapper that invokes the skill command
- REQ-5: UI "Brainstorm" button in track detail panel alongside existing action buttons
- REQ-6: MIT attribution comment added to top of SKILL.md

## Acceptance Criteria

- [ ] `implement` section in SKILL.md contains explicit TDD protocol: tests.md → write failing test → confirm failure → implement → confirm pass
- [ ] `quality-gate` Self-Healing section requires failing test before fix
- [ ] `/laneconductor brainstorm` command documented in SKILL.md with full protocol
- [ ] `lc brainstorm <track>` works from CLI, invokes claude with brainstorm prompt
- [ ] UI TrackDetailPanel has "Brainstorm" button that writes trigger to conversation.md
- [ ] MIT attribution comment at top of SKILL.md
- [ ] `lc brainstorm` appears in `lc --help` output

## Workflow

```
newTrack → plan → [brainstorm?] → implement → review → quality-gate → done
```

Brainstorm is optional, not a lane. Called when you want to deepen the spec before implementing.

## Brainstorm Command Protocol

1. Read all context: `product.md`, `tech-stack.md`, `spec.md`, `plan.md`, `test.md`, `conversation.md`
2. Ask clarifying questions one at a time, appended to `conversation.md`
3. Human replies in `conversation.md` (or via UI conversation thread)
4. When human runs `/laneconductor plan NNN` next, plan reads conversation.md as enriched input and updates spec/plan/test accordingly
5. Write `**Waiting for reply**: yes` to `index.md` after posting a question

## Files Changed

- `conductor/.claude/skills/laneconductor/SKILL.md` — implement TDD protocol, quality-gate failure protocol, brainstorm command, attribution, quick reference update
- `bin/lc.mjs` — add `brainstorm` subcommand
- `ui/src/components/TrackDetailPanel.jsx` (or similar) — add Brainstorm button
