# Spec: Composer smart autocomplete for @file mentions, @track references, and /slash commands

## Problem Statement

A standalone terminal coding agent completes file paths for you. The LaneConductor Chat
composer does not. `ui/src/components/TrackChatComposer.jsx` is a bare
`<input type="text">` — whatever the human types is posted verbatim to
`POST /api/projects/:id/tracks/:num/comments`, which writes it into `conversation.md` for the
agent to read. So steering an agent toward a specific file means typing the full repo-relative
path from memory, with no feedback if you get it wrong. The same is true for referring to
another track by number, and for the `/laneconductor` command surface the skill exposes.

The browser cannot fix this on its own: it has no filesystem access, and in `remote-api` mode
the machine holding the repository is not the machine serving the UI. So the completion data
has to come from somewhere on the server side.

### What already exists (verified against this checkout, 2026-09-07)

| Fact | Evidence |
|---|---|
| The composer is one plain text input with no key handling beyond submit | `TrackChatComposer.jsx` — `onChange` sets state, `<form onSubmit>` posts |
| `ChatView` already holds the full track list in memory | `ChatView({ projectId, workers, tracks })`, passed down from the board |
| A "worker computes it, ships it on the heartbeat, API serves it from the DB" pattern is already established | `refreshWorktreeSummaryCache()` (`laneconductor.sync.mjs:1518`) → `worktrees` field on `PATCH /worker/heartbeat` → `workers.worktrees` JSONB → `fetchWorktreeRows()` (`ui/server/index.mjs:511`) |
| The API server already shells out and already reads project files off disk | `spawnSync` at `index.mjs:5262`; `PATCH /api/projects/:id/conductor/:key` writes into `repo_path` |
| Pure logic shared between worker, API server and browser has an established home | `conductor/services/*.mjs` and `conductor/providers.mjs`, imported by `ui/server/index.mjs` **and** by `ui/src/components/*.jsx` |
| Every `/api/*` route is already authenticated | `app.use('/api', requireAuth)` at `index.mjs:240` |
| Collector routes authenticate by worker token instead | `app.patch('/worker/heartbeat', collectorAuth, …)` |
| A collector fan-out helper already handles tokens, health, the collector-0 rule and the retry buffer | `patchCollectors(path, body)` (`laneconductor.sync.mjs:1250`) — a new worker→collector write needs no new transport code |
| The retry buffer coalesces on `(collector, method, path)` | `keyOf()` in `conductor/services/collector-retry-buffer.mjs` — so a large repeated body is held at most once per collector |
| A debounced-input pattern with a stale-response guard already exists and is already tested | `ConnectionsStep.jsx:178-194` (`setTimeout` + `cancelled` flag + `clearTimeout` cleanup), asserted by its own TC-24 |
| There is no fuzzy-matching helper anywhere in the repo yet | no hits for `fuzzy`/`fzf` under `ui/src/lib` or `conductor/` |

## Solution

Three pieces, in dependency order.

1. **A files API.** `GET /api/projects/:id/files?q=…` returns ranked repo-relative paths from
   `git ls-files`. The path list is cached in memory on the API server so the query that runs on
   each keystroke is an array filter, not a git invocation.
2. **A manifest fallback for remote deployments.** When the project's `repo_path` is not present
   on the API host, the answer comes from a manifest the worker computed and pushed. The push is
   digest-gated rather than riding every 10-second heartbeat, because a file list is orders of
   magnitude larger than the worktree summary that pattern was built for.
3. **The composer menu.** Trigger detection, fuzzy filtering, keyboard navigation and text
   insertion, driven by pure functions that are unit-testable without a DOM.

### Trigger grammar

Ambiguity here is the main design risk, so the rule is fixed and narrow. A trigger is only
recognised when the trigger character begins a token — that is, it sits at position 0 or is
preceded by whitespace.

| Typed | Menu | Query | Inserted on accept |
|---|---|---|---|
| `@src/comp` | files | `src/comp` | `ui/src/components/ChatView.jsx ` |
| `#100` | tracks | `100` | `#10069 ` |
| `@track:100` | tracks | `100` | `#10069 ` |
| `/mo` (at position 0 only) | commands | `mo` | `/laneconductor move ` |

`@track:` is an explicit alias so the `@track` trigger named in the track's scope works, without
making the bare `@` prefix ambiguous — under a "`@track` is a prefix" rule, typing `@tracker.js`
would silently open the wrong menu. `/` is restricted to position 0 so that a path such as
`@src/lib` never opens the command menu mid-token.

