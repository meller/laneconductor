# LaneConductor

LaneConductor teaches Claude a plan-first way of working on a project whose plans are plain files in git: one folder per track
under `conductor/tracks/`, holding `index.md` (state markers), `spec.md`, `plan.md`, `test.md` and `conversation.md`. It covers how
to plan, implement, review, quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy.

Version 1.5.0.

## Getting started

<!-- generated: next journey (scripts/plugin-texts.mjs) -->
1. Install the base plugin (see "Install" below).
2. Type `/laneconductor:next`.
3. Do the one step it names, then type it again.
4. With no `conductor/` yet it offers three paths and the add-ons that fit (`laneconductor-parallel` and `laneconductor-board`); you run their install commands yourself.
<!-- end generated: next journey -->

## What is in it

It is Markdown only, and it works on its own:

- the `laneconductor` skill: the lane guides (`plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`), the track
  operations (create, move, comment, status, workflow) and the working-a-track guardrails;
- slash commands, run as `/laneconductor:<name>` (type `/laneconductor:` to list them; `help` shows each with an example phrase);
  `setup`, `new-project` and `deploy` run only when you name them;
- a lane-to-skill map: each lane guide ends with a short "Skills that help here" section that suggests skills worth using at that
  lane (if you have them installed); `conductor/workflow.json` may carry an optional `skills` object naming your own per lane;
- one read-only subagent, `plan-reviewer`, which reads a track's spec and plan and reports gaps without changing anything.

Claude edits the track files directly, following the skill's file formats, and asks before any merge or push. The plugin declares
no pre-approved tools, so nothing is allowed without your say.

It makes no network requests, installs nothing and runs no scripts. It contains no program, no server and no hook. Its privacy
policy is https://github.com/meller/laneconductor/blob/main/docs/privacy.md.

## Optional add-ons

Optional add-ons live in the same marketplace as this plugin and are not in Anthropic's directory. None is needed, they have
no dependency on this plugin or on each other, and LaneConductor does not install them for you. When one is installed, the commands
use it; when it is missing, LaneConductor mentions it at most once per session, and only when it is relevant.

| Plugin | Provides |
| :--- | :--- |
| `laneconductor` (base) | the `laneconductor` skill, every slash command (`/laneconductor:<name>`), the `plan-reviewer` subagent. Markdown only. |
| `laneconductor-parallel` (add-on) | the connector's tools (`mcp__plugin_laneconductor-parallel_lc__*`) and MCP prompts, the `track-runner` subagent (one per track, in its own worktree), `lc-scaffold.mjs`. No slash commands. |
| `laneconductor-board` (add-on) | `lc-board.mjs` and its page. No slash commands. |

### `laneconductor-parallel`

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

### `laneconductor-board`

The board, one private page of every track by lane, which Claude publishes as an artifact. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

The full list of what each plugin provides, and which commands need which add-on, is in
[docs/plugin-map.md](https://github.com/meller/laneconductor/blob/main/docs/plugin-map.md).

## Install

In Claude Code:

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor@laneconductor
```

Add `--scope local` to install it for one project only (just for you), or `--scope user` for every project. Or use "Upload plugin"
in Claude (desktop app or claude.ai: Customize, Plugins, Add) with `laneconductor-<version>.zip` from the Releases page of
https://github.com/meller/laneconductor. Update with `claude plugin marketplace update laneconductor`, then
`claude plugin update laneconductor@laneconductor`. If you keep a copy of the LaneConductor skill in your own project
(`.claude/skills/laneconductor`) or in `~/.claude/skills`, remove it so the skill is not loaded twice.

## Moving from the all-in-one plugin (versions 0.x)

Before version 1.0.0 `laneconductor` was one plugin that also held the connector and the board. It is now this Markdown-only base,
plus the two add-ons above. If you are on 0.x, the connector and the board are no longer in `laneconductor`. Uninstall the old one,
install the base and the add-ons you want, and restart your sessions (a running connector process keeps the version it started
with):

```bash
claude plugin uninstall laneconductor
```

```bash
claude plugin install laneconductor@laneconductor
```

Then install `laneconductor-parallel` and `laneconductor-board` as shown above if you want them. The files in git are unchanged,
so nothing is lost: your tracks are the same.

## If Claude Code asks about reading a file

If Claude Code asks "Allow this read outside the working directories?", choose the option that allows it this one time; the
"keep allowing" and "block ... from now on" ones change a permanent setting.

## What it reads and writes

The skill is instructions for Claude: it asks Claude to read and edit files and to run shell commands in your project (git, tests,
builds, and the deploy commands you configure) under your normal Claude Code permission prompts. It reads and writes the track
folders under `conductor/`, plus the optional settings file `.laneconductor.json` when it exists, and it asks before any push.

## Where it works

In Claude Code and Cowork, and in claude.ai chat, where the skill and the commands load as skills and Claude edits the track files
directly.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
