# Spec: Track 10063 — One canonical track-folder resolver for every writer

## Problem Statement

`ui/server/index.mjs` resolves "which folder on disk belongs to track NNN" with
its own inline scan that only recognises the **legacy bare** `NNN-slug`
convention. Every track created since track 10023 uses the **prefixed**
`INITIALS-NNN-slug` convention, so the Collector API is structurally blind to
the folder that actually holds the track.

### Root cause (confirmed live 2026-09-04, on this track's own folders)

The original report guessed that `worktree-artifact-merge.mjs`'s
"copy whole dir to main" branch generated the bare-numeric duplicates. That is
**not** where they come from — that module resolves both sides through the
worker's `resolveTrackFolder` and is correct. The generator is
`syncTrackToFile()` itself, in its own folder-missing recovery branch
(`ui/server/index.mjs:1565`):

```js
const trackDirs = readdirSync(tracksDir).filter(d => {
  const match = d.match(/^(\d+)-/);          // ← never matches "TU-10063-..."
  return match && match[1] === trackNum.toString();
});
if (!trackDirs.length) { /* recreate folder from DB content */ }
```

That produces a self-sustaining loop:

1. `lc new` creates `TU-10063-slug/` and registers it in
   `conductor/tracks-metadata.json`. The worker syncs it to the database.
2. Any PATCH that calls `syncTrackToFile` scans for `^(\d+)-`, does not see
   the `TU-` prefix, concludes the folder is **missing**, and recreates a
   *bare-numeric* `10063-slug/` from the DB's `index_content` / `spec_content`.
3. The marker the human asked for is written into that freshly-invented
   folder. Nothing else in the system reads it.
4. The worker's next `resolveTrackFolder` pass now sees two matches, keeps the
   registered `TU-` folder, and quarantines the bare one to
   `_duplicate-10063-slug/`. The marker write is now permanently orphaned.
5. The worker then pushes the *canonical* folder's state to the database.
   `parseAutoRun()` returns `false` for an absent marker
   (`conductor/laneconductor.sync.mjs:1729`), so `auto_run` is written back as
   `false` — silently undoing the human's PATCH. This is the "flap".
6. The next PATCH starts again at step 2, forever.

Direct evidence on this track, in the primary checkout:

| Folder | Contents | mtime |
|--------|----------|-------|
| `TU-10063-…` (canonical) | `index.md`, `spec.md`, `test.md`, `conversation.md` | 16:17 |
| `10063-…` (recreated) | `index.md`, `spec.md` only | 16:17 |
| `_duplicate-10063-…` (quarantined earlier round) | `index.md`, `spec.md` only | 16:09 |

`index.md` + `spec.md` and nothing else is the exact signature of the recreate
branch, which only writes those two files. The bare folder's `index.md` even
carries the `# Track TU-10063:` heading, because it was rebuilt from the DB row
that the canonical folder produced. The same pattern is present on every track
from 10050 to 10064.

### Blast radius beyond `syncTrackToFile`

Four more call sites in the same file use the same legacy-only pattern
(`d.startsWith(\`${num}-\`)`), each with its own failure mode:

| Line | Endpoint | Consequence today |
|------|----------|-------------------|
| 1256 | `DELETE …/tracks/:num` | Deletes the DB row, then deletes the *bare duplicate* (or nothing) and leaves the real folder behind |
| 1722 | `POST …/tracks/:num/comments` | Human comment appended to the duplicate's `conversation.md`; never reaches the worker or the UI |
| 1794 | bug-to-test | Writes `test.md` into the duplicate; queues the wrong relative path for remote file sync |
| 2070 | review-gaps | 404 "Track directory not found on disk" for any prefixed track |

A third resolver disagrees more subtly: `lc track-dir` (`bin/lc.mjs:3405`)
calls `decideTrackFolder` **without** `contentSizeByName`, so on an ambiguous,
unregistered track it falls back to alphabetical order while the worker picks
the folder with real content. Two correct-looking resolvers, two different
answers.

## Solution

One shared, filesystem-aware resolver that gathers the facts
`decideTrackFolder` needs and returns its decision **without applying any
effects**. Every reader uses it; only the worker applies the quarantine and
metadata effects on top.

```
conductor/services/track-folder.mjs      (pure decision — unchanged)
              ▲
conductor/services/track-folder-fs.mjs   (NEW — gathers fs facts, applies nothing)
              ▲                  ▲                    ▲
  worker resolveTrackFolder   lc track-dir    ui/server/index.mjs
  (+ quarantine + metadata)   (read-only)     (read-only, 5 call sites)
```

## Requirements

