# Track AM-10152: KPI-driven tracks: every track serves a KPI, tracks for future KPIs wait in the backlog

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Parked in the backlog 2026-11-20: an idea from the owner, not yet brainstormed. It changes the base plugin (plan lane guide, marker table, next, setup), so it cannot ship before the directory decision on track 10148.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10148
**Problem**: Tracks are ordered only by technical dependencies. KPIs exist today only for marketing, sales and support tracks (a `## KPI` block in the spec, `Maps To` a line in `conductor/kpis.md`, `KPI Check After` in the implement lane). A dev track has no link to a product or business goal, so nobody can see which work serves what we are trying to achieve now, or which work is for a later goal.
**Summary**: Every track names the KPI it serves. KPIs are `active` (several at once is fine) or `future`. Tracks that serve an active KPI work in the plan, implement and review lanes; tracks that serve only a future KPI wait in the backlog and are promoted when their KPI becomes active. Setup proposes the KPIs from the project's own documents and code.
