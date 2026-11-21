# History: AM-10151

- 2026-11-19 ℹ️ Created when the owner closed track 10115: its unverified and unbuilt board-page items, parked in the backlog.
- 2026-11-20 ✅ Board 1.10.8: the hook script has a `seen` step and the refresh command runs it after a publish, so a refresh that was just made is not asked for again.
- 2026-11-20 ✅ Board 1.10.9: a lane that starts running asks for one quiet refresh at once; the refresh the hook asks for is quiet (no report unless it failed).
- 2026-11-20 ✅ One namespace: base 1.9.14 and board 1.10.10. /laneconductor:board refresh is the partial publish; the board add-on has no commands; the hook asks for it. Not tried end to end in a second project yet.
- 2026-11-21 ✅ Base 1.9.15 and board 1.10.11: a project finds its own board by the project name inside each board's board.json, a board is titled after its project, and the settings are read from the main checkout in a worktree. Triggered by the Coach AI project creating a duplicate board. The duplicate was deleted.