- **REQ-1** — New module `conductor/services/track-folder-fs.mjs` exporting
  `resolveTrackFolderFs({ tracksDir, trackNumber, metadataPath })`. It reads
  the directory listing, reads the registered `folder_path` from
  `tracks-metadata.json`, computes `contentSizeByName` when 2+ candidates could
  match, calls `decideTrackFolder`, and returns
  `{ folder, quarantine, metadataUpdate, matches }`. It performs **no**
  renames and **no** metadata writes — a lookup must never mutate the tree.
- **REQ-2** — `syncTrackToFile()` resolves its target folder through
  `resolveTrackFolderFs`. Every marker it writes (`lane_status`,
  `lane_action_status`, `progress_percent`, `waiting_reason`, `auto_run`,
  `merge_mode`, `workspace_mode`) lands in the canonical folder.
- **REQ-3** — The four other legacy-only scans in `ui/server/index.mjs`
  (lines 1256, 1722, 1794, 2070) resolve through `resolveTrackFolderFs`.
- **REQ-4** — `syncTrackToFile`'s folder-missing recreate branch names the new
  folder `INITIALS-NNN-slug` when the author is known (DB `tracks.author`, or
  the `# Track PREFIX-NNN:` heading in `index_content`), falling back to
  `NNN-slug` only when it genuinely is not. This branch becomes near-unreachable
  once REQ-2 lands; it must not manufacture a second convention when it does run.
- **REQ-5** — The worker's `resolveTrackFolder`
  (`conductor/laneconductor.sync.mjs:1519`) is refactored to call
  `resolveTrackFolderFs` and then apply the returned `quarantine` renames and
  `metadataUpdate` write. Observable behaviour must be **byte-identical** to
  today, including the `quarantine.length > 1` warning and the
  `**Lane Status**: running` → `quarantined` rewrite. The quarantine semantics
  are load-bearing (track 1119).
- **REQ-6** — `lc track-dir` uses `resolveTrackFolderFs` and therefore gains
  the content-size tie-break it currently lacks, while staying read-only
  (exit 0 + path on stdout, exit non-zero + stderr diagnostic, nothing on
  stdout on failure).
- **REQ-7** — Duplicate folders stop being silently tolerated:
  - `syncTrackToFile` emits a structured `logger.warn` naming the track, the
    chosen folder, and every non-canonical match, whenever `matches > 1`.
  - New `lc track-dir --audit` (no track number) scans `conductor/tracks/` and
    prints every track number with more than one live matching folder. Exits
    `1` when any are found, `0` when clean. Read-only; quarantines nothing.
- **REQ-8** — No database schema change and no migration. `tracks.auto_run` and
  every other affected column are already correct; the bug is purely on the
  filesystem side.

## Non-goals

- Removing the existing `_duplicate-*` quarantined folders. They are inert and
  keep their content by design.
- A one-time sweep of the bare-numeric duplicates already on disk. Once REQ-2
  stops recreating them, the worker's own `resolveTrackFolder` quarantines each
  survivor on its next pass — that machinery already works and needs no help.
- Changing `decideTrackFolder`'s decision logic. Its matcher already handles
  both conventions correctly; the bug is that three callers don't use it.
- Fixing `worktree-artifact-merge.mjs`. It was named in the original report but
  is not implicated.

## Acceptance Criteria

- [ ] **AC-1** — Toggling Auto Run in the UI on a track whose folder is
      `TU-NNNNN-slug` puts `**Auto Run**: yes` into that folder's `index.md`.
      The UI's own Overview tab shows the change on its next poll.
- [ ] **AC-2** — After that toggle, the value survives a full worker sync
      cycle: `auto_run` is still `true` in the database a cycle later, with no
      human action in between. The flap is gone.
- [ ] **AC-3** — No bare-numeric `NNNNN-slug` folder appears for a
      prefixed track as a result of any API write.
- [ ] **AC-4** — Deleting a prefixed track through the API removes the real
      `INITIALS-NNN-slug` folder, not a duplicate and not nothing.
- [ ] **AC-5** — A human comment posted through the API is appended to the
      canonical folder's `conversation.md`, and the worker picks it up.
- [ ] **AC-6** — The review-gaps endpoint no longer returns 404 for a
      prefixed track.
- [ ] **AC-7** — `lc track-dir NNN` and the worker's `resolveTrackFolder`
      return the same folder for a track with two unregistered candidate
      folders of differing content size.
- [ ] **AC-8** — `lc track-dir --audit` on a tree with a duplicated track
      number lists that track number and exits 1; on a clean tree it exits 0.
- [ ] **AC-9** — The existing worker test suites that cover folder resolution
      and quarantine (`track-10040-track-folder`, `track-10046-…`,
      `track-10048-…`, `track-1119-…`) pass unchanged, proving REQ-5's
      refactor did not alter behaviour.
