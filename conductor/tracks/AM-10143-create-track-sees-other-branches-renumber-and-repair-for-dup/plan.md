# Track 10143: create_track sees other branches; renumber and repair for duplicate track numbers

Scope of this implement pass: only the section "Added 2026-11-18 (owner rule): search first, the default is update, not create" of spec.md. Number allocation across branches, duplicate repair and the possibly_stale change stay for later (not ticked below, not started).

Implemented on branch of worktree agent-abe2a9148b49e9bb2, commit 83199fe1.

## Phase 1: Text, search first and default update

Problem: agents open a new track when an existing one fits.
Solution: one flow in every place that can create a track; works without the connector.

- [x] ops/tracks.md: new section "Search first: the default is update, not create"; `newTrack`, `updateTrack`/`reportaBug`/`featureRequest` point to it (search by key words in every lane incl. backlog and done, ask "Update track N (title, lane) with this? [default: yes]", done track reopens only on a yes, create is the fallback and names the tracks looked at, small gaps go into one fitting track/epic/backlog track); how to list without the connector (tracks-summary.md or the folders)
- [x] lanes/plan.md, lanes/brainstorm.md, ops/working-a-track.md, SKILL.md row (source skill) and connector/guides/plan.md, brainstorm.md: same rule where an agent decides on its own that a track is needed
- [x] connector/src/commands.mjs `new`, `bug`, `feature` procedures carry the flow; the base's own procedures (scripts/plugin-texts.mjs) carry it too, reading tracks-summary.md or the folders
- [x] node scripts/build-plugin.mjs regenerates plugins/**

## Phase 2: Connector, similar_tracks

- [x] create_track returns `similar_tracks` (up to 5 by title and summary words, any lane; number, title, lane, lane_status) and a warning on a strong match; never blocks. Note: it is computed from the tracks that existed before this create, and it is returned with the result, so the track already exists when the caller sees it; the warning says to move the content to the matching track if it duplicates
- [x] tool description changed in a few words only (KC-8 stays green)

## Phase 3: Tests and checks

- [x] tests: match, no match, only a done track; text tests for new, bug, feature (connector/test/search-first.test.mjs)
- [x] cd connector && npm test green (418: 407 + 11); build-plugin --check clean; claude plugin validate --strict on the three plugins and the root
