# Tests: AM-10152

- [x] TC-1 (REQ-2): a track with no `Serves` gets a plan-lane note and nothing breaks (text pinned by kpi-text.test.mjs; not run in a scratch project)
- [x] TC-2 (REQ-2): a track serving only a future KPI gets the warning with the reason; serving one active KPI among several gets none (text pinned by kpi-text.test.mjs; not run in a scratch project)
- [x] TC-3 (REQ-3): `next` lists active-KPI tracks first and names the KPI (ranking in the board's What's next panel tested in board-next.test.mjs; the /next command carries the same rule as text)
- [~] TC-4 (REQ-4): on a scratch repository with a README, setup proposes KPIs and writes no targets (text only; not run in a project, accepted at close)
- [x] TC-5 (REQ-5): the board shows the badge and the per-KPI count (board-page.test.mjs)
- [x] TC-6 (REQ-6): `update_track` with `serves` writes the marker; a stale edit shows CONFLICT (update_track takes any marker, checked in the code; list_tracks serves filter tested in kpis.test.mjs)
- [~] TC-7 (REQ-7): marking a KPI active lists its backlog tracks and moves nothing without a yes (text only; not run in a project, accepted at close)
- [x] TC-8 (REQ-8): an old project with no KPI markers behaves as before (kpis.test.mjs: no Focus column means every KPI active; board-next.test.mjs: no kpis.md keeps the old order)
