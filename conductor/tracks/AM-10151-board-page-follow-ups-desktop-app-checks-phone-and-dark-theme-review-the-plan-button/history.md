# History: AM-10151

- 2026-11-19 ℹ️ Created when the owner closed track 10115: its unverified and unbuilt board-page items, parked in the backlog.
- 2026-11-20 ✅ Board 1.10.8: the hook script has a `seen` step and the refresh command runs it after a publish, so a refresh that was just made is not asked for again.
- 2026-11-20 ✅ Board 1.10.9: a lane that starts running asks for one quiet refresh at once; the refresh the hook asks for is quiet (no report unless it failed).
