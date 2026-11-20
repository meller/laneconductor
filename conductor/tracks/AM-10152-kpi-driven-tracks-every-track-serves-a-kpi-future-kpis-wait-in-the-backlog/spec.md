# Spec: KPI-driven tracks (AM-10152)

Idea from the owner, 2026-11-20, while adding the KPI to track 10112 (posts program, a channel of 10149): "we are starting to be KPI driven". It connects a technical person to the product and business goals, and lets work be blocked by business progress, not only by technical dependencies.

## The model (proposed, to be settled in the brainstorm)

- KPIs live in `conductor/kpis.md` with a stable id (KPI-1, KPI-2...) and a status: `active` (being worked on now; several at once is fine) or `future`. Done or dropped KPIs are marked `done` or `dropped`. Keep it to a handful.
- Every track names the KPIs it serves: a marker `**Serves**: KPI-2` (a comma-separated list when it serves several). A pure enabler names the KPI it unblocks. A dev track needs the mapping only, not a measurable target; marketing, sales and support tracks keep their `## KPI` block with target and window, and `Maps To` is the same link.
- No ranking among KPIs and no dependency between them. The lanes carry the meaning: a track that serves an active KPI is planned, implemented and reviewed as today; a track that serves only a future KPI waits in the backlog. When a KPI becomes active, its backlog tracks are promoted to plan.
- Advisory, not a lock: the hard block stays `Waiting On Tracks`. The plan lane warns when a track serves no KPI, or only a future one, and says why; the person can decide against it.

## Requirements

- REQ-1 `conductor/kpis.md` template: ids, status per KPI (`active`, `future`, `done`, `dropped`), a line saying what a KPI is and not to invent numbers.
- REQ-2 The `**Serves**` marker (a list) in the marker table of the skill and in the track template; the plan lane asks which KPIs a track serves and warns when it is none or only future; the quality gate notes a missing one and never fails for it.
- REQ-3 `next` prefers tracks that serve an active KPI and says so; no ranking among active KPIs.
- REQ-4 Setup and new-project propose three to five KPIs from the README, docs and code of an existing project; the owner confirms; targets are left for the owner to set, never guessed.
- REQ-5 The board (add-on): group or filter by KPI, a badge on a track that serves only a future KPI, and a "tracks per KPI" count.
- REQ-6 The parallel connector: `list_tracks` filters by KPI; `update_track` accepts `serves`.
- REQ-7 Promotion helper: when the owner marks a KPI `active`, list its backlog tracks and offer to move them to plan (a second opinion; the owner confirms each move).
- REQ-8 Existing projects keep working with no `Serves` markers: a track without one is treated as unmapped, never as an error.

## Decisions (owner, 2026-11-20, Phase 1)

1. **A track can serve several KPIs**: `**Serves**: KPI-1, KPI-3`, a comma-separated list. A track is off-focus only when every KPI it serves is `future`; serving one active KPI among others is not off-focus.
2. **KPIs do not depend on each other.** Only `active`, `future`, `done` and `dropped`; no ranking and no "after" line. Add a dependency later only if real use needs it.
3. **The measured value lives by hand in `conductor/kpis.md`**, written by the owner or the agent at a readout, as the current KPI table does. The plugin measures nothing and sends nothing back. (Rolling up track results automatically is possible later, not now.)
4. **The plan lane warns and the quality gate only notes.** The plan lane asks which KPI a track serves and warns when there is none or only a future one. The quality gate mentions a missing `Serves` in its verdict as a note and never fails a track for it.

Check made while deciding (plan task 2): `update_track` takes any marker name, so `Serves` needs no change in the connector's marker handling; `list_tracks` gets an optional `serves` filter (REQ-6) and the board reads the marker (REQ-5).

## Out of scope

Computing KPI values from code; any analytics the plugin sends back (the plugin sends nothing, by design).

## First example

Track 10112 (posts program) maps to the GitHub Stars KPI through track 10149; track 10149 is the active KPI work today.
