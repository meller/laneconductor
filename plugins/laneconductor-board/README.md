# LaneConductor Board

LaneConductor Board is an optional add-on for LaneConductor, which keeps a project's plans as plain files in git (one folder per
track under `conductor/tracks/`). It builds the board: one private page that shows every track by lane, with a needs-attention
list, which Claude publishes as a private artifact.

Version 1.5.0. It is distributed from the marketplace `meller/laneconductor`, not from Anthropic's directory. It has no
dependency on the base plugin or on the connector: it is one script and one page, and it works alone.

| Plugin | Provides |
| :--- | :--- |
| `laneconductor` (base) | the `laneconductor` skill, every slash command (`/laneconductor:<name>`), the `plan-reviewer` subagent. Markdown only. |
| `laneconductor-parallel` (add-on) | the connector's tools (`mcp__plugin_laneconductor-parallel_lc__*`) and MCP prompts, the `track-runner` subagent (one per track, in its own worktree), `lc-scaffold.mjs`. No slash commands. |
| `laneconductor-board` (add-on) | `lc-board.mjs` and its page. No slash commands. |

## What is in it

- the board script, `server/bin/lc-board.mjs`, and its page, `server/src/board-page.html`. The base plugin's `board` command (no argument opens the board, `board refresh` rebuilds and republishes it)
  finds the script (it Globs for `**/laneconductor-board/**/bin/lc-board.mjs` under
  `~/.claude/plugins/cache`, where installed plugins live) and runs it; it shows how to install this add-on when it does not find it.

It adds no slash commands: the commands are in the base plugin. You can also run the script yourself:
`node server/bin/lc-board.mjs --repo . --site <dir> --json` writes `board.html`, `board.json` and one documents file per track that
is not done into `<dir>`, which must be outside `conductor/`.

## Install

It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

Add `--scope local` to install it for one project only (just for you),
or `--scope user` for every project. It needs Node.js 20 or newer and no npm packages. Update with
`claude plugin marketplace update laneconductor`, then `claude plugin update laneconductor-board@laneconductor`.

## Moving from the all-in-one plugin (versions 0.x)

Before version 1.0.0 the board script was part of the plugin `laneconductor`, which is now a Markdown-only base. If you are on 0.x,
uninstall it (`claude plugin uninstall laneconductor`), install the base (`claude plugin install laneconductor@laneconductor`) and
this add-on, and restart your sessions. The files in git are unchanged, so nothing is lost.

## What it runs and writes

- The script runs `git` read-only (the origin URL and the current branch name), reads `conductor/workflow.json`,
  the optional settings file `.laneconductor.json` and each track's `index.md`, `spec.md`, `plan.md` and `test.md`, and writes only into the folder you name
  with `--site`, never inside `conductor/`. It makes no network requests. Publishing the artifact is done by Claude, with your
  approval, never by the script.
- Board privacy: every document is scanned for secrets and personal data before it goes onto the board; a file with any match is
  withheld whole and named by track number and file name, never by its content. `conversation.md` is left out unless you set
  `board.include_conversation: true`, and sharing the artifact shares the documents on it, so share it only with people who may read
  them. The board is a snapshot: it changes only when you refresh it.

## Where it works

Claude Code and Cowork, on your own computer.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
