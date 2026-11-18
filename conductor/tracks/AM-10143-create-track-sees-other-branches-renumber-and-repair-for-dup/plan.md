# Track 10143: create_track sees other branches; renumber and repair for duplicate track numbers

Scope of this implement pass: only the section "Added 2026-11-18 (owner rule): search first, the default is update, not create" of spec.md. Number allocation across branches, duplicate repair and the possibly_stale change stay for later.

## Phase 1: Text, search first and default update

Problem: agents open a new track when an existing one fits.
Solution: one flow in every place that can create a track; works without the connector.

- [ ] ops/tracks.md: `newTrack`, `updateTrack`/`reportaBug`/`featureRequest` get the flow (search by key words in every lane incl. backlog and done, ask "Update track N (title, lane) with this? [default: yes]", done track reopens only on a yes, create is the fallback and names the tracks looked at, small gaps go into one fitting track/epic/backlog track); how to list without the connector (tracks-summary.md or the folders)
- [ ] lanes/plan.md, lanes/brainstorm.md, ops/working-a-track.md (source skill) and connector/guides/plan.md, brainstorm.md: same rule where an agent decides on its own that a track is needed
- [ ] connector/src/commands.mjs `new`, `bug`, `feature` procedures carry the flow
- [ ] node scripts/build-plugin.mjs regenerates plugins/**

## Phase 2: Connector, similar_tracks

- [ ] create_track returns `similar_tracks` (up to 5 by title and summary words, any lane; number, title, lane, lane_status) and a warning on a strong match; never blocks
- [ ] tool description changed in a few words only (KC-8 stays green)

## Phase 3: Tests and checks

- [ ] tests: match, no match, only a done track; text tests for new, bug, feature
- [ ] cd connector && npm test green; build-plugin --check clean; claude plugin validate --strict on the three plugins and the root
