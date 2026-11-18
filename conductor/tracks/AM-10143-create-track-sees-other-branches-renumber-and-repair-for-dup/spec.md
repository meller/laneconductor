# Spec: create_track sees other branches; renumber and repair for duplicate track numbers; reuse a track before opening one

## Problem Statement

From the audit (findings D4, D5, severity medium). Number allocation (connector/src/tools/create-track.mjs:29-47) scans local and upstream directories under a lock but is blind to other worktrees' branches, unpushed clones and folders created outside the connector. Real incident: otralingo carried a duplicate AM-1214 from 2026-10-27 until 2026-11-18 (renumbered to AM-1301 in commit 9e66c30e) and the logs show 2 AMBIGUOUS_TRACK errors; the connector blocks `get_track` and `update_track` for an ambiguous number and has no repair path (the daemon quarantined `_duplicate-*` folders: services/track-folder.mjs, commits 6f88537d, eec5eb38).

Scope: also scan `refs/heads/*` and `refs/remotes/*` trees for `conductor/tracks/` when allocating; surface duplicates as a `create_track` warning; add a repair prompt or command that renames the newer folder, fixes its `# Track` id and the summary, with a yes first; board keeps hiding `_duplicate-` folders. Also drop the always-on `possibly_stale` noise when the repo is only ahead of upstream with no upstream consumer (audit D7), keep `behind_upstream`.

A second part, added 2026-11-18 by the owner: look for an existing track before creating one (section "The search-first flow" under Decisions).

## Requirements

Allocation and duplicates:

- REQ-1 Allocation across branches: when `create_track` allocates a number it also counts the track folders under `conductor/tracks/` on every other local branch and remote-tracking ref, so two worktrees do not hand out the same number. Refs at the same commit are read once; the 100 newest tips are read, and one warning says so when the cap stops the scan.
- REQ-2 Duplicate warning: two different folder names carrying one number on the state branch or its upstream is a `create_track` warning ("Duplicate track numbers: N (2 folders)", up to 5 numbers) that names the repair command. A folder that only another unmerged branch carries is a softer note ("also named differently on branch X"), silent once that branch is merged or deleted.
- REQ-3 Repair: a `repair-duplicates` command (catalog entry, base procedure, coverage entry) finds duplicates (list_tracks warning or git refs); the older folder (first commit that added it) keeps the number; it shows one line per rename with a default-yes question and waits; then `git mv`, fixes the number in the headings, adds a conversation comment, commits explicit paths, never pushes, and lists dependents without changing them. When the second folder exists only on another branch it asks which branch is the keeper and renames on the branch that carries the folder, in its own worktree.
- REQ-4 The board keeps hiding `_duplicate-` folders.
- REQ-5 Freshness noise (audit D7): drop the always-on `possibly_stale` for a repo that is only ahead of upstream with no upstream consumer; keep `behind_upstream`. Skipped, see Decisions.

Search first (owner rule):

- REQ-6 Search first, default update: every procedure that could create a track (`new`, `bug`, `feature`, `newTrack`, and any agent that decides on its own that "this needs a track") searches existing tracks first, asks "Update track N (title, lane) with this? [default: yes]", and creates only on a no or when nothing fits. The rule ships in the plugin text (ops/tracks.md, lane guides, command procedures, base procedures).
- REQ-7 `create_track` returns `similar_tracks` (up to 5 by title and summary words, any lane, with number, lane and lane status) and a warning on a strong match. It never blocks.
- REQ-8 The context-size budget test (KC-8) keeps passing; it is nearly at its limit, so no new tool description text.

## Decisions

- 2026-11-18 (owner rule): look for an existing track before creating one. The person is asked, but the question is "update track N?", and the default answer is yes. Creating is the exception, never the default. The agent in the otralingo project kept opening tracks, so the rule must ship in the general plugin, not only live in this project's memory. It belongs here because tracks get created in `create_track`, so the fix is in the same code and the same guides.
- The connector has no rename tool and none was added (KC-8 has no room); the repair is a command procedure.
- A number is a duplicate only when two folder names carry it on the state branch or its upstream, so the warning goes after a repair; folders on other unmerged refs give the softer note only (review fix).
- The `possibly_stale` only-ahead item changes the freshness vocabulary other tools and tests rely on, so it is not trivial; it was skipped and left for its own track. Open for the owner: keep or drop it (the track waits in quality-gate on this).