### Data source tiering

`GET /api/projects/:id/files` resolves its source in this order and reports which one it used:

| Order | Source | Condition | `source` in response |
|---|---|---|---|
| 1 | `git ls-files` in `repo_path` | `repo_path` set and present on the API host | `disk` |
| 2 | `projects.file_manifest` | worker has pushed a manifest | `worker` |
| 3 | empty result | neither | `none` |

`none` is a normal, non-error outcome. The composer stays fully usable; the menu says the file
list is unavailable instead of failing the send.

## Requirements

**Files API**

- REQ-1: `GET /api/projects/:id/files?q=<query>&limit=<n>` returns
  `{ files: [{ path, score }], source, total, truncated, age_seconds }`, ranked best-first.
- REQ-2: The path list is cached in memory per project with a TTL, so repeated keystroke queries
  do not re-run `git ls-files`. A cache miss runs it once; concurrent misses do not stampede.
- REQ-3: `q` is optional. Absent or empty, the endpoint returns the first `limit` paths in
  deterministic path order, so the menu has content the moment `@` is typed.
- REQ-4: `limit` defaults to 20 and is clamped to a maximum of 100. `q` longer than 128
  characters is truncated. Neither produces an error.
- REQ-5: The endpoint returns only paths that `git ls-files` reports as tracked. It never returns
  file contents, never accepts a client-supplied path, and never reads outside `repo_path`.
- REQ-6: A project whose `repo_path` is unset, missing from this host, or not a git repository
  returns `200` with `source: "none"` and an empty list — not a `4xx`/`5xx`.

**Worker manifest sync**

- REQ-7: The worker computes its tracked-file list on a slow cadence (aligned with the existing
  60-second worktree-summary tick), hashes it, and pushes it only when the hash differs from the
  last hash it successfully sent.
- REQ-8: The push targets a dedicated collector endpoint, `PATCH /worker/file-manifest`, guarded
  by `collectorAuth` exactly as `/worker/heartbeat` is. It is not added as a heartbeat field. The
  worker sends it through the existing `patchCollectors()` fan-out, so it inherits per-collector
  token resolution, health recording, the collector-0-authoritative rule and the retry buffer
  rather than reimplementing any of them.
- REQ-9: The manifest is capped at 20,000 paths. Beyond that it is truncated and flagged, rather
  than sent whole or dropped.
- REQ-10: A worker in `local-fs` mode does not compute or push a manifest, matching every other
  collector interaction in the worker.
- REQ-11: A worker that never pushes a manifest must not blank an existing stored one, mirroring
  the `worktrees !== undefined` guard the heartbeat handler already uses.

**Shared matching**

- REQ-12: A shared subsequence fuzzy matcher lives in `conductor/services/fuzzy-match.mjs` and is
  imported by the API server and the browser. It is case-insensitive, scores segment-boundary and
  consecutive-run matches higher, and breaks ties deterministically so ordering is stable and
  testable.
- REQ-13: The `/laneconductor` command list lives in `conductor/services/slash-commands.mjs` as
  plain data, so the menu cannot drift from a hand-maintained copy inside a component.

**Composer**

- REQ-14: Typing `@` opens a file menu populated from the files API, debounced so that a burst of
  keystrokes issues one request.
- REQ-15: Typing `#` or `@track:` opens a track menu filtered from the track list `ChatView`
  already has. No new request is issued for it.
- REQ-16: Typing `/` at the start of the message opens the command menu.
- REQ-17: While a menu is open, ArrowUp/ArrowDown move the highlighted item and wrap at both
  ends; Enter and Tab accept it; Escape closes the menu and leaves the typed text alone.
- REQ-18: Enter with a menu open accepts the highlighted item and must not submit the message.
  Enter with no menu open submits as it does today.
- REQ-19: Accepting an item replaces only the trigger token, leaves the rest of the input intact,
  appends a single trailing space, and places the caret after it.
- REQ-20: Closing a menu with Escape does not reopen it until the trigger token changes, so
  Escape is a real dismissal rather than a one-frame flicker.
- REQ-21: The menu renders with the existing dark surface conventions already used in this view
  (`bg-gray-900`/`border-gray-800`/`text-gray-200`, blue accent for the active row) and is
  keyboard-reachable without a pointer.
- REQ-22: Every existing composer behaviour is preserved: the disabled state and hint, the queued
  notice, the live-turn hint, the error line, and the `worker-chat-input` / `worker-chat-send`
  test ids other tests depend on.

