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

Options: `--repo <path>` (repeatable; the first is the default), `--state-branch <name>` (applies to every
`--repo`; see below).

### Which repository it serves

Without `--repo` the connector resolves the repository at startup, first match wins:

1. the `--repo` flag(s);
2. the `CLAUDE_PROJECT_DIR` environment variable (Claude Code exports it to plugin MCP servers, so the plugin's
   `.mcp.json` passes no repo argument at all);
3. the git top level of the current directory, when it is inside a git repository;
4. otherwise a startup error naming the three options (exit code 2, nothing on stdout).

The choice is logged to stderr, like the state branch rule: `repo /path/to/project (chosen by CLAUDE_PROJECT_DIR)`
(`--repo flag`, `CLAUDE_PROJECT_DIR` or `current directory`). The logic is `src/repo-source.mjs`.

### State branch

Writes are refused with `NOT_ON_STATE_BRANCH` when the checkout is not on the state branch; reads
still work and say so. The state branch is resolved per repo at startup, first match wins:

1. the `--state-branch <name>` flag (every `--repo`);
2. `connector.state_branch` in that repo's optional settings file `.laneconductor.json` (see `ops/settings.md` in the skill), e.g. `{ "connector": { "state_branch": "public" } }`
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
`append_conversation`, `report_outcome` (appends one line to the advice log, nothing else); and `help`
(read-only, works in any folder: the command list below). Every tool description ends with `Example:` lines
(a natural phrase mapped to the call) and carries all four annotation hints.
Every response starts with a provenance line (which commit, which branch, ahead/behind, last fetch) and
carries `structuredContent.provenance`; `freshness` is `fresh`, `possibly_stale` or `stale`.

Every write is a commit made by the server (`chore(track-NNN): <tool> <files> via lc-connector`) that
touches exactly the written paths (plus any uncommitted advice-log lines), so unrelated staged or
dirty files are never swept in.

### Commands as MCP prompts (`prompts/list`, `prompts/get`)

The connector also offers every LaneConductor command as an MCP prompt, from one catalog
(`src/commands.mjs`): `next`, `plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`, `run`,
`review-plan`, `new`, `bug`, `feature`, `status`, `move`, `comment`, `workflow`, `help`, `new-project`, `board`,
`setup`, `deploy`. `prompts/get` returns one user message: the procedure with the
arguments filled in (a missing required argument is an error that names it). The `help` prompt, and the
read-only `help` tool for clients that do not surface prompts, list the commands grouped, one example phrase each,
and say which commands need the board add-on's script.

In a client that shows prompts (Claude Desktop, Cursor and others) pick one from the prompt menu; in claude.ai and
on mobile (through the remote connector) the same prompts appear, where plugin commands do not exist. The catalog is
neutral (no Claude tool prefix); the Claude Code plugin's `commands/*.md` are generated from it by
`scripts/build-plugin.mjs`, so the two cannot drift. `bug` and `feature` create real forms: `create_track` with
`track_kind` writes the form into `spec.md` (a bug's `test.md` starts with a regression-test case).
The pattern, a single table registered as prompts plus a `help` tool with example phrases, comes from FITI
(`functions/src/mcp.js` and `tools.js`).

### Push policy (decision D4)

By default (`ask`) the connector never pushes. When local commits are ahead of the upstream, every
response says `unpushed_local_commits` in `stale_reasons` and carries a warning telling Claude to ask
the human whether to push, because remote surfaces cannot see those commits.

The human can opt in to a standing permission in the optional settings file `.laneconductor.json`:

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
`update_track` regenerate it in the same commit as the track change, `node bin/lc-summary.mjs` regenerates it
(`--check` exits 1 when it is missing or out of date), and `list_tracks` builds its rows
from the track files and reports `track_summary_regenerated` in `stale_reasons` when the file
disagrees with them. Tracks with broken markers are listed under "Needs attention" in the file.

Privacy: the committed file lists only tracks whose `index.md` is in git at HEAD, plus the track the
current write creates or updates. A draft track folder that is not in git yet never appears in it
(so its title cannot reach a public repo); `list_tracks` still shows such a track with `untracked: true`
and a warning. The summary script follows the same rule; `--include-untracked` lists every folder.

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

## The LaneConductor plugins (three, from one generator)

How the layers fit (a neutral core, a Claude adapter, and what another agent would need) is in
[ARCHITECTURE.md](ARCHITECTURE.md); what each plugin provides, and which commands need which add-on, is the generated table
[docs/plugin-map.md](../docs/plugin-map.md).

Decision (human, 2026-11-18, track AM-10128): Anthropic's plugin directory does not accept the all-in-one plugin. The portal's Validate
(run 2026-11-18) blocks, for an organization that is not Verified, the local MCP server (`.mcp.json`), the `package.json` and lockfile,
every script and `.mjs` file, config fields outside its allowed lists, and frontmatter keys such as `isolation` in the agents. So the
product is three plugins from one generator, installed from the owner's marketplace (`meller/laneconductor`,
`.claude-plugin/marketplace.json` at the repo root, base first). Only the first is submitted to the directory (the owner submits):

