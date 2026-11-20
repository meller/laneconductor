# Tests: AM-10152

- [ ] TC-1 (REQ-2): a track with no `Serves` gets a plan-lane note and nothing breaks
- [ ] TC-2 (REQ-2): a track serving only a future KPI gets the warning with the reason; serving one active KPI among several gets none
- [ ] TC-3 (REQ-3): `next` lists active-KPI tracks first and names the KPI
- [ ] TC-4 (REQ-4): on a scratch repository with a README, setup proposes KPIs and writes no targets
- [ ] TC-5 (REQ-5): the board shows the badge and the per-KPI count
- [ ] TC-6 (REQ-6): `update_track` with `serves` writes the marker; a stale edit shows CONFLICT
- [ ] TC-7 (REQ-7): marking a KPI active lists its backlog tracks and moves nothing without a yes
- [ ] TC-8 (REQ-8): an old project with no KPI markers behaves as before
