# LaneConductor

**The conventions of Conductor, the discipline of Superpowers, and a Kanban board: plan, build and review with Claude, with the plans kept as plain files in your git repository.**

[![License: Elastic-2.0](https://img.shields.io/badge/License-Elastic--2.0-purple.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-blue)](https://claude.ai/code)
[![Documentation](https://img.shields.io/badge/docs-Knowledge%20Base-cyan)](https://laneconductor-site.web.app/wiki.html)

LaneConductor is Claude plus git plus a small connector. Each piece of work is a **track**: a folder under
`conductor/tracks/` with `index.md` (state), `spec.md`, `plan.md`, `test.md` and `conversation.md`. Claude manages the
tracks for you (it plans them, works them in lanes, reviews them and merges them), and git keeps the history. There
is no database to run and no background process to keep alive.

## What it is now

- **Direction (decided 2026-11-16).** Claude plus git plus a connector. The tracks are files in git.
- **One plugin.** The skill (the workflow), the slash commands (type `/laneconductor:` to list them), two subagents, the local connector and the board
  script ship together as the `laneconductor` plugin. There is nothing else to install.
- **A board.** Ask Claude to update the board and it gives you every track by lane as a private Claude artifact.
- **Safe writes.** One writer per change, and every write is checked against what you last read (see
  [Safety and privacy](#safety-and-privacy)).
- **The older stack is parked.** The Postgres dashboard, the sync daemon, workers and dispatch, the cloud collector
  and federated hubs are kept at the [`v1-legacy`](../../tree/v1-legacy) git tag. See [The legacy tier](#the-legacy-tier).

The lane pipeline is unchanged: **Plan, Implement, Review, Quality Gate, Merge**. Quality gates (tests, lint, build)
are still what decides whether a track is done.

## Where this comes from

LaneConductor combines two projects and adds a Kanban view:

- **[Conductor](https://github.com/gemini-cli-extensions/conductor)**, a Gemini CLI extension: project context kept as
  Markdown files, and a spec and plan for every track, so the context survives between sessions. The `conductor/`
  folder and its context files follow it.
- **[Superpowers](https://github.com/obra/superpowers)** by Jesse Vincent (MIT): a skills framework for coding agents
  with a real working process (brainstorm, plan, build with sub-agents, verify). Portions of LaneConductor's workflow
  protocols are adapted from it.
- **Kanban**: lanes, and a board that shows where every track stands.

When this started, the author did not find a Conductor for Claude or a Superpowers for Gemini, and wanted both at once.
Versions for other agents have appeared since; LaneConductor is the two ideas together, not a replacement for either.

**Who it is for:** anyone who works with an AI coding agent and wants the plan written down, in the repository, before
the code. **Not for:** a team whose process lives entirely in Jira (or a similar tool) and that does not use AI agents.
LaneConductor is not a product tracker, and it is not a ticket-to-pull-request agent; see
[Why LaneConductor](docs/why-laneconductor.md) for the comparison and the sources.

## Install

You need [Claude Code](https://claude.ai/code) (or Cowork) and Node.js 20 or newer (the connector uses it).

```bash
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
```

Add `--scope local` to install it for one project only (just for you), or `--scope user` to have it in every
project. Then run `/reload-plugins` in your session.

Check that it loaded:

- `claude plugin list` shows `laneconductor`.
- `/mcp` shows `plugin:laneconductor:lc`, the connector.

If you installed with `--scope local` and open another folder, `claude plugin list` shows the plugin as disabled
there. That is how local scope works, not a fault.

To update:

```bash
claude plugin marketplace update laneconductor
claude plugin update laneconductor@laneconductor
```

then `/reload-plugins`.

The plugin is not in Anthropic's plugin directory yet, so you install it from this marketplace or by upload. A directory
submission is being prepared. Hooks are planned as a separate opt-in extension (`laneconductor-hooks`) and are not
available yet.

### Other ways to get it

A zip of the plugin can be built with `node scripts/make-zip.mjs --out <dir>` (a deterministic zip of
`plugins/laneconductor`). It can be loaded with "Upload plugin" in the Claude desktop app or claude.ai
(Customize, Plugins, Add). No release zip has been published yet, so use the marketplace route above for now.

### What works where

| Where you use Claude | Skill and commands | Connector, board script, subagents |
| :--- | :---: | :---: |
| Claude Code, on your computer | yes | yes |
| Cowork, on your computer | yes | yes |
| claude.ai chat | yes (as skills; Claude edits the track files directly) | no |

A remote connector for chat and mobile does not exist yet; it is not available.

## Use it

Open your project in Claude Code and ask in plain words, or use a command:

- `/laneconductor:setup` sets LaneConductor up in a new project; `/laneconductor:new <title: what and why>` starts a
  track (`:bug` and `:feature` start one of those kinds).
- `/laneconductor:new-project <name or idea>` starts a project from a short chat: it asks a few questions one at a
  time, writes the `conductor/` scaffold with no daemon and no database, and creates the first tracks. It asks before
  any commit and never pushes.
- `/laneconductor:plan 12`, `:implement 12`, `:review 12`, `:quality-gate 12`, `:merge 12` take a track through
  its lanes. `:run` recommends the next step and asks before it starts anything.
- `/laneconductor:status`, `:move`, `:comment`, `:workflow`, `:brainstorm` and `:review-plan` do what they say.
- `/laneconductor:board` shows or refreshes the board.

For each track the `track-runner` subagent can work it in its own git worktree, so tracks do not collide, and the
read-only `plan-reviewer` subagent reads a plan and reports gaps without changing anything. Both only start when
you say yes.

## The board

The board is part of the plugin: `/laneconductor:board`, or just ask Claude to "update the board".

- It is a static page plus a data snapshot (`board.json`), built by `lc board --site <dir>` (the plugin has its own
  copy of the script, so you do not need the `lc` command). Claude publishes it as a **private** artifact and keeps
  its URL in `.laneconductor.json` (`board.artifact_url`).
- It is a **snapshot**. It changes only when Claude refreshes it, and it shows when it was generated.
- Click a track to see its Overview, Plan, Spec and Tests.
- Every document passes a privacy scan first. A file with secrets, email addresses or phone numbers in it is
  withheld whole and named by track number and file name. `conversation.md` is left out unless you set
  `board.include_conversation: true`.
- Sharing the board shares the documents on it, so share it only with people who may read them.
- It needs the plugin's local script, so it works in Claude Code and Cowork, not in claude.ai chat alone.

## Migrate an existing project

If the project used the earlier install (`make install`, or a copy or symlink of the skill):

1. Install the plugin (above).
2. Open a session in the project and confirm `/mcp` shows `plugin:laneconductor:lc`.
3. Remove the project's own skill (`.claude/skills/laneconductor`, often a symlink) and any user-level copy
   (`~/.claude/skills/laneconductor`) so the skill is not loaded twice.
4. If a worker runs for the project, stop it with `lc worker stop`. Nothing needs it any more.

Your tracks do not change; they are the same files. A Postgres database from the older setup is not read by the
plugin and can be left alone or dropped. If you used the 0.2.x `laneconductor` plugin, you already have the
connector and the board script; update the plugin and nothing else is needed. The connector's MCP key is `lc`, and
its tools are named `mcp__plugin_laneconductor_lc__<tool>`. The commands fall back to editing the track files
directly only if the connector's MCP server fails to start.

## Safety and privacy

- **One writer per change.** A track file is changed by one writer at a time, through the connector, so two
  writers do not overwrite each other.
- **Conflict checks.** A write needs the `base` from your last read; if someone edited the file since, it is refused
  with `CONFLICT` and nothing is overwritten.
- **Automatic commits.** Each write is one git commit containing only the files it wrote, on the project's state
  branch.
- **State branch.** The connector writes on `connector.state_branch` from `.laneconductor.json` if you set it;
  otherwise the repo's default branch; otherwise the current branch if it is `main` or `master`; otherwise `main`.
  It refuses to write while the checkout is on any other branch.
- **No pushes without asking.** The connector makes no network requests and never pushes unless you set
  `connector.push: auto-state`. The skill asks before any push or merge.
- **`conversation.md` stays on your machine.** It is gitignored, per machine, and not put on the board by default.
- **Advice log.** The connector appends tool names, success flags, timings and sizes to `conductor/advice-log/` in
  your repo. It holds no file contents and no prompts.

## Skills for each lane

LaneConductor does not keep a library of reusable procedures of its own. Something solved and worth repeating is an ordinary skill,
and Anthropic's skills, plugins and marketplaces already handle discovery, sharing and updates; put yours in your own
plugin or marketplace. What LaneConductor adds is the map: each lane guide suggests skills that help at that lane (for
example test-driven development and systematic debugging at implement, verification before completion at the quality
gate), and an optional `skills` object in `conductor/workflow.json` adds your own per lane. They are suggestions, in the
second-opinion style: use them if installed, say so if one is missing.

## The legacy tier

The earlier version of LaneConductor was a Postgres-backed Kanban dashboard (Vite and React), a sync daemon,
queue workers with dispatch, a cloud collector and federated hubs. It is parked, not deleted: it is preserved at the
[`v1-legacy`](../../tree/v1-legacy) git tag, the daemon is stopped, and the plugin does not need any of it. The
folders `conductor/`, `ui/`, `cloud/`, `migrations/` and `bin/` still hold that code, and `make install`, `lc start`
and `lc ui` belong to it. Use that tag if you want to run it.

![The legacy Kanban dashboard](docs/hero.png)

## Documentation

- [Why LaneConductor](docs/why-laneconductor.md): where it comes from, how it differs from trackers and their coding
  agents, who it is for and who it is not for.
- [`connector/PLUGIN-README.md`](connector/PLUGIN-README.md): what the plugin contains, what it runs and writes,
  board privacy.
- [`connector/README.md`](connector/README.md): the connector's tools, push policy, advice log and board data.
- [`connector/ARCHITECTURE.md`](connector/ARCHITECTURE.md): the neutral core and the Claude adapter.
- [Knowledge Base](https://laneconductor-site.web.app/wiki.html).
- [`conductor/product.md`](conductor/product.md) and [`conductor/tech-stack.md`](conductor/tech-stack.md).

## Project structure

- `plugins/laneconductor/`: the built plugin (generated; do not edit by hand).
- `connector/`: the connector's source, its tests and the plugin's extra files.
- `scripts/`: the plugin generator and the zip script.
- `.claude/skills/laneconductor/`: the source of the skill (lane guides and operations).
- `conductor/tracks/`: this project's own tracks.
- Legacy tier (tag `v1-legacy`): `bin/` (the `lc` CLI), `conductor/` (the sync worker), `ui/`, `cloud/`, `migrations/`.

## License

This project is licensed under the [Elastic License 2.0](LICENSE): free to use, modify and
self-host; the one restriction is offering it to third parties as a hosted or managed service.
