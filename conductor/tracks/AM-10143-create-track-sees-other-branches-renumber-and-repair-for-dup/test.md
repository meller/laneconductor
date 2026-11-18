# Tests: Track 10143 - search first, the default is update, not create

Run: `cd connector && npm test`.

- [ ] TC-1: create_track in a fixture where the new work matches an existing track returns it in `similar_tracks` (number, title, lane, lane_status) and a warning; the track is still created
- [ ] TC-2: create_track where nothing matches returns an empty `similar_tracks` and no similar-track warning
- [ ] TC-3: create_track where only a done track matches lists it, with lane `done`
- [ ] TC-4: at most 5 similar tracks, best match first
- [ ] TC-5: the `new`, `bug` and `feature` procedures contain the search-first step, the default-yes question, the line that create is the fallback, and name the backlog lane
- [ ] TC-6: ops/tracks.md and the lane guides carry the rule and a way to list without the connector; the base plugin still passes base-no-daemon-text
- [ ] TC-7: KC-8 context budget test passes
