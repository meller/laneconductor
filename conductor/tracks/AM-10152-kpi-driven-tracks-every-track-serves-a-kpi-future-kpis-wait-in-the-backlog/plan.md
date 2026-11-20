# Plan: AM-10152

## Phase 1: Decide (brainstorm lane)
- [x] Task 1: Brainstorm the open questions in the spec with the owner; record the answers in the spec
- [x] Task 2: Check that a plain `**Serves**` marker needs no change to the parallel connector's marker parser, or list the changes (REQ-6)

## Phase 2: Release train
- [~] Task 3: Superseded 2026-11-20: the owner said not to wait for the directory review; Phase 3 ships as the next base version (after 1.9.12)

## Phase 3: Build
- [x] Task 4: `kpis.md` template and track template with `Serves` (REQ-1, REQ-2, REQ-8)
- [x] Task 5: Plan lane guide asks and warns; `next` prefers active KPIs (REQ-2, REQ-3)
- [x] Task 6: Setup and new-project propose KPIs from the project's documents (REQ-4)
- [x] Task 7: Connector: `serves` in `update_track` (needs no change: any marker is accepted), KPI filter in `list_tracks`, `serves` in the track rows (REQ-6)
- [x] Task 8: Board: the future-KPI badge, search by KPI id, and the per-KPI count on the KPI button (REQ-5); a separate KPI grouping was not built
- [x] Task 9: Promotion helper (REQ-7): a sentence in the plan lane step (offer to move the backlog tracks of a KPI that turned active); no separate command
- [x] Task 10: Tests, strict validation and the directory profile; pay for the added text so the size ceilings hold; release with the version knob, telling the owner first
