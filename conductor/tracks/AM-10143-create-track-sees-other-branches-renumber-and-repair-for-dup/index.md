# Track AM-10143: create_track sees other branches; renumber and repair for duplicate track numbers

**Lane**: implement
**Lane Status**: queue
**Progress**: 0%
**Phase**: Owner said go on 2026-11-18: build the search-first, default-update rule (text in all plugins plus similar_tracks in create_track) and release as a patch. Number allocation and duplicate repair stay for later.
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings D4, D5, severity medium). Number allocation (connector/src/tools/create-track.mjs:29-47) scans local and upstream directories under a lock but is blind to other worktrees' branches, unpushed clones and folders created outside the connector. Real incident: otralingo carried a duplicate AM-1214 from 2026-10-27 until 2026-11-18 (renumbered to AM-1301 in commit 9e66c30e) and the logs show 2 AMBIGUOUS_TRACK errors; the connector blocks `get_track` and `update_track` for an ambiguous number and has no repair path (the daemon quarantined `_duplicate-*` folders: services/track-folder.mjs, commits 6f88537d, eec5eb38).

Scope: also scan `refs/heads/*` and `refs/remotes/*` trees for `conductor/tracks/` when allocating; surface duplicates as a `create_track` warning; add a repair prompt or command that renames the newer folder, fixes its `# Track` id and the summary, with a yes first; board keeps hiding `_duplicate-` folders. Also drop the always-on `possibly_stale` noise when the repo is only ahead of upstream with no upstream consumer (audit D7), keep `behind_upstream`.
**Summary**: From the audit (findings D4, D5, severity medium). Number allocation (connector/src/tools/create-track.mjs:29-47) scans local and upstream directories under a lock but is blind to other worktrees' bra
