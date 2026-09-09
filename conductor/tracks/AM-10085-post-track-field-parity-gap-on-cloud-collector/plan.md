# Track AM-10085: POST /track field-parity gap on the cloud collector

Filed as a Phase 6 follow-up from track AM-10083 (see that track's spec.md
Finding F-3 and Non-Goals). Not yet planned — run `/laneconductor plan 10085`.

Originally filed as AM-10084, but that number was independently assigned to
a different track ("Meta-level config defaults cascading to projects") in
main while this one only existed on the track-10083 branch; the collision
surfaced — and corrupted the pre-existing AM-10084's synced DB fields — when
track-10083 was merged. Renumbered to AM-10085 during that merge to resolve
it; see track-10083's merge for the live incident. The underlying
track-numbering race (two independent creations, on different worktrees,
computing the same "next free number") is unresolved and worth its own
track.
