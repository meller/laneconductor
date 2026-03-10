# Spec: Track 1044 — Pre-publish Cleanup

## Problem Statement

The repo contains debug scripts, hardcoded production credentials, unignored artefacts, and no LICENSE file. These must be resolved before the repository can be made public on GitHub.

## Requirements

### REQ-1: Delete root-level debug scripts
All one-off `check_*.mjs`, `fix_*.mjs`, `reset_*.mjs`, and temporary test scripts at the repo root must be deleted. They contain hardcoded DB URLs and serve no purpose for public consumers.

Files to delete:
- `check_actions.mjs`, `check_all_action_status.mjs`, `check_automation.mjs`, `check_automation_ready.mjs`
- `check-db.js`, `check_file_db_sync.mjs`, `check_running_lanes.mjs`, `check_schema_info.mjs`
- `check_schema.mjs`, `check_tracks.mjs`, `check_track_status.mjs`, `check_waiting_tracks.mjs`
- `debug-workflow.js`, `delete_old_tracks.mjs`, `detailed_check.mjs`
- `fix-db.js`, `fix-plan.js`, `fix_track_status.mjs`, `fix_workflow.js`
- `list_queue_tracks.mjs`, `reset_running.mjs`, `reset_stuck_running.mjs`
- `sync_files_to_queue.mjs`, `test-final.mjs`, `test_parse.js`, `test-supabase.mjs`
- `tmp_test_db.mjs`, `check_1033_comments.mjs` (if present)

### REQ-2: Fix hardcoded Supabase credentials in cloud functions
Three cloud function files contain hardcoded production DB host and user:
- `cloud/functions/index.js:18-19` — fully hardcoded (no env fallback)
- `cloud/functions/reader.js:14-15` — has env fallback but leaks real values as default
- `cloud/functions/reader.mjs:23-24` — same as reader.js

Replace with Secret Manager reads (same pattern as the existing DB password). Secret names: `CLOUD_DB_HOST` and `CLOUD_DB_USER`.

### REQ-3: Update .gitignore
Add missing patterns to prevent future accidental commits:
- `*.log` (covers root-level api.log, collector.log, sync.log, ui-dev.log)
- `test-results/`
- `playwright-report/`
- `generated/` (Prisma generated client — never commit)
- `.claude/settings.local.json`
- `ui/.ui.pid`, `.ui.pid`
- `tmp_*.mjs`, `check_*.mjs` (guard against re-adding debug scripts)

### REQ-4: Add LICENSE file
Add MIT License at repo root. Author: Asaf Meller, Year: 2026.

### REQ-5: Delete one-off internal docs at root
- `MIGRATION_GUIDE.md` — internal migration note, not useful to public
- `PARALLEL_LIMIT_FIX.md` — internal debugging note

### REQ-6: Remove/gitignore generated Prisma client
`generated/` contains compiled Prisma runtime files — not source code, not useful to public, should be in .gitignore and removed from git tracking if tracked.

## Acceptance Criteria

- [ ] No `check_*.mjs` / `fix_*.mjs` / `reset_*.mjs` files at repo root
- [ ] No hardcoded Supabase host/user in any committed file (verified by grep)
- [ ] `.gitignore` covers logs, test-results, generated/, .claude/settings.local.json
- [ ] `LICENSE` file exists at repo root with MIT license text
- [ ] `node --check` passes on all modified .mjs/.js files in cloud/functions/
- [ ] `git ls-files | grep -E 'check_|fix_|reset_'` returns empty
