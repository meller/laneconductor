# Archive

Folders that are not live tracks, kept for reference and in git history.

`tracks/` holds 51 `_duplicate-*` folders and `manager`, moved out of `conductor/tracks/` on 2026-11-22 (owner asked for a clean board):

- `_duplicate-*`: copies set aside in September 2026 when the database-era sync found two folders with one track number or damaged metadata. Many are the only copy of their track (no live folder has the number). Nothing in them was changed.
- `manager`: a one-file folder with no lane from the database-era Track manager.

To bring one back, `git mv` it into `conductor/tracks/` (rename it without the `_duplicate-` prefix and give it a lane and status).
