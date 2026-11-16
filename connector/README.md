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
`--state-branch <name>` (default `main`: writes are refused with `NOT_ON_STATE_BRANCH` when the
checkout is on another branch; reads still work and say so).

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

## Removal

Everything the connector writes is an ordinary LaneConductor file, readable and writable without it.
To remove it: `claude mcp remove lc-connector` (or delete the `.mcp.json` entry) and, if you want,
delete `connector/`. Nothing is lost and no state exists only inside the connector.

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
