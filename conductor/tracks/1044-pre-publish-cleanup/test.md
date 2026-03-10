# Tests: Track 1044 — Pre-publish Cleanup

## Test Commands
```bash
# Verify no debug scripts remain at root
git ls-files | grep -E 'check_|fix_|reset_|tmp_'

# Verify no hardcoded Supabase credentials
grep -r "pooler.supabase.com\|postgres\.<supabase-project-id>" cloud/functions/

# Syntax check all modified cloud function files
node --check cloud/functions/index.js
node --check cloud/functions/reader.js
node --check cloud/functions/reader.mjs

# Verify LICENSE exists
cat LICENSE | head -3

# Verify generated/ not tracked by git
git ls-files generated/

# Verify internal docs removed
git ls-files MIGRATION_GUIDE.md PARALLEL_LIMIT_FIX.md
```

## Test Cases

### Phase 1: Debug Scripts Deleted
- [ ] TC-1: `git ls-files | grep -E 'check_.*\.mjs'` returns empty
- [ ] TC-2: `git ls-files | grep -E 'fix_.*\.mjs'` returns empty
- [ ] TC-3: `git ls-files | grep -E 'reset_.*\.mjs'` returns empty
- [ ] TC-4: `git ls-files | grep 'tmp_test_db'` returns empty
- [ ] TC-5: `git ls-files | grep 'check_1033_comments'` returns empty
- [ ] TC-6: `git ls-files | grep 'debug-workflow'` returns empty
- [ ] TC-7: `git ls-files | grep 'test-supabase'` returns empty

### Phase 2: Hardcoded Credentials Removed
- [ ] TC-8: `grep -r "pooler.supabase.com" cloud/functions/` returns empty
- [ ] TC-9: `grep -r "postgres\.<supabase-project-id>" cloud/functions/` returns empty
- [ ] TC-10: `node --check cloud/functions/index.js` exits 0
- [ ] TC-11: `node --check cloud/functions/reader.js` exits 0
- [ ] TC-12: `node --check cloud/functions/reader.mjs` exits 0

### Phase 3: .gitignore Updated
- [ ] TC-13: `.gitignore` contains `*.log`
- [ ] TC-14: `.gitignore` contains `test-results/`
- [ ] TC-15: `.gitignore` contains `playwright-report/`
- [ ] TC-16: `.gitignore` contains `generated/`
- [ ] TC-17: `.gitignore` contains `.claude/settings.local.json`
- [ ] TC-18: `.gitignore` contains `tmp_*.mjs`
- [ ] TC-19: `.gitignore` contains `check_*.mjs`

### Phase 4: LICENSE Added
- [ ] TC-20: `LICENSE` file exists at repo root
- [ ] TC-21: LICENSE contains "MIT License"
- [ ] TC-22: LICENSE contains "Asaf Meller"
- [ ] TC-23: LICENSE contains "2026"

### Phase 5: Internal Docs + Generated/ Removed
- [ ] TC-24: `git ls-files MIGRATION_GUIDE.md` returns empty
- [ ] TC-25: `git ls-files PARALLEL_LIMIT_FIX.md` returns empty
- [ ] TC-26: `git ls-files generated/` returns empty

## Acceptance Criteria
- [ ] All TC-1 through TC-26 pass
- [ ] `git ls-files | grep -E 'check_|fix_|reset_'` returns empty
- [ ] `grep -r "pooler.supabase.com" cloud/` returns empty
- [ ] `node --check` passes on all modified cloud function files
- [ ] `LICENSE` file present with MIT text, Asaf Meller, 2026
