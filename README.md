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
- **The older stack is experimental and currently unmaintained.** The Postgres dashboard, the sync daemon, workers and dispatch, the cloud collector
  and federated hubs are kept at the [`v1-legacy`](../../tree/v1-legacy) git tag. See [The experimental tier](#the-experimental-tier).

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

The full version in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor@laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

Check that it loaded:

- `claude plugin list` shows `laneconductor`.
- With the optional parallel add-on, `/mcp` shows `plugin:laneconductor-parallel:lc`, the connector.

If you installed with `--scope local` and open another folder, `claude plugin list` shows the plugin as disabled
there. That is how local scope works, not a fault.

To update all three in one line (installing again does not upgrade a plugin that is already installed):

```bash
claude plugin marketplace update laneconductor && claude plugin update laneconductor@laneconductor && claude plugin update laneconductor-board@laneconductor && claude plugin update laneconductor-parallel@laneconductor
```

then restart your sessions (or run `/reload-plugins`).

LaneConductor is three plugins from one generator: `laneconductor` (the base, Markdown only, works alone; the one prepared for
Anthropic's directory), and two optional add-ons from this marketplace: `laneconductor-parallel` (parallel work in worktrees, a
local connector with conflict-checked writes) and `laneconductor-board` (the board). What each provides, and which commands need
which add-on, is in [docs/plugin-map.md](docs/plugin-map.md). The add-ons install a local program, so they are not in the directory:

```bash
claude plugin install laneconductor-parallel@laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

**Moving from the all-in-one plugin (0.x):** version 1.0.0 of `laneconductor` no longer holds the connector or the board. Uninstall
the old one (`claude plugin uninstall laneconductor`), install the base and the add-ons you want, and restart your sessions (a running
connector keeps the version it started with). Your track files are unchanged. To try all three in a scratch repository:
`scripts/try-local.sh --dry-run <scratch-repo-path>`. Hooks are planned as a separate opt-in extension and are not available yet.

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

- `/laneconductor:setup` sets LaneConductor up in a project (it needs no installed program), and at the end offers a starter set of
  three or four plugins that fit that project (the add-ons among them), with the install commands for you to run; `/laneconductor:new <title: what and why>` starts a
  track (`:bug` and `:feature` start one of those kinds).
- `/laneconductor:new-project <name or idea>` starts a project from a short chat: it asks a few questions one at a
  time, writes the `conductor/` scaffold with no daemon and no database, and creates the first tracks. It asks before
  any commit and never pushes.
- `/laneconductor:suggest-skills` says what could help with the track in hand: the skills you already have that apply, and the ones worth installing (see "Skill suggestions" below).
- `/laneconductor:next` is the front door: it reads where the project stands and names the one next step, with the command and why (it writes nothing).
- `/laneconductor:plan 12`, `:implement 12`, `:review 12`, `:quality-gate 12`, `:merge 12` take a track through
  its lanes. `:run` recommends the next step and asks before it starts anything.
- `/laneconductor:status`, `:move`, `:comment`, `:workflow`, `:brainstorm` and `:review-plan` do what they say.
- `/laneconductor:board` shows or refreshes the board.

For each track the `track-runner` subagent can work it in its own git worktree, so tracks do not collide, and the
read-only `plan-reviewer` subagent reads a plan and reports gaps without changing anything. Both only start when
you say yes.

## The board

The board is part of the plugin: `/laneconductor:board`, or just ask Claude to "update the board".

- It is a static page plus a data snapshot (`board.json`), built by the script of the `laneconductor-board`
  add-on (no other program is needed). Claude publishes it as a **private** artifact and keeps
  its URL in the optional settings file `.laneconductor.json` (`board.artifact_url`; that file is private, so Claude adds it to
  `.gitignore` first, after asking).
- It is a **snapshot**. It changes only when Claude refreshes it, and it shows when it was generated.
- Click a track to see its Overview, Plan, Spec and Tests.
- Every document passes a privacy scan first. A file with secrets, email addresses or phone numbers in it is
  withheld whole and named by track number and file name. `conversation.md` is left out unless you set
  `board.include_conversation: true`.
- Sharing the board shares the documents on it, so share it only with people who may read them.
- It needs the board add-on's local script, so it works in Claude Code and Cowork, not in claude.ai chat alone.

## Migrate an existing project

If the project used the earlier install (a copy or symlink of the skill, or a running sync worker):

1. Install the plugin (above).
2. Open a session in the project and confirm `/mcp` shows `plugin:laneconductor:lc`.
3. Remove the project's own skill (`.claude/skills/laneconductor`, often a symlink) and any user-level copy
   (`~/.claude/skills/laneconductor`) so the skill is not loaded twice.
4. If a sync worker still runs for the project, stop it. It is not part of the plugins, and nothing needs it any more.

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
- **State branch.** The connector writes on `connector.state_branch` from the optional settings file `.laneconductor.json` if you set it;
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

### Skill suggestions: nothing is installed without your yes

LaneConductor can suggest a skill that fits the lane you are in, the kind of track and the project's stack: when you ask (`/laneconductor:suggest-skills`), at the start of a lane, when a track is a marketing, sales or support one, and at the end of setup. **It installs nothing without your yes, and it never runs an install itself.** A suggestion is plain text with the install commands shown; you run them yourself, or use your client's own plugin browser.

What it does run, only to look: `claude plugin list` (read only), and it reads `.claude/skills/` of the project and `~/.claude/skills/` to see what you already have. If you say "do not ask again" for a suggestion, it shows the change and, after your yes, adds the entry name to `skills.declined` in your personal `.laneconductor.json` (it asks before adding that file to `.gitignore`); it changes no other settings and no permissions.

The suggestions come from a small public catalog, checked on 2026-11-18 (`connector/plugin-extras/recommended-plugins.json`, validated by `node scripts/check-catalog.mjs --online`). Every source is a public GitHub repository, and an entry whose plugin installs a program or a connection to a hosted service says so plainly before you install it:

| Source | Plugins in the catalog | Licence | Installs a program or a connection |
| :--- | :--- | :--- | :--- |
| `meller/laneconductor` | `laneconductor-parallel`, `laneconductor-board` | Elastic-2.0 | yes: `laneconductor-parallel`, `laneconductor-board` |
| `anthropics/claude-plugins-official` | `superpowers`, `frontend-design`, `pr-review-toolkit`, `security-guidance`, `playwright`, `firebase` | MIT, Apache-2.0 | yes: `superpowers`, `security-guidance`, `playwright`, `firebase` |
| `cloudflare/skills` | `cloudflare` | Apache-2.0 | yes: `cloudflare` |
| `coreyhaines31/marketingskills` | `marketing-skills` | MIT | no, Markdown only |
| `anthropics/knowledge-work-plugins` | `customer-support`, `data` | Apache-2.0 | yes: `customer-support`, `data` |

Each plugin is installed from its own source with the platform's own install commands; LaneConductor does not bundle, wrap or copy it. If nothing in the catalog fits, it may name one generic finder, `find-skills` (`vercel-labs/skills`), as a third-party tool that LaneConductor has not vetted.

## The experimental tier

The earlier version of LaneConductor was a Postgres-backed Kanban dashboard (Vite and React), a sync daemon,
queue workers with dispatch, a cloud collector and federated hubs. It is experimental and currently unmaintained, not deleted: it is preserved at the
[`v1-legacy`](../../tree/v1-legacy) git tag, the daemon is stopped, and the plugin does not need any of it. The
folders `conductor/`, `ui/`, `cloud/`, `migrations/` and `bin/` still hold that code, with its own install and start
commands; they are not documented here. Use that tag if you want to run it.

![The earlier Kanban dashboard](docs/hero.png)

## Documentation

- [Why LaneConductor](docs/why-laneconductor.md): where it comes from, how it differs from trackers and their coding
  agents, who it is for and who it is not for.
- [`docs/plugin-map.md`](docs/plugin-map.md): what each of the three plugins provides (generated).
- [`connector/README.md`](connector/README.md): the connector's tools, push policy, advice log and board data.
- [`connector/ARCHITECTURE.md`](connector/ARCHITECTURE.md): the neutral core and the Claude adapter.
- [Knowledge Base](https://laneconductor-site.web.app/wiki.html).
- [`conductor/product.md`](conductor/product.md) and [`conductor/tech-stack.md`](conductor/tech-stack.md).

## Project structure

- `plugins/laneconductor/`, `plugins/laneconductor-parallel/`, `plugins/laneconductor-board/`: the built plugins (generated; do not edit by hand).
- `connector/`: the connector's source, its tests and the plugin's extra files.
- `scripts/`: the plugin generator and the zip script.
- `.claude/skills/laneconductor/`: the source of the skill (lane guides and operations).
- `conductor/tracks/`: this project's own tracks.
- Experimental tier, currently unmaintained (tag `v1-legacy`): `bin/` (its command-line tool), `conductor/` (the sync worker), `ui/`, `cloud/`, `migrations/`.

## License

This project is licensed under the [Elastic License 2.0](LICENSE): free to use, modify and
self-host; the one restriction is offering it to third parties as a hosted or managed service.
