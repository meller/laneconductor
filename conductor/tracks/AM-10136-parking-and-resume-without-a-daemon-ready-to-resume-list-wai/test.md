# Tests: Track 10136

All in connector/test/parking.test.mjs.

- [x] TC-1 (regression) the skill no longer says a reconciler resumes a track; it says who does
- [x] TC-2 dependency state: unmet, unknown number, met, Waiting On Tracks, waiting-for-reply exclusion, done lane excluded
- [x] TC-3 list_tracks / get_track / get_context show blocked_by and ready_to_resume (over stdio)
- [x] TC-4 create_track with an unknown depends_on is VALIDATION_FAILED and writes nothing; a known one works
- [x] TC-5 update_track to a non-waiting status clears the parking markers; keeps them when the caller sets them
- [x] TC-6 warning when a track becomes waiting without Waiting Reason; none with one; lint line in the summary
- [x] TC-7 warning when a track claims (running) with unmet dependencies
- [x] TC-8 `cd connector && npm test` green (434), build-plugin --check clean
