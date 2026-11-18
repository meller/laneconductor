# Track 10143: create_track sees other branches; renumber and repair for duplicate track numbers

Pass 1 (search first, default update) is shipped in 1.1.1. Pass 2 (this one) is the number allocation and the duplicate repair; the possibly_stale noise item was skipped (see below).

## Phase 1: Text, search first and default update (shipped, pass 1)

- [x] ops/tracks.md section "Search first", lane guides, command procedures, base procedures
- [x] create_track `similar_tracks` and a warning on a strong match
- [x] tests in connector/test/search-first.test.mjs

## Phase 2: Allocation across branches and duplicates (pass 2)

- [x] `LocalGitStore.refDirs` lists the track folders of every other local branch and remote-tracking ref (refs at the same commit read once, capped at 100 commits); `create_track` numbers after the highest of local, upstream and those.
- [x] `duplicateNumbers` (tracks.mjs): the same number under different folder names across local, upstream and branches is a `create_track` warning ("Duplicate track numbers: N (2 folders)"), up to 5.
- [x] `repair-duplicates` command (catalog, base procedure, coverage entry): finds duplicates (list_tracks warning or git refs), the older folder keeps the number (first commit that added it), shows one line per rename with a default-yes question and waits, then `git mv`, fixes the number in the headings, adds a conversation comment, commits explicit paths, never pushes, and lists dependents without changing them. The connector has no rename tool and none was added (KC-8 has no room); the board already hides `_duplicate-` folders.
- [ ] Skipped: the `possibly_stale` noise for a repo that is only ahead of upstream with no upstream consumer (audit D7). It changes the freshness vocabulary other tools and tests rely on, so it is not trivial; left for its own track.

## Phase 3: Checks

- [x] connector/test/create-branches.test.mjs (5 tests); npm test 461 green; build-plugin --check clean; strict validate on the three plugins and the root.
