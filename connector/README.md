# lc-connector

A git-backed MCP server for LaneConductor (track AM-10106). It exposes a project's track files
(`conductor/tracks/<ID>/index.md`, `spec.md`, `plan.md`, `test.md`, `conversation.md`) and project
context to Claude, and writes changes back as git commits. It stores, validates and advises. It does
not schedule or dispatch work, and it is a second opinion, never a controller.

Status: Phases 1 (code), 2, 3, 3b, 4 and 5 of the plan: local stdio server, eight tools, generated
track summary, advice log, push policy. Not yet built: the GitHub backend and the remote HTTP server
(Phases 7-9).

## Setup (Claude Code, local stdio)

```bash
cd connector && npm install        # once; Node >= 20
```

Add it for one project (writes to your local Claude Code config):

```bash
claude mcp add --transport stdio lc-connector -- node /ABS/PATH/connector/bin/lc-connector.mjs --repo /ABS/PATH/TO/PROJECT
```

Or commit a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "lc-connector": {
      "command": "node",
      "args": ["/ABS/PATH/connector/bin/lc-connector.mjs", "--repo", "/ABS/PATH/TO/PROJECT"]
    }
  }
}
```

Options: `--repo <path>` (repeatable; the first is the default; defaults to the current directory),
`--state-branch <name>` (applies to every `--repo`; see below).

### State branch

Writes are refused with `NOT_ON_STATE_BRANCH` when the checkout is not on the state branch; reads
still work and say so. The state branch is resolved per repo at startup, first match wins:

1. the `--state-branch <name>` flag (every `--repo`);
2. `connector.state_branch` in that repo's `.laneconductor.json`, e.g. `{ "connector": { "state_branch": "public" } }`
   (a non-empty, safe branch name; anything else stops the server at startup with an error naming the repo);
3. the repo's default branch, from `refs/remotes/origin/HEAD` (read locally: no fetch, no network);
4. the current branch, if it is `main` or `master`;
5. `main`.

So a repo whose default branch is `master` works with no flag and no config, and the plugin's
`.mcp.json` needs none. Each repo's choice and the rule that made it is logged to stderr at startup
(`<repo>: state branch master (chosen by origin_head)`) and returned as `provenance.state_branch_source`
(`cli_flag`, `config`, `origin_head`, `current_branch` or `default`) next to `provenance.branch`.

Check it: `claude mcp list`, then in a session ask "list the LaneConductor tracks".

## Tools (v0)

`list_tracks`, `get_track`, `get_context`, `health_report` (read-only); `create_track`, `update_track`
(requires the `base` from your last read; stale files or markers are rejected with `CONFLICT`),
`append_conversation`, `report_outcome` (appends one line to the advice log, nothing else).
Every response starts with a provenance line (which commit, which branch, ahead/behind, last fetch) and
carries `structuredContent.provenance`; `freshness` is `fresh`, `possibly_stale` or `stale`.

Every write is a commit made by the server (`chore(track-NNN): <tool> <files> via lc-connector`) that
touches exactly the written paths (plus any uncommitted advice-log lines), so unrelated staged or
dirty files are never swept in.

### Push policy (decision D4)

By default (`ask`) the connector never pushes. When local commits are ahead of the upstream, every
response says `unpushed_local_commits` in `stale_reasons` and carries a warning telling Claude to ask
the human whether to push, because remote surfaces cannot see those commits.

The human can opt in to a standing permission in `.laneconductor.json`:

```json
{ "connector": { "push": "auto-state" } }
```

With `auto-state`, 60 seconds after the last connector write (a burst of writes pushes once) the
connector pushes the state branch, fast-forward only and never forced, and only when every unpushed
commit touches nothing outside `conductor/` and none is a merge commit. Otherwise it pushes nothing
and the next responses name the commits or the reason (the remote moved, no upstream, rejected). Each
attempt is logged as a `push` line in the advice log. The countdown lives in the server process, so
a session that ends within the 60 seconds leaves its commits local; they are then reported as
unpushed by the next session. Any other value falls back to `ask`.

Reads never run `git fetch`. The plan lane guide tells Claude to run `git fetch` itself when the
provenance line shows the last fetch is over an hour old.

`conductor/tracks-summary.md` is a generated list of every track (id, title, lane, status, progress,
phase, dependencies, and the blob sha of each `index.md`). Never edit it by hand: `create_track` and
`update_track` regenerate it in the same commit as the track change, `lc summary` regenerates it
(`lc summary --check` exits 1 when it is missing or out of date), and `list_tracks` builds its rows
from the track files and reports `track_summary_regenerated` in `stale_reasons` when the file
disagrees with them. Tracks with broken markers are listed under "Needs attention" in the file.

`conversation.md` is gitignored in the LaneConductor repo itself (decision D5, pending): there
`append_conversation` writes the file but cannot commit it, and says so (`commit: null`, `commit_error`).

## Advice log, health report, kill criteria

The connector appends one JSON line per event to `conductor/advice-log/YYYY-MM.jsonl`: a `call` for
every tool call, a `serve` when `get_context` hands out a lane guide (with a `serve_id`), and
`tool_error`, `conflict`, `stale_read`, `empty_result` when they happen. Claude adds `outcome` lines
through `report_outcome` (followed, deviated or failed, with a one-line reason). Lines carry ids,
codes and counts only: no file contents, prompts or error messages.

The lines are appended to the working tree at once and are committed together with the next
connector commit; the log alone never causes a commit, and it is not counted as uncommitted plan
state in the provenance line. For concurrent clones, `conductor/advice-log/*.jsonl merge=union` in
`.gitattributes` lets simultaneous appends both survive.

`health_report` summarises a window: per advice item (served, followed, deviated, failed,
unreported, override rate, top deviation reasons, a flag when overridden most of the time) and for
the connector (error, conflict, stale-read and empty-result rates, latency, estimated tokens), then
the eight kill criteria with a verdict (`ok`, `warn`, `breach`, `insufficient_data`). The thresholds
are data in `src/kill-criteria.mjs`. KC-1 and KC-5 are judged by hand. The decision to keep, change
or remove is the human's.

The window starts at `beta_start` in `conductor/advice-log/beta.json`, which you write by hand when
the beta starts (and `beta_end` when it ends); nothing writes it automatically:

```json
{ "beta_start": "2026-11-20T09:00:00Z", "beta_end": null }
```

Without the file the window is the last 30 days.

## Docs-only lanes and state vs code

Track state lives on the state branch (default `main`) and code lives on branches. The plan lane and
other docs-only lanes (such as review notes) run in the primary checkout with no worktree: they never
needed one, and a worktree is what forced "commit and push before everything". The connector commits
the state files itself, so nothing needs a manual commit before another session or surface can see
them locally; pushing stays under the human's authority (see Push policy). Code branches never carry
track state: edit `conductor/` through the connector, on the state branch, and writes from another
branch are refused with `NOT_ON_STATE_BRANCH`. Code lanes (implement) are the only ones that use a
worktree, and only for code.

## The LaneConductor plugin (skill + connector as one unit)

`plugins/laneconductor/` is a Claude plugin that bundles the `laneconductor` skill and this server
(`.mcp.json` starts it over stdio against the open project). `.claude-plugin/marketplace.json` at the
repo root makes the repo a plugin marketplace with that one entry. Both are GENERATED; do not edit
them by hand.

How the generator works (`scripts/build-plugin.mjs`, deterministic, no timestamps):

- the skill is copied from `.claude/skills/laneconductor/`;
- the server is copied from `connector/bin/lc-connector.mjs`, `connector/src/` and `connector/guides/`
  into `server/` (a top-level `bin/` would stop claude.ai and Cowork installing the plugin), plus the
  few repo files it imports from outside `connector/` (found by following the imports) at their repo-relative path
  (`conductor/providers.mjs`, `conductor/sync-conversation-utils.mjs`, `conductor/services/track-folder.mjs`);
- `package.json` and `package-lock.json` sit at the plugin ROOT (Claude Code runs `npm ci` there at
  cache time: registry packages, exact pins, no lifecycle scripts) and hold the runtime dependencies only;
- the plugin `version` comes from `connector/package.json`.

Only the plugin directory is copied on install, and symlinks that leave it are rejected, so the
output is real copies and a test fails on drift:

```bash
node scripts/build-plugin.mjs          # rebuild plugins/laneconductor/ and the marketplace file, then commit
node scripts/build-plugin.mjs --check  # exit 1 if the committed output differs from a fresh build
claude plugin validate ./plugins/laneconductor --strict && claude plugin validate .
```

Install (HUMAN, from a Claude Code session; this edits your real settings, so it is not run by the tests):

```bash
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install laneconductor@laneconductor
```

Update: knowledge changes (skill, guides) ship by bumping `version` in `connector/package.json`,
running the generator, and pushing. User-added marketplaces do not auto-update by default, so run
`claude plugin marketplace update laneconductor` and then `claude plugin update laneconductor@laneconductor`
(or turn on auto-update for the marketplace in `/plugin`). Bump the version or the cache keeps the old copy.

HUMAN verification (plan Phase 5c Task 5; none of it is automated, and a nested session cannot authenticate here):

1. After the install, `/mcp` shows `plugin:laneconductor:lc-connector` connected.
2. In a scratch repo with a `conductor/` folder, "plan X" works through the connector. This also confirms that
   `${CLAUDE_PROJECT_DIR}` is substituted in the MCP `args` (the docs say so; no test has seen it work).
3. Run `claude plugin eval`.

The remote (`http`) entry for claude.ai and Cowork is plan Phase 5c Task 6, after the Phase 8 server exists.

## Removal

Everything the connector writes is an ordinary LaneConductor file, readable and writable without it.
To remove it: `claude mcp remove lc-connector` (or delete the `.mcp.json` entry) and, if you want,
delete `connector/`. Nothing is lost and no state exists only inside the connector.

## Board data (`lc board`)

`lc board [--out <file>] [--pretty] [--now <iso>] [--check <file>] [--site <dir>]` prints a JSON snapshot of one
project's tracks for a dashboard (Phase 5d): `project`, `generated_at`, `lanes`, `tracks` (number,
folder, title, lane, lane_status, progress, phase, depends_on, auto_run, merge_mode, source_hash,
needs_attention), `counts` (per lane, needs-attention, archived) and `needs_attention` (number plus
reasons). It reads only `conductor/workflow.json`, `.laneconductor.json` (`project.name`) and each
track's `index.md` header, and cuts every marker value at its first line: conversation, spec, plan
and test files and the Problem and Summary text are never read or copied. The output goes to stdout
and nothing is written into the repo (a board is a rebuildable snapshot, not a committed file); `--out`
writes a file, and `--check <file>` exits 1 when the file's data differs from a fresh build
(`generated_at` is ignored). Tracks sort by lane order, then number descending. `_duplicate-*` and
`_quarantine-*` folders are listed with `archived: true` and left out of the counts and the
needs-attention list. The generator ships in the plugin as `server/bin/lc-board.mjs`.

### The board page (`lc board --site <dir>` and the `board` skill command)

`--site <dir>` writes the two files a board artifact is published from, prints their absolute paths
(one per line, nothing else) and creates `<dir>` if needed; it refuses a folder inside the repo's
`conductor/`. `board.html` is `src/board-page.html` copied byte for byte: a static page (lanes as
columns, Done and needs-attention lists, a status filter, light and dark) that holds no data and
fetches `board.json` by a relative URL, with a loading state and a "Could not load board.json" error
state. `board.json` is the page's data (`project`, `generated_at`, `tracks` as `n, p, t, l, s, g, h, a`,
`attn` as `n, p, t, r`; live tracks only, titles, lanes, status, progress, phase and check reasons).
A refresh therefore replaces only `board.json`. Only Claude can create or update a Claude artifact
(a script or this connector cannot call the Artifact tool), so publishing is the skill command
`board` ("show the board", "update the board", `/laneconductor board`, steps in
`skills/laneconductor/ops/board.md`): it generates into a temp dir, publishes both files to the URL
in `.laneconductor.json` (`board.artifact_url`, created after a yes the first time), and opens it.
The board is private until the human shares it, and it is a snapshot, never live. In the plugin the
generator is `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site <dir>`. Tests:
`test/board-page.test.mjs` (the files, privacy, and the page run against a fake DOM).

## Tests

```bash
cd connector && npm test            # node --test "test/*.test.mjs"; no network, temp git repos only
ps aux | grep -E "lc-connector|probe.mjs" | grep -v grep   # expected: empty afterwards
```

(`node --test test/` as written in test.md does not work on Node 22: it is read as a file, not a folder.)

## Phase 1 probe

`spike/probe.mjs` is a throwaway server whose instructions hold a canary codeword that no tool
returns. Stdio: `node spike/probe.mjs`. Streamable HTTP for claude.ai through a tunnel:
`LC_PROBE_ALLOW_ANY_HOST=1 node spike/probe.mjs --http 8765` (authless, data-free; tear it down after the test).

## SDK

Built on `@modelcontextprotocol/server` v2 (pinned 2.4.0). Tool handlers (`src/tools/*.mjs`) and the
stores never import the SDK; only `src/server.mjs` and `bin/lc-connector.mjs` do. To fall back to v1
(`@modelcontextprotocol/sdk`): change those two files' imports and pass `def.input.shape` where
`def.input` is given to `registerTool`.
