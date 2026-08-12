# Track 1068: Marketing & Sales (Biz Dev) Track Support

**Lane**: review
**Lane Status**: running
**Waiting for reply**: no
**Progress**: 100%
**Phase**: Phase 8 — complete
**Type**: dev
**Summary**: Extend LaneConductor to support non-dev track types (marketing, sales, support) with KPI definitions, auto-research measurement, closed-loop experiment workflow, and skill recommendations.

## Problem

LaneConductor only models dev work. Marketing and sales activities have no first-class home — no KPI targets, no outcome measurement, no way to know if a track "worked" beyond task completion. The result: done means shipped, not succeeded.

## Solution

Add track types (dev / marketing / sales / support / other) where non-dev types carry a KPI block. The quality gate evaluates KPI attainment via an auto-research measurement module. Failed KPI gates replan with measurement data attached, creating a closed experiment loop. Relevant marketing/sales skills are recommended (and warned if missing) when a track of that type is created or enters implement.

## Phases

- [ ] Phase 1: Track type field + KPI schema in index.md / spec.md templates
- [ ] Phase 2: Planning skill enforces KPI block for marketing/sales types
- [ ] Phase 3: measure.mjs — lightweight autoresearch measurement module
- [ ] Phase 4: Quality gate KPI evaluation (actual vs target, multi-source)
- [ ] Phase 5: Closed-loop replan — fail with measurement snapshot attached
- [ ] Phase 6: Skill recommendation + missing-skill warnings by track type
- [ ] Phase 7: UI — type badge and KPI progress on Kanban cards
