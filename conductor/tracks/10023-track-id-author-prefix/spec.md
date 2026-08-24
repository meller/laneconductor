# Spec: Track 10023 — Author-prefixed Track IDs

## Problem Statement

When two users work in parallel on the same project and both create tracks, they independently scan the filesystem and assign the same next number (e.g. both create `10022`). This causes git merge conflicts and ambiguous track identity. LaneConductor is filesystem-first with no central authority to assign IDs.

## Solution

Prefix track folder names and display IDs with the author's initials, derived from `git config user.name`. The true unique identity is `(user_email, track_number)` — email from `git config user.email`. Initials are display-only; two users with the same initials is a cosmetic coincidence, not a correctness issue.

**Examples:**
- Asaf Meller (asaf.meller@gmail.com) creates track 10022 → folder `AM-10022-slug/`, display `AM-10022`
- Bob Jones (bob@example.com) creates track 10022 → folder `BJ-10022/`, display `BJ-10022`
- No collision on filesystem or in git

## Requirements

- REQ-1: `lc new` reads `git config user.name` and `git config user.email`; derives initials as uppercase first letter of each word (max 3 chars).
- REQ-2: Track folder named `INITIALS-NNN-slug/` (e.g. `AM-10022-feature-name/`).
- REQ-3: `index.md` stores `**Created By**: <email>` and `**Author**: <initials>`.
- REQ-4: `lc status` ID column shows `AM-10022` format.
- REQ-5: DB schema adds `created_by_email TEXT` and `author TEXT` columns to `tracks`; unique constraint becomes `(project_id, created_by_email, track_number)`.
- REQ-6: Backwards compatible — existing `NNN-slug/` folders (no prefix) are treated as legacy; displayed as-is in `lc status`, not broken or renamed.
- REQ-7: `lc new` next-number scan ignores the initials prefix when finding the max number (scans for `\d+` anywhere in folder name).
- REQ-8: Skill (`/laneconductor newTrack`) follows the same convention.

## Acceptance Criteria

- [ ] Two users creating tracks simultaneously produce different folder names with no git conflict.
- [ ] `lc status` shows `AM-10022` style IDs for new tracks, legacy `10022` for old ones.
- [ ] `lc new "Title"` with `git config user.name = "Asaf Meller"` creates `AM-NNN-title-slug/`.
- [ ] Existing track folders are not renamed or broken.
- [ ] DB migration adds columns without breaking existing rows (nullable, backfilled with null).
- [ ] Initials derived correctly: "Asaf Meller" → "AM", "John von Neumann" → "JVN", "Madonna" → "M".
