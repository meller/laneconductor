# Tests: Track 10139 - Marker parser: first match wins, CRLF, case, and a repair_index write

All in `connector/test/markers-header.test.mjs` unless noted.

- [x] TC-1 (regression): a repeated Lane / Lane Status block does not fold into the marker above; the first wins; the track validates; `header_damaged` names the lines.
- [x] TC-2: over this repository's real indexes (read only): no throw, Lane and Lane Status are one line, repair removes every repeat and keeps every value the parser used.
- [x] TC-3: a CRLF index.md shows its markers; `setMarker` keeps CRLF byte for byte elsewhere.
- [x] TC-4: `**lane**` and `**Lane status**: QUEUE` read as lane plan, status queue; a write uses the canonical name.
- [x] TC-5: `repairIndex` keeps the first, moves the repeats below a heading before an existing `## ` section, keeps CRLF, is idempotent.
- [x] TC-6: through the connector: `update_track` on a damaged index works and warns; `repair_index` refuses to combine, needs the index base (BASE_MISSING_FILE), writes once, a second call says nothing to repair; `list_tracks` stops warning.
- [x] TC-7: `board.test.mjs` updated: a repeated marker and a value that ran into the body are no longer lint problems.
