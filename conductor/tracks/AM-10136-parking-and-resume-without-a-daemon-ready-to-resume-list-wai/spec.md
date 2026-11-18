# Spec: Parking and resume without a daemon: ready-to-resume list, Waiting Reason, Depends On gate

## Problem Statement

From the 2026-11-18 audit (findings C1, C2, C3, C5, severity high/medium). The skill text says "The reconciler resumes the track" (.claude/skills/laneconductor/SKILL.md:143) but no reconciler exists in the plugin world. In otralingo, 4 parked tracks have dependencies already `done:success` (AM-1292 on 1208, AM-1295 on 1227, AM-1303 on 1224, AM-1304 on 1222) and stay parked; all 28 waiting tracks have no `**Waiting Reason**`, a marker no skill or connector file mentions. `create_track` only checks that dependency numbers are digits, `update_track` lets a track claim with unmet dependencies, and nothing clears parking markers on resume.

Scope: fix the false sentence now; compute `blocked_by` and `ready_to_resume` in `list_tracks`, `get_track`, `get_context`; require a Waiting Reason when `Lane Status` becomes `waiting` (warn, lint); reject unknown dependency numbers in `create_track`; clear parking markers on resume (Waiting Reason, Waiting On Tracks); the human or agent resumes with `update_track`. Reference: daemon services/dependency-resume.mjs, waiting-state.mjs, tracks 10055, 10086, 10091.

## Symptom

(To be filled in.)

## Steps to reproduce

(To be filled in.)

## Expected result

(To be filled in.)

## Actual result

(To be filled in.)

## Suspected area

(To be filled in.)

## Environment

(To be filled in.)
