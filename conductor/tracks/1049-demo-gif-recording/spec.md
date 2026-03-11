# Spec: Track 1049 — Demo GIF / Screen Recording

## Problem Statement
Every launch post underperforms without a visual. A demo GIF showing the Claude CLI → Kanban live sync is the single highest-leverage asset. Screenshots don't capture the moment the board updates as Claude works.

## Demo Concept
**Title**: "File a bug → Claude writes the regression test → Kanban updates live"

**Setup**:
- `lc start sync-only` (worker syncs files → DB, no auto-polling)
- Split screen: Claude CLI terminal (left) + Kanban dashboard at localhost:8090 (right)
- Subject track: **Track 1045** (Bug to Test Flow — real code feature in laneconductor)

**Script** (45–60 seconds):
1. Kanban board visible, Track 1045 in `plan` lane
2. `/laneconductor brainstorm 1045` → Claude asks clarifying questions, card shows "Waiting for reply"
3. Human answers → `/laneconductor plan 1045` → Claude writes spec.md + plan.md, card updates
4. `/laneconductor implement 1045` → **money shot**: Claude writes real code + tests, card slides in-progress → review in real-time

**What makes this compelling**:
- Human + Claude collaboration is visible (brainstorm Q&A)
- Claude writes actual code (not just content)
- The feature being built IS part of LaneConductor (dogfooding)
- Kanban card moves without the human touching it

## Requirements
- REQ-1: Split-screen: Claude CLI terminal (left) + Kanban browser (right)
- REQ-2: Worker in `sync-only` mode — `lc start sync-only`
- REQ-3: Demo subject: Track 1045 (bug to test flow code feature)
- REQ-4: GIF ≤ 15MB for GitHub README rendering
- REQ-5: GIF exported to `docs/demo.gif` and committed
- REQ-6: GIF embedded in README below `docs/hero.png`

## Environment
- OS: Ubuntu (Linux)
- Screen recorder: Peek (installed, FPS = 10)
- Dashboard: http://localhost:8090
- Worker mode: `lc start sync-only`

## Acceptance Criteria
- [ ] `docs/demo.gif` exists, non-zero, ≤ 15MB
- [ ] GIF shows split-screen (terminal + Kanban)
- [ ] At least one lane transition visible (plan → in-progress → review)
- [ ] Human brainstorm Q&A visible in terminal
- [ ] Claude writing code visible in terminal
- [ ] README embeds the GIF below the hero image
- [ ] Committed and pushed to GitHub