- `plugins/laneconductor`, the BASE (version 1.0.0): Markdown, JSON and one PNG only. The skill, every slash command
  (`/laneconductor:<name>`), the read-only `plan-reviewer` subagent, README, `ADD-ONS.md`, LICENSE and an icon. It does the whole
  plan-first process by editing the track files, and works alone.
- `plugins/laneconductor-parallel`, an add-on: the connector (`.mcp.json` starts `server/bin/lc-connector.mjs` over stdio under the
  server key `lc`; it serves the open project through `CLAUDE_PROJECT_DIR`; tools are named
  `mcp__plugin_laneconductor-parallel_lc__<tool>`), its guides, the scaffold script `server/bin/lc-scaffold.mjs`, `package.json` and
  `package-lock.json` at the plugin root, and the `track-runner` subagent WITH `isolation: worktree`.
- `plugins/laneconductor-board`, an add-on: the board script `server/bin/lc-board.mjs`, its page, and the files they import. It needs no
  connector.

No plugin depends on another (cross-marketplace dependencies are unverified). The base DETECTS the add-ons: the connector tools by their
prefix, the `laneconductor-parallel:track-runner` agent by name, the board script by Glob
(`**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache`). When they are there the base uses them and recommends
nothing; when they are missing it mentions the add-on once per session, only when relevant, shows the install commands (one per bash
block) and never runs them. All slash commands live in the base because a plugin's slash prefix is its name; the add-ons ship no
`commands/` or `skills/`. The interface between the plugins (tool prefix, server key, agent name, script path) is written in
[ARCHITECTURE.md](ARCHITECTURE.md) and defined once in `scripts/plugin-texts.mjs`. Hooks are NOT part of any of them: they will be a
separate, opt-in extension, not yet available.

Everything under `plugins/`, the marketplace file and `docs/plugin-map.md` is GENERATED; do not edit them by hand.

How the generator works (`scripts/build-plugin.mjs` and `scripts/plugin-texts.mjs`, deterministic, no timestamps, one source set, three
profiles `base`, `parallel`, `board`):

