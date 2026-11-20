# Track AM-10152: KPI-driven tracks: every track serves a KPI, tracks for future KPIs wait in the backlog

**Lane**: review
**Lane Status**: queue
**Progress**: 90%
**Phase**: Built and released 2026-11-20 as base 1.9.13 and board 1.10.7: the Serves list, Focus in kpis.md, the plan-lane step and promotion offer, the gate note, next ranking (command and board panel), the future-KPI badge, search and per-KPI count, the list_tracks serves filter. 910 tests. Not yet tried end to end in a real project (TC-4 setup proposals, TC-7 promotion): run /laneconductor:plan on a track in MakroDash with a kpis.md that has Focus columns.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Tracks are ordered only by technical dependencies. KPIs exist today only for marketing, sales and support tracks (a `## KPI` block in the spec, `Maps To` a line in `conductor/kpis.md`, `KPI Check After` in the implement lane). A dev track has no link to a product or business goal, so nobody can see which work serves what we are trying to achieve now, or which work is for a later goal.
**Summary**: Every track names the KPI it serves. KPIs are `active` (several at once is fine) or `future`. Tracks that serve an active KPI work in the plan, implement and review lanes; tracks that serve only a future KPI wait in the backlog and are promoted when their KPI becomes active. Setup proposes the KPIs from the project's own documents and code.
