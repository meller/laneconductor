# remote-sync `[track-number?]`

Parked: only for `local-api` / `remote-api` modes. Run it only when the user asks. `lc remote-sync`
is the CLI form (newer timestamp wins).

**Phase 5 Implementation** — Sync track changes from the Collector API back to local filesystem.

**Problem**: When using a remote Collector API/database, UI changes (dragging tracks to lanes, updating progress) happen in the DB but don't reach the local worker's filesystem. The worker can't see them.

**Solution**: A bidirectional sync mechanism where the Skill reads from the API and writes to local files.

**Usage**:
```bash
# Sync a single track from DB to file
/laneconductor remote-sync NNN

# Sync all tracks from DB to files
/laneconductor remote-sync
```

**What it does**:
1. Read `.laneconductor.json` for collector URL and project ID
2. Fetch tracks from `GET /api/projects/:id/tracks` endpoint
3. For each track returned:
   - Extract: `track_number`, `title`, `lane_status`, `lane_action_status`, `progress_percent`, `current_phase`
   - Find or create `conductor/tracks/NNN-*/index.md`
   - Update markers: `**Lane**`, `**Lane Status**`, `**Progress**`, `**Phase**`
   - Use regex to update existing markers or prepend new ones
4. Update `.conductor/tracks-metadata.json` with sync timestamps
5. Log results: number of tracks updated, any conflicts or errors
6. Regenerates `conductor/tracks.md` afterwards (see `init-tracks-summary` in `ops/tracks.md`)

**Architecture**:
- **Skill reads API** (not DB directly) — ensures it works with both local and remote collectors
- **Writes local files** — respects filesystem-as-source-of-truth for worker
- **Timestamp-based conflict resolution** — newer timestamp (file vs DB) wins
- **Metadata tracking** — `conductor/.tracks-metadata.json` stores `last_db_update` per track for conflict resolution

**Only activates if**:
- `.laneconductor.json` has a `collectors` array with at least one configured collector
- Track files exist locally (creates them if missing, but won't create new track folders)
