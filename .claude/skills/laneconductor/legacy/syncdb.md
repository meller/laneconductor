# syncdb `[--source <url>] [--target <url>]`

Parked: only needed when switching collectors. Run it only when the user asks.

Migrate track comments between collectors — critical when switching from local-only to cloud, or between workspaces.

**Problem**: Track metadata (status, progress) re-syncs naturally from filesystem. But comments are DB-only, so switching collectors loses conversation history.

**Solution**: Export comments from source, apply schema to target, then import.

**Usage**:
```bash
# Export from local DB, import to cloud
node conductor/syncdb.mjs \
  --source "postgresql://localhost:5432/laneconductor?..." \
  --target "postgresql://cloud-db.supabase.co/postgres?..."

# Save export for manual inspection
node conductor/syncdb.mjs \
  --source "postgresql://localhost/laneconductor" \
  --export comments.json

# Import previously exported file
node conductor/syncdb.mjs \
  --target "postgresql://cloud-db.supabase.co/postgres" \
  --import comments.json
```

**What it does**:
1. Query source: `track_comments` join with tracks/projects
2. Map to target: find matching project + track_number, insert comment
3. Touch filesystem: updates plan.md mod times → worker re-syncs tracks
4. Instructions: user updates `.laneconductor.json` collectors config + runs `lc stop`, `lc start`

**Important**:
- Only comments are synced — tracks re-sync from disk automatically
- Schema must exist on target (created if missing)
- Duplicate detection: tries to find matching project/track by name; skips if not found
- User must manually update config + restart worker
