# Track 10139: Marker parser: first match wins, CRLF, case, and a repair_index write

All in `connector/src/markers.mjs` plus small wiring; tests in `connector/test/markers-header.test.mjs`. Verified items are ticked.

- [x] 1. `parseMarkers`: split on `\r?\n`; a repeated header (case-insensitive) is not folded into the marker above, the first wins, the repeat is listed in `damaged` with its line number.
- [x] 2. Names match case-insensitively (`**lane**`, `**Lane status**` read as Lane, Lane Status); values of Lane and Lane Status are compared lower-cased and trimmed on read; Lane and Lane Status are one line, and a `# ` title line ends any value (legacy files whose value ran into the body).
- [x] 3. Writes are strict: the canonical name is written; the file's dominant line ending (CRLF or LF) is kept by `setMarker` and `removeMarker`.
- [x] 4. `header_damaged` warning (text from `headerDamagedWarning`) in `get_track`, `update_track` (when the written index is still damaged) and one aggregate line in `list_tracks`. Not added to the summary lint (the board fixtures repeat a Phase marker on purpose of nothing; a warning is enough).
- [x] 5. `repairIndex(content)`: keeps the first of each marker with canonical spelling, moves the repeated lines under `## Repeated header lines (moved by repair_index)` before the first `## ` heading, keeps CRLF, idempotent.
- [x] 6. `update_track` input `repair_index: true` (no description text, the context budget KC-8 has no room): stands alone, checked like a `files.index` replacement (needs `base.files.index`, so a changed index is a CONFLICT); a no-op says there is nothing to repair. The `header_damaged` warning tells the agent to ask the human first.
- [x] 7. Tests: this repository's real indexes read-only (309 now, 36 with a repeated header; 12 stay flagged for a genuinely missing or unknown Lane), CRLF fixtures, case fixtures, repair round trip through the connector.
- [x] 8. KC-8 headroom: trimmed wording of four input descriptions so the new field fits.