- the skill is copied from `.claude/skills/laneconductor/` without its `legacy/` folder (the experimental, currently unmaintained daemon and
  Postgres tier stays in the repo's own skill). `skillEdits` removes the pointers into it and points the board, scaffold and
  worktree text at the add-ons (a missing anchor fails the build); the `allowed-tools` key is deleted from `SKILL.md` (so Claude Code
  applies its normal permission check) and a short Habits section and the Add-ons pointer are appended. The source skill is not touched;
- the READMEs come from `connector/plugin-extras/readme/{base,parallel,board}.md` (`{{VERSION}}`, the short plugin map and the install
  blocks are filled in), `LICENSE` from the repo root; `plugin.json` carries only fields the directory portal knows plus
  `privacyPolicyUrl`; the icon is `connector/plugin-extras/icon.png` (made by `scripts/make-icon.mjs`);
- the base's commands are generated from the catalog `connector/src/commands.mjs` (the same table the connector serves as MCP prompts):
  the procedures are written for file editing, and one generated line per command names the add-on's tools to use when they are present;
  agents are copied from `connector/plugin-extras/agents/` (the base's `plan-reviewer` has its connector tools removed);
- the parallel and board servers are their entry scripts plus every file they reach with a relative import (found by following the
  imports), copied under `server/` (a top-level `bin/` would stop claude.ai and Cowork installing the plugin); repo files outside
  `connector/` land at their repo-relative path (`conductor/services/track-folder.mjs`, ...);
- `package.json` and `package-lock.json` sit at the parallel add-on's ROOT (Claude Code runs `npm ci` there at cache time: registry
  packages, exact pins, no lifecycle scripts) and hold the runtime dependencies only;
- every plugin's `version` comes from `connector/package.json`;
- `--check` covers the three plugins, the marketplace file and the plugin map. `--profile <p> --out <dir>` builds one plugin elsewhere
  (it refuses a folder inside `plugins/` or a non-empty one); `test/directory-base.test.mjs` emulates the portal's blocks on the base.

Only the plugin directory is copied on install, and symlinks that leave it are rejected, so the
output is real copies and a test fails on drift:

```bash
node scripts/build-plugin.mjs          # rebuild plugins/, the marketplace file and docs/plugin-map.md, then commit
node scripts/build-plugin.mjs --check  # exit 1 if the committed output differs from a fresh build
claude plugin validate ./plugins/laneconductor --strict   # and laneconductor-parallel, laneconductor-board
claude plugin validate . --strict
scripts/try-local.sh --dry-run <scratch-repo-path>   # prints how to try the three together in a scratch repository
```

Tests: `test/plugin-build.test.mjs` (drift, manifests, READMEs, lockfile, skill transforms, the zip),
`test/directory-precheck.test.mjs` (`claude plugin validate`, size limits, secrets, the connector starting over stdio from a
temp copy), `test/addons.test.mjs` (the add-ons' layout; the board script running from a temp copy of the board add-on alone),
`test/plugin-coverage.test.mjs` (commands and agents), `test/directory-base.test.mjs` (the portal's rules on the base),
`test/interop.test.mjs` (the matrix: base alone, + parallel, + board, all three), `test/plugin-map.test.mjs`,
`test/try-local.test.mjs` and `test/lane-names.test.mjs` (the otralingo fixes).

Install (HUMAN, from a Claude Code session; this edits your real settings, so it is not run by the tests).
The full version in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor@laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

Or one plugin at a time:

```bash
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install laneconductor@laneconductor            # add --scope local for one project, --scope user for all
claude plugin install laneconductor-parallel@laneconductor   # optional: worktrees and safe writes
claude plugin install laneconductor-board@laneconductor      # optional: the board
```

Update: knowledge changes (skill, guides) ship by bumping `version` in `connector/package.json`,
running the generator, and pushing. User-added marketplaces do not auto-update by default, so run
`claude plugin marketplace update laneconductor` and then `claude plugin update laneconductor@laneconductor`,
or turn on auto-update for the marketplace in `/plugin`. Bump the version or the cache keeps the old copy. Users of the
0.2.x plugin already have the connector; remove a project's own skill symlink or a user-level skill copy so the skill is not
loaded twice.

HUMAN verification (none of it is automated, and a nested session cannot authenticate here):

1. After installing, `/mcp` shows `plugin:laneconductor:lc` connected.
2. In a scratch repo with a `conductor/` folder, "plan X" works through the connector. This also confirms that
   Claude Code exports `CLAUDE_PROJECT_DIR` to the plugin's MCP server (the docs say so; the tests only set it
   themselves). If the stderr log says `(chosen by current directory)` or the server fails to start with "no
   repository to serve", the variable was not exported.
3. With the connector disabled the commands still work by editing the track files.
4. `/laneconductor:board` finds `server/bin/lc-board.mjs` and publishes the board.
5. Run `claude plugin eval`.

## Removal

Everything the connector writes is an ordinary LaneConductor file, readable and writable without it.
To remove it: `claude mcp remove lc-connector` (or delete the `.mcp.json` entry) and, if you want,
delete `connector/`. Nothing is lost and no state exists only inside the connector.

## Board data (the board script)

`node bin/lc-board.mjs [--out <file>] [--pretty] [--now <iso>] [--check <file>] [--site <dir> [--json]]` prints a JSON snapshot of one
project's tracks for a dashboard (Phase 5d): `project`, `generated_at`, `lanes`, `tracks` (number,
folder, title, lane, lane_status, progress, phase, depends_on, auto_run, merge_mode, source_hash,
needs_attention), `counts` (per lane, needs-attention, archived) and `needs_attention` (number plus
reasons). It reads only `conductor/workflow.json`, `.laneconductor.json` (`project.name`) and each
track's `index.md` header, and cuts every marker value at its first line: in this mode (no `--site`)
conversation, spec, plan and test files and the Problem and Summary text are never read or copied. The output goes to stdout
and nothing is written into the repo (a board is a rebuildable snapshot, not a committed file); `--out`
writes a file, and `--check <file>` exits 1 when the file's data differs from a fresh build
(`generated_at` is ignored). Tracks sort by lane order, then number descending. `_duplicate-*` and
`_quarantine-*` folders are listed with `archived: true` and left out of the counts and the
needs-attention list. The generator ships in the plugin as `server/bin/lc-board.mjs`.

### The board page (`lc-board.mjs --site <dir>` and the `board` skill command)

`--site <dir>` writes the files a board artifact is published from (`board.html`, `board.json` and
`docs/<number>.json`, below), prints the first two absolute paths (one per line, nothing else on
stdout) and creates `<dir>` if needed; with `--json` stdout is instead the single object
`{ "page", "root", "files" }` (files relative to `root`: `board.json` and every docs file), ready for
the Artifact tool; it refuses a folder inside the repo's
`conductor/`. `board.html` is `src/board-page.html` copied byte for byte: a static page (lanes as
columns, Done and needs-attention lists, a status filter, light and dark) that holds no data and
fetches `board.json` by a relative URL, with a loading state and a "Could not load board.json" error
state. `board.json` is the page's data (`project`, `generated_at`, `tracks` as `n, p, t, l, s, g, h, a, d`
(plus `gh` on done tracks), `attn` as `n, p, t, r`, and `docs_dropped` when the file cap bit; live tracks
only, titles, lanes, status, progress, phase and check reasons). A refresh therefore replaces only
`board.json` and the docs files. Only Claude can create or update a Claude artifact
(a script or this connector cannot call the Artifact tool), so publishing is the skill command
`board` ("show the board", "update the board", `/laneconductor board`, steps in
`skills/laneconductor/ops/board.md`): it generates into a temp dir, publishes both files to the URL
in the optional settings file `.laneconductor.json` (`board.artifact_url`, created after a yes the first time), and opens it.
The board is private until the human shares it, and it is a snapshot, never live. In the plugin the
generator is `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site <dir>`. Tests:
`test/board-page.test.mjs` (the files, privacy, and the page run against a fake DOM).

