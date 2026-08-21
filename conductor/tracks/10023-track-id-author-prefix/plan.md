# Plan: Track 10023 — Author-prefixed Track IDs

## Phase 1: Initials derivation utility

Add a shared helper in `conductor/services/author.mjs`:
- `getAuthorInfo()` — runs `git config user.name` and `git config user.email`, returns `{ name, email, initials }`
- `deriveInitials(name)` — uppercase first letter of each word, max 3 chars, fallback to `XX` if git not configured

Examples:
- "Asaf Meller" → "AM"
- "John von Neumann" → "JVN"  
- "Madonna" → "M"
- (not configured) → "XX"

- [x] Create `conductor/services/author.mjs`
- [x] Implement `deriveInitials(name)` with word-split logic
- [x] Implement `getAuthorInfo()` reading git config
- [ ] Unit test: verify initials derivation for edge cases

## Phase 2: lc new uses author prefix

Update `lc new` (and `lc setup`'s track creation) in `bin/lc.mjs`:
- Call `getAuthorInfo()` to get initials
- Next-number scan: `readdirSync(tracksDir).map(d => d.match(/(\d+)/)?.[1]).filter(Boolean)` — extracts number regardless of prefix
- Folder name: `${initials}-${num}-${slug}/`
- Write `**Created By**: ${email}` and `**Author**: ${initials}` to `index.md`

- [x] Update `lc new` folder naming to include initials prefix
- [x] Update next-number scan to be prefix-agnostic
- [x] Add `**Created By**` and `**Author**` markers to generated `index.md`
- [ ] Test: `lc new "My Feature"` produces `AM-10024-my-feature/`

## Phase 3: lc status displays prefixed IDs

Update `lc status` ID extraction in `bin/lc.mjs`:
- Currently: `t.id = d.split('-')[0]` — breaks for `AM-10022-slug`
- New: check if first segment is all digits → legacy format; else use `INITIALS-NNN` as display ID
- Regex: `d.match(/^([A-Z]+-)?(\d+)/)`  → groups to build display ID

- [x] Update ID extraction in `lc status` local-fs rendering
- [x] Legacy tracks (`NNN-slug`) display as `NNN` unchanged
- [x] New tracks (`AM-NNN-slug`) display as `AM-NNN`
- [x] ID column width: increase from 5 to 8 chars to fit `AM-10023`

## Phase 4: DB migration

Add migration `migrations/YYYYMMDD_add_track_author.sql`:
```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS created_by_email TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS author TEXT;
-- Drop old unique constraint, add new one
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_project_id_track_number_key;
ALTER TABLE tracks ADD CONSTRAINT tracks_project_id_author_track_number_key
  UNIQUE (project_id, created_by_email, track_number);
```

- [x] Write migration SQL file (`migrations/20260821120000_add_track_author.sql`)
- [x] Update `cloud/schema.sql` to include new columns
- [ ] Test: migration applies cleanly on existing DB (nulls for legacy rows)
- [ ] Test: two rows with same project_id + track_number but different emails — no constraint violation

## Phase 5: Skill follows same convention

Update `/laneconductor newTrack` in `SKILL.md`:
- Read `git config user.name` and `git config user.email`
- Derive initials using same logic
- Use `INITIALS-NNN-slug/` folder naming
- Write `**Created By**` and `**Author**` markers

- [x] Update SKILL.md newTrack section with author-prefix instructions
- [x] Update file_sync_queue.md entry format to include `**Author**` field

## Phase 6: Backwards compatibility verification

- [x] Confirm existing tracks load correctly in `lc status` (no prefix → display as `NNN`)
- [x] Confirm worker/sync does not break on legacy folder names (filter is `/\d+/`, backward compatible)
- [x] Confirm `lc new` next-number scan correctly finds max across mixed legacy + prefixed folders
