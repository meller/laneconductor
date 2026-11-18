# Spec: create_track sees other branches; renumber and repair for duplicate track numbers; reuse a track before opening one

## Problem Statement

From the audit (findings D4, D5, severity medium). Number allocation (connector/src/tools/create-track.mjs:29-47) scans local and upstream directories under a lock but is blind to other worktrees' branches, unpushed clones and folders created outside the connector. Real incident: otralingo carried a duplicate AM-1214 from 2026-10-27 until 2026-11-18 (renumbered to AM-1301 in commit 9e66c30e) and the logs show 2 AMBIGUOUS_TRACK errors; the connector blocks `get_track` and `update_track` for an ambiguous number and has no repair path (the daemon quarantined `_duplicate-*` folders: services/track-folder.mjs, commits 6f88537d, eec5eb38).

Scope: also scan `refs/heads/*` and `refs/remotes/*` trees for `conductor/tracks/` when allocating; surface duplicates as a `create_track` warning; add a repair prompt or command that renames the newer folder, fixes its `# Track` id and the summary, with a yes first; board keeps hiding `_duplicate-` folders. Also drop the always-on `possibly_stale` noise when the repo is only ahead of upstream with no upstream consumer (audit D7), keep `behind_upstream`.

## Added 2026-11-18 (owner rule): search first, the default is update, not create

Owner: look for an existing track before creating one. The person is asked, but the question is "update track N?", and the default answer is yes. Creating is the exception, never the default. The agent in the otralingo project kept opening tracks, so the rule must ship in the general plugin, not only live in this project's memory. It belongs here because tracks get created in `create_track`, so the fix is in the same code and the same guides.

The flow, in every procedure that could create a track (`new`, `bug`, `feature`, `newTrack`, and any agent that decides on its own that "this needs a track"):
1. Search first: list the tracks by the key words of the request, in every lane including the backlog and done, and read the best matches.
2. If one fits: say so and ask "Update track N (title, lane) with this? [default: yes]". On yes (or no answer to a default-yes question), extend that track (its spec or plan, through the normal conflict-checked write) and do NOT create. If the match is a done track, the question is the same and the update reopens it only with the person's yes.
3. If the person says no, or nothing fits: create, and say which tracks were looked at and why none fit.
4. Several small gaps in one session go into one fitting track, an epic or one backlog track, not one track each.

Connector: `create_track` returns a `similar_tracks` field (up to 5 by title and summary words, any lane, with number, lane and lane status) and a warning on a strong match, so the caller sees it before the track exists. It never blocks: the caller may still create after the person has said no. Keep the context-size budget test (KC-8) passing; it is nearly at its limit.

Tests: fixture projects where the new work matches an existing track (similar_tracks lists it), matches nothing (empty), matches only a done track (listed, marked done); text tests that the `new`, `bug` and `feature` procedures contain the search-first step, the default-yes question and the line that create is the fallback, and name the backlog lane.

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