## Acceptance Criteria

- [x] Typing `@Chat` in the Chat composer shows a menu of matching repository files, and choosing
      one puts its repo-relative path into the message.
- [x] Typing `#100` shows matching tracks by number and title, and choosing one inserts `#NNNN`.
- [x] Typing `/` at the start of a message shows the `/laneconductor` commands, and choosing one
      inserts the command.
- [x] The menu is fully operable from the keyboard: arrows move, Enter or Tab picks, Escape
      dismisses.
- [x] Pressing Enter to pick a completion does not send the message; the next Enter does.
- [x] Picking a completion mid-sentence replaces only the token being typed and leaves the rest of
      the sentence untouched.
- [x] Holding down a key while the file menu is open does not issue one request per keystroke.
- [x] On a project whose repository is not reachable from the API host but whose worker has
      reported a manifest, `@` still lists that repository's files.
- [x] On a project with neither, the composer still sends messages normally and the menu says the
      file list is unavailable.
- [x] The files endpoint never returns a path outside the project's repository and never returns
      file contents.
- [x] Existing Chat composer behaviour is unchanged: sending, the disabled hint, the queued
      notice, and the live-turn hint all still work.

## API Contracts / Data Models

### `GET /api/projects/:id/files`

Behind `app.use('/api', requireAuth)` like every other `/api` route.

Query: `q` (optional, ≤128 chars), `limit` (optional, default 20, max 100).

```json
{
  "files": [
    { "path": "ui/src/components/ChatView.jsx", "score": 412 },
    { "path": "ui/src/components/ChatView.test.jsx", "score": 388 }
  ],
  "source": "disk",
  "total": 1843,
  "truncated": false,
  "age_seconds": 4
}
```

`total` is the size of the manifest being searched, not the number returned. `age_seconds` is how
old the cached or worker-reported list is, so the UI can be honest about staleness.

### `PATCH /worker/file-manifest`

Guarded by `collectorAuth`, alongside `/worker/heartbeat`.

```json
{
  "project_id": 1,
  "hostname": "hydra",
  "digest": "sha256:9f2c…",
  "files": ["Makefile", "bin/lc.mjs", "…"],
  "truncated": false
}
```

Responds `{ ok: true }`. As with `worktrees`, an absent `files` key leaves the stored manifest
untouched rather than clearing it.

### Data Model Changes

One additive migration under `migrations/`, following the hand-trimmed convention documented in
`20260905215931_add_collector_health.sql`:

```sql
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest" jsonb NULL;
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest_digest" text NULL;
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest_updated_at" timestamp NULL;
```

The manifest is keyed to the **project**, not the worker, because a repository's file list is a
property of the repository. Storing it per worker would duplicate it across every worker on the
same checkout for no gain.

The columns are mirrored into both `prisma/schema.prisma` and `prisma/schema.sql`, following the
`collector_health` precedent — only `schema.sql` carries the raw DDL. `migrations/atlas.sum` is
hash-verified over the whole directory, so it must be regenerated with `atlas migrate hash` in the
same change; otherwise `atlas migrate apply`, which `make install-migrate` runs, rejects the
directory as tampered.

## Non-Goals

- **File contents.** Only paths. Reading, previewing or attaching a file's contents is not part of
  this track.
- **Untracked files.** `git ls-files` is the source, so ignored files never appear. This is
  deliberate and doubles as the guard against completing paths to `.env` and similar.
- **Porting the endpoint to `cloud/functions/index.js`.** The cloud collector is missing many
  worker routes already, and Firebase Hosting's rewrite globs mis-route multi-segment paths — both
  are track 10052's existing scope, not a gap this track introduces. This track delivers against
  the collector API contract; whichever collector implements that contract serves it.
- **Completion in any surface other than the Chat composer.** `TrackDetailPanel`'s comment box and
  the mobile views are untouched here.
- **Persisting or expanding mentions.** An inserted path is plain text in the message body, which
  is what the agent reading `conversation.md` needs. There is no mention entity, no chip, and no
  server-side rewriting of the posted comment.

## Open Items For Human Review

None. No conflict was found with `product.md`, `tech-stack.md`, `workflow.md` or
`product-guidelines.md`: the matcher is hand-rolled specifically to avoid adding a dependency the
documented stack does not list, and the endpoint follows the Express-plus-`pg` shape already in
use. `conductor/design-language.md` is referenced by the skill but does not exist in this
repository, so REQ-21 anchors to the conventions the surrounding components actually use.
