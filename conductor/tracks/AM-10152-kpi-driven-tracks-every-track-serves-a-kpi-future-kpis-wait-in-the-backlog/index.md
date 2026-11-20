# Track AM-10152: KPI-driven tracks: every track serves a KPI, tracks for future KPIs wait in the backlog

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Closed 2026-11-20 by the owner. Released as base 1.9.13 and board 1.10.7 (KPI focus: a Serves list, Focus in kpis.md, the plan-lane step and promotion offer, the gate note, next ranking, the future-KPI badge, search and per-KPI count, the list_tracks serves filter). Not tried in a real project: setup proposing KPIs from a project's documents, and the offer to move a KPI's backlog tracks when it turns active. A separate KPI grouping on the board was not built.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Tracks are ordered only by technical dependencies. KPIs exist today only for marketing, sales and support tracks (a `## KPI` block in the spec, `Maps To` a line in `conductor/kpis.md`, `KPI Check After` in the implement lane). A dev track has no link to a product or business goal, so nobody can see which work serves what we are trying to achieve now, or which work is for a later goal.
**Summary**: Every track names the KPI it serves. KPIs are `active` (several at once is fine) or `future`. Tracks that serve an active KPI work in the plan, implement and review lanes; tracks that serve only a future KPI wait in the backlog and are promoted when their KPI becomes active. Setup proposes the KPIs from the project's own documents and code.
