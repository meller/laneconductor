# Track AM-10139: Marker parser: first match wins, CRLF, case, and a repair_index write

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings F1, F2, F3, severity medium, high on legacy repos). `parseMarkers` (connector/src/markers.mjs:27-33) folds a duplicated header into the previous marker's value; `validateIndex` then rejects the track and `update_track` refuses every marker edit on it (update-track.mjs:96-107); a `Lane Status` edit silently deletes the swallowed lines. Run over this repository, 44 of 239 tracks are flagged (35 duplicated Lane/Lane Status blocks, 8 without a Lane marker, 1 unknown lane), for example track 1020. A CRLF index.md shows no markers at all (`.` does not match `\r`); `**lane**` and `**Lane status**` are not recognised. The daemon was lenient: first match wins, `/i` regexes, trimmed CRLF (commit aa32bc5c).

Scope: first-match-wins plus a `header_damaged` warning; `split(/\r?\n/)` and preserve the file's line endings on write; case-insensitive marker names and lower-cased value compare on read, strict on write; one `repair_index` write that keeps the first Lane and Lane Status and moves the rest below a heading. Tests on the 44 real indexes (read-only copy) and CRLF fixtures.
**Summary**: From the audit (findings F1, F2, F3, severity medium, high on legacy repos). `parseMarkers` (connector/src/markers.mjs:27-33) folds a duplicated header into the previous marker's value; `validateIndex