### Project drawer (the project definition on the board)

One **Project** button in the page header opens the same kind of drawer with one tab per project definition that exists,
read from the project's `conductor/` folder when the board is built: Overview (`product.md`), Tech stack, Workflow
(`workflow.json` drawn as lane boxes with where each lane sends success and failure, from the shared resolver
`conductor/services/workflow-transitions.mjs`, with a text list for assistive technology and a one-line lane/status
primer, then the text of `workflow.md`), Quality gate, KPIs, Guidelines (`product-guidelines.md`, `design-language.md`
and the files of `code_styleguides/`, one tab with a section per file), Stories and Deployment. A file that does not
exist or is only the untouched scaffold placeholder text gets no tab; with nothing to read the button is hidden.
`board.json` carries `project_docs` (`[{ k, t, f: 'ctx/<key>.json' }]`) and `wf` (`{ lanes: [{ name, success, failure,
note }] }`, names and targets only); each tab's text is its own file `ctx/<key>.json` (`{ k, t, md }` or `{ k, t,
withheld }`), fetched when the tab is first opened. The files go through the same scan as the track documents (a match
withholds that file with a reason, never the text), `"board": { "include_docs": false }` turns them off with the rest,
and they count toward the 200-file cap (the track documents get what is left). `.laneconductor.json` is never published.
The header says the files are a snapshot read when the board was built.

### Track detail (documents on the board)

Clicking (or Enter/Space on) a track card, a Done row or a needs-attention row opens a drawer (a
full-screen sheet at phone width) with the track's id, title, lane, status, progress and phase and the
tabs Overview (`index.md`), Plan, Spec and Tests, plus Conversation only when the docs file has one.
The tabs read `docs/<number>.json`, fetched once and kept in memory. `lc-board.mjs --site` writes one such
file (`{ n, folder, index, plan, spec, test, conversation?, withheld? }`) for every live, non-archived
track that is not done, at most 200 per site (oldest backlog tracks are dropped first and counted in
`board.json` as `docs_dropped`; with the page and `board.json` that stays under the Artifact tool's 255
files per publish). Each file is cut at 60,000 characters with a `[truncated]` note. Done tracks have no
docs file; the drawer says so and links to the track folder on GitHub when `origin` is a github.com
remote (`gh` in `board.json`, https only, opens in a new tab). Track folders are resolved with the same
helpers as the connector, and a number shared by two live folders gets no docs.

Privacy:

- `conversation.md` is off by default (it is per-machine, gitignored for privacy, and can hold
  anything); `"board": { "include_conversation": true }` in `.laneconductor.json` adds it, read-only.
- `"board": { "include_docs": false }` turns the documents off: no `docs/` is written and the drawer
  shows the header only.
- Every file goes through `src/scan.mjs` first (`scanText`, pure: GitHub, Anthropic/OpenAI, AWS, Slack
  and Google keys, private key blocks, bearer tokens, database URLs with a password to a non-local
  host, `password = value` assignments, email addresses other than `noreply` and obvious placeholders,
  and phone numbers with separators). It returns line numbers and pattern names only, never the matched
  text. A file with any match is not embedded: its field is left out, `withheld[<field>]` says
  `possible secret or personal data (N matches)`, the page shows `withheld: <reason>` in its place, the
  rest of that track's files are still embedded, and the board script names the file on stderr (track,
  file, line numbers) so Claude can tell the human.
- The page footer says that sharing the board shares these documents.
- Markdown is rendered by a small in-page renderer that builds DOM nodes with `createElement` and
  `createTextNode` only (no html-string API anywhere): tags in a document stay text, only `https:`
  links become anchors (new tab, `noopener noreferrer`), images show their alt text.

Tests: `test/scan.test.mjs`, `test/board-docs.test.mjs`, and the detail tests in
`test/board-page.test.mjs` (open and close, tabs, one fetch, withheld notice, GitHub link, focus, and
an XSS document).

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
