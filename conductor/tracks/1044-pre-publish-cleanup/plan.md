# Track 1044: Pre-publish Cleanup

## Phase 1: Delete Root-Level Debug Scripts

**Problem**: ~25 one-off debug/test scripts at repo root contain hardcoded DB URLs and have no value to public consumers.
**Solution**: Delete all `check_*.mjs`, `fix_*.mjs`, `reset_*.mjs`, and other temp scripts.

- [x] Delete `check_actions.mjs`
- [x] Delete `check_all_action_status.mjs`
- [x] Delete `check_automation.mjs`
- [x] Delete `check_automation_ready.mjs`
- [x] Delete `check-db.js`
- [x] Delete `check_file_db_sync.mjs`
- [x] Delete `check_running_lanes.mjs`
- [x] Delete `check_schema_info.mjs`
- [x] Delete `check_schema.mjs`
- [x] Delete `check_tracks.mjs`
- [x] Delete `check_track_status.mjs`
- [x] Delete `check_waiting_tracks.mjs`
- [x] Delete `check_1033_comments.mjs`
- [x] Delete `debug-workflow.js`
- [x] Delete `delete_old_tracks.mjs`
- [x] Delete `detailed_check.mjs`
- [x] Delete `fix-db.js`
- [x] Delete `fix-plan.js`
- [x] Delete `fix_track_status.mjs`
- [x] Delete `fix_workflow.js`
- [x] Delete `list_queue_tracks.mjs`
- [x] Delete `reset_running.mjs`
- [x] Delete `reset_stuck_running.mjs`
- [x] Delete `sync_files_to_queue.mjs`
- [x] Delete `test-final.mjs`
- [x] Delete `test_parse.js`
- [x] Delete `test-supabase.mjs`
- [x] Delete `tmp_test_db.mjs`

**Impact**: Cleaner repo root; no hardcoded credentials in deleted files.

## Phase 2: Fix Hardcoded Supabase Credentials in Cloud Functions

**Problem**: Three cloud function files contain hardcoded Supabase host and user values that expose production infrastructure.
**Solution**: Replace with Google Secret Manager reads (same pattern as DB password).

- [x] Fix `cloud/functions/index.js` lines 18-19 — replace fully hardcoded host/user with Secret Manager reads
- [x] Fix `cloud/functions/reader.js` lines 14-15 — remove real values from `||` defaults
- [x] Fix `cloud/functions/reader.mjs` lines 23-24 — same as reader.js
- [x] Run `node --check` on all three modified files
- [x] Verify grep for hardcoded host/user returns empty

**Impact**: Production Supabase host and user no longer in source code.

## Phase 3: Update .gitignore

**Problem**: Several file patterns are untracked or frequently regenerated but not ignored.
**Solution**: Add missing patterns to `.gitignore`.

- [x] Add `*.log` (covers api.log, collector.log, sync.log, ui-dev.log)
- [x] Add `test-results/`
- [x] Add `playwright-report/`
- [x] Add `generated/` (Prisma generated client)
- [x] Add `.claude/settings.local.json`
- [x] Add `ui/.ui.pid`, `.ui.pid`
- [x] Add `tmp_*.mjs`, `check_*.mjs` (guard against re-adding debug scripts)

**Impact**: Future accidental commits of logs, test artifacts, and debug scripts prevented.

## Phase 4: Add MIT LICENSE

**Problem**: No license file — required before making repo public.
**Solution**: Create `LICENSE` at repo root with MIT license text.

- [x] Create `LICENSE` file with MIT license, Author: Asaf Meller, Year: 2026
- [x] Verify file exists and content is correct

**Impact**: Repo is legally open-source under MIT.

## Phase 5: Remove Internal Docs + Gitignore Generated/

**Problem**: Internal migration/debug notes are not useful to public; Prisma generated client is large and should not be committed.
**Solution**: Delete internal docs and remove generated/ from git tracking.

- [x] Delete `MIGRATION_GUIDE.md`
- [x] Delete `PARALLEL_LIMIT_FIX.md`
- [x] Run `git rm -r --cached generated/` if tracked
- [x] Verify `git ls-files generated/` returns empty
- [x] Verify `git ls-files | grep -E 'check_|fix_|reset_'` returns empty

**Impact**: Repo root is clean and appropriate for public audiences.

## Phase 6: Security Hardening (from security audit)

**Problem**: Security audit found 4 issues: .laneconductor.json tracked in git, rejectUnauthorized:false in prod DB connections, CORS accepting all origins with credentials, and password metadata logged in cloud function.
**Solution**: Untrack config file, add example, fix SSL, lock down CORS, remove credential logging.

- [x] Untrack `.laneconductor.json` from git (`git rm --cached`) — file stays locally
- [x] Create `.laneconductor.json.example` with placeholders showing the config shape
- [x] Fix `rejectUnauthorized: false` in `cloud/functions/index.js`, `reader.js`, `reader.mjs` — Supabase is a remote prod DB, should be `true`
- [x] Fix CORS in `ui/server/index.mjs` — restrict to known origins via `ALLOWED_ORIGINS` env var
- [x] Fix CORS in `cloud/functions/index.js`, `reader.js`, `reader.mjs` — same pattern
- [x] Remove `pwd_last_char` and `pwd_len` logging from `cloud/functions/index.js`

**Impact**: No config file in git history going forward; production DB connections properly secured; CORS locked down.

## ✅ COMPLETE
