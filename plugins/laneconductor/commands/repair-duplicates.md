---
description: Find tracks that share a number and renumber the newer folder (asks first)
---
Repair duplicate track numbers: two folders under `conductor/tracks/` that start with the same number are ambiguous. Nothing is renamed until I say yes. The folder and id formats are in the skill file `ops/tracks.md`.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find them: list the folder names under `conductor/tracks/` and group them by number (both naming conventions exist, see "Finding a track" in the skill index). Also check other branches: `git for-each-ref refs/heads refs/remotes` and `git ls-tree -d --name-only <ref> conductor/tracks/` show folders that exist only there. If there is no duplicate, say so and stop. A folder that exists only on another branch is not a duplicate yet; it becomes one when that branch is merged.
2. For each duplicate number, the older folder keeps it: find when each folder first appeared (`git log --diff-filter=A --format=%aI -- <folder>`, the oldest line) and treat the later one as the newer. The new number is the highest track number found on any branch plus one; the new name is the same prefix and slug with that number.
3. Show me the plan, one line per rename: "Rename <old folder> to <new folder>; update its `# Track` heading in index.md, plan.md, test.md, history.md and conversation.md? [default: yes]". Also say which other tracks mention the old number in `**Depends On**` (do not change those; they may mean either track, and I decide). Wait for my yes; on no, change nothing.
   When the second folder exists only on another branch, ask me which branch is the keeper (its folder keeps the number), then do steps 4 and 5 on the branch that carries the folder being renumbered: check that branch out in its own worktree (`git worktree add <dir> <branch>`), so a rename on the wrong branch leaves the duplicate in place.
4. On yes: `git mv` the folder, fix the id in the headings (the number only; keep the prefix and the title), and append a comment to the renamed track's `conversation.md` saying it was renumbered from the old number. Commit only those paths (explicit paths, never `git add -A`). Never push.
5. Regenerate `conductor/tracks-summary.md` if the project keeps one (by hand: the same rows, the renamed folder under its new number), then report what was renamed.
   A note that a folder is also named differently on another branch stays until that branch is merged or deleted, or carries the same folder name; say so.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__create_track`, `mcp__plugin_laneconductor-parallel_lc__append_conversation`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/tracks.md` (newTrack)

#### newTrack `[name] [description]`

Do "Search first" above, and continue here only when it ends in "create". With the add-on, call `create_track` (it takes the same fields, including the merge mode and auto run
markers). By hand:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
   `AM-10022-slug` both give `10022`). The display ID is `INITIALS-NNN`; the folder is
   `INITIALS-NNN-slug/`.
2. **Create `conductor/tracks/INITIALS-NNN-slug/index.md` right away**, for fast feedback:
   ```markdown
   # Track INITIALS-NNN: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Merge Mode**: direct
   **Auto Run**: yes
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`. `**Merge Mode**` and `**Auto Run**` default to `direct` and
   `yes` (changed 2026-09-08; before that the markers were omitted and fell back to the
   conservative `pr` / not-auto-run). Write `pr` / `no` only when the user asks for it on this
   track ("this one needs a PR, don't auto-run it"). The change affects new tracks only; a track
   that already exists without the markers keeps the old fallbacks.
3. **No queue file.** The folder you just made is the track; nothing else registers it.
4. **Non-dev types.** For `marketing` or `sales`, look in `.claude/skills/` for the recommended
   skills (marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`;
   sales: `sales-enablement`, `cold-email`) and tell the user which are missing.
5. Create `history.md` beside the other files, with one header line (`# History: Track INITIALS-NNN`) and nothing else.
6. Print `✅ Track NNN created in conductor/tracks/<folder>/.`

### `SKILL.md` (Finding a track)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`, the
current form) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both** (a scan for one
form silently misses every folder of the other). If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If any folder exists for the number, use it. Scaffolding a second one is an error, not a
fallback: a scan that missed `AM-<number>-...` once created a duplicate `<number>-...` folder.
