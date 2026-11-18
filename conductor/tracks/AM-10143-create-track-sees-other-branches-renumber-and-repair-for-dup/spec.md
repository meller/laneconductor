# Spec: create_track sees other branches; renumber and repair for duplicate track numbers; reuse a track before opening one

## Problem Statement

From the audit (findings D4, D5, severity medium). Number allocation (connector/src/tools/create-track.mjs:29-47) scans local and upstream directories under a lock but is blind to other worktrees' branches, unpushed clones and folders created outside the connector. Real incident: otralingo carried a duplicate AM-1214 from 2026-10-27 until 2026-11-18 (renumbered to AM-1301 in commit 9e66c30e) and the logs show 2 AMBIGUOUS_TRACK errors; the connector blocks `get_track` and `update_track` for an ambiguous number and has no repair path (the daemon quarantined `_duplicate-*` folders: services/track-folder.mjs, commits 6f88537d, eec5eb38).

Scope: also scan `refs/heads/*` and `refs/remotes/*` trees for `conductor/tracks/` when allocating; surface duplicates as a `create_track` warning; add a repair prompt or command that renames the newer folder, fixes its `# Track` id and the summary, with a yes first; board keeps hiding `_duplicate-` folders. Also drop the always-on `possibly_stale` noise when the repo is only ahead of upstream with no upstream consumer (audit D7), keep `behind_upstream`.

## Added 2026-11-18 (owner rule): reuse a track before opening one

Owner: do not open a new track every time; if a track can take the work, extend it; open a new one only when nothing fits. The agent in the otralingo project kept opening tracks, so the rule must ship in the general plugin, not only live in this project's memory. This belongs here because the place where tracks get created is `create_track`, so the fix is in the same code and the same guides.

- Text, base plugin and add-ons (source skill and connector guides, regenerated into the plugins): the procedures for `new`, `bug`, `feature` and `newTrack` (ops/tracks.md, the commands, the connector `create_track` description) start with a search: list the tracks (query on the key words, including the backlog and done lanes), and when one fits, extend it (add the work to its spec or plan, through the track write) instead of creating a new one. When several small gaps appear in one session, put them in one fitting track, an epic or one backlog track, not one track each. Ask the person only when the match is borderline; name the track found and the reason. Create a new track only when nothing fits, and say which tracks were looked at.
- Connector: `create_track` returns a `similar_tracks` field (up to 5 by title and summary words, any lane, with number, lane and lane status) and a warning when one matches strongly, so the caller sees it before the track exists. It never blocks: the caller may still create. Keep the context-size budget test (KC-8) passing; it is nearly at its limit.
- Tests: fixture projects where the new work matches an existing track (similar_tracks lists it), matches nothing (empty), matches only a done track (still listed, marked done); text test that the `new`, `bug` and `feature` procedures contain the search-first step and name the backlog lane.

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
