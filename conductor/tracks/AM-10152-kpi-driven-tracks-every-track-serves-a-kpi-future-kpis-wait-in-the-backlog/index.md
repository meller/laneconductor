# Track AM-10152: KPI-driven tracks: every track serves a KPI, tracks for future KPIs wait in the backlog

**Lane**: implement
**Lane Status**: queue
**Progress**: 0%
**Phase**: In implement (owner, 2026-11-20). Phase 1 first: settle the open questions in the spec (does a KPI depend on another, can a track serve several KPIs, where the measured value lives, does the quality gate check the mapping), then build. It no longer waits for the directory decision (owner: do not wait for the review).
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Tracks are ordered only by technical dependencies. KPIs exist today only for marketing, sales and support tracks (a `## KPI` block in the spec, `Maps To` a line in `conductor/kpis.md`, `KPI Check After` in the implement lane). A dev track has no link to a product or business goal, so nobody can see which work serves what we are trying to achieve now, or which work is for a later goal.
**Summary**: Every track names the KPI it serves. KPIs are `active` (several at once is fine) or `future`. Tracks that serve an active KPI work in the plan, implement and review lanes; tracks that serve only a future KPI wait in the backlog and are promoted when their KPI becomes active. Setup proposes the KPIs from the project's own documents and code.