### The search-first flow (owner rule, 2026-11-18)

In every procedure that could create a track (`new`, `bug`, `feature`, `newTrack`, and any agent that decides on its own that "this needs a track"):
1. Search first: list the tracks by the key words of the request, in every lane including the backlog and done, and read the best matches.
2. If one fits: say so and ask "Update track N (title, lane) with this? [default: yes]". On yes (or no answer to a default-yes question), extend that track (its spec or plan, through the normal conflict-checked write) and do NOT create. If the match is a done track, the question is the same and the update reopens it only with the person's yes.
3. If the person says no, or nothing fits: create, and say which tracks were looked at and why none fit.
4. Several small gaps in one session go into one fitting track, an epic or one backlog track, not one track each.

Connector: `create_track` returns a `similar_tracks` field (up to 5 by title and summary words, any lane, with number, lane and lane status) and a warning on a strong match, so the caller sees it before the track exists. It never blocks: the caller may still create after the person has said no. Keep the context-size budget test (KC-8) passing; it is nearly at its limit.

Tests: fixture projects where the new work matches an existing track (similar_tracks lists it), matches nothing (empty), matches only a done track (listed, marked done); text tests that the `new`, `bug` and `feature` procedures contain the search-first step, the default-yes question and the line that create is the fallback, and name the backlog lane.

## Data model and API

- `create_track` response: `similar_tracks` (up to 5: number, title, lane, lane status); warnings for a strong match, for duplicate numbers (up to 5), for the softer other-branch note and for the 100-tip cap. No new input fields.
- `LocalGitStore.refDirs(dir, {max: 100})` returns the track folders of other local branches and remote-tracking refs; `duplicateNumbers` (connector/src/tracks.mjs) groups folder names by number.
- `repair-duplicates` is a command in the catalog (connector/src/commands.mjs; plugins/*/commands/repair-duplicates.md), not a tool.

## Acceptance criteria

- [x] A number that exists only on another local branch, or on a remote-tracking ref, is not handed out (REQ-1; test code present, not run).
- [x] The same number under different folder names on the state branch or its upstream is a `create_track` warning that names the repair command; a folder on an unmerged branch only gives the softer note (REQ-2; test code present, not run).
- [x] More than 100 branch tips gives one cap warning; a few branches give none (REQ-1; test code present, not run).
- [x] The `repair-duplicates` command asks first (default yes), renames the newer folder with git mv, never pushes and uses explicit paths; it is in the catalog and coverage lists (REQ-3; code and test present, not run).
- [x] The board hides `_duplicate-` folders (REQ-4; connector/src/board.mjs and test/board.test.mjs, not run).
- [x] `create_track` lists similar tracks for a match, none for no match, and a done-only match marked done; at most 5 (REQ-7; test code present, not run).
- [x] The `new`, `bug` and `feature` procedures (connector and base), the skill file and the lane guides carry the search-first flow (REQ-6; test code present, not run).
- [x] The KC-8 context-size test exists in connector/test/commands.test.mjs (REQ-8; whether it passes was not run).
- [ ] The `possibly_stale` only-ahead noise is dropped (REQ-5): not built, skipped; owner decision to keep or drop.
- [ ] Full `npm test` green and strict validate on the three plugins: not verified (the connector dependencies are not installed in this checkout, so the tests could not be run here).

## Risks and limits

- The branch scan reads the 100 newest branch tips only; a number used on an older branch may be handed out again (the cap warning says so).
- `similar_tracks` is pure word overlap; it informs the caller and never blocks, so an agent that ignores it can still create a track for the same purpose.
- The context-size budget (KC-8) is nearly at its limit; there is no room for a rename tool or new tool text.
- The repair command renames by `git mv` and does not change `**Depends On**` in other tracks; the person decides those.

## Out of scope

- A connector rename tool (no room under KC-8).
- Dropping the `possibly_stale` only-ahead noise in this track; it is left for its own track unless the owner decides otherwise.
