# LaneConductor Parallel

LaneConductor Parallel is an optional add-on for LaneConductor, which keeps a project's plans as plain files in git (one folder per
track under `conductor/tracks/`). It lets several Claude sessions, people or sub-agents work on tracks at the same time without
overwriting each other, each track in its own git worktree.

Version 1.2.2. It is distributed from the marketplace `meller/laneconductor`, not from Anthropic's directory, and it has no
dependency on the base plugin: it works alone (its tools and the sub-agent), and best together with the base `laneconductor`.

| Plugin | Provides |
| :--- | :--- |
| `laneconductor` (base) | the `laneconductor` skill, every slash command (`/laneconductor:<name>`), the `plan-reviewer` subagent. Markdown only. |
| `laneconductor-parallel` (add-on) | the connector's tools (`mcp__plugin_laneconductor-parallel_lc__*`) and MCP prompts, the `track-runner` subagent (one per track, in its own worktree), `lc-scaffold.mjs`. No slash commands. |
| `laneconductor-board` (add-on) | `lc-board.mjs` and its page. No slash commands. |

## What is in it

- the connector, a local MCP server (`/mcp` shows `plugin:laneconductor-parallel:lc`; its tools are named
  `mcp__plugin_laneconductor-parallel_lc__<tool>`): conflict-checked writes (a write needs the `base` from your last read and is
  refused with a `CONFLICT` if someone edited the file since), automatic commits (each write is one git commit containing only the
  files it wrote), freshness warnings, a generated track summary (`conductor/tracks-summary.md`), a secret and personal-data scan,
  an advice log and a health report, and the LaneConductor commands as MCP prompts;
- the `track-runner` subagent, which works one track through one lane in its own git worktree (`isolation: worktree`) and reports
  back; it never merges or pushes;
- the scaffold script `server/bin/lc-scaffold.mjs`, which the base's `new-project` command uses when it finds it.

It adds no slash commands: the commands are in the base plugin, which detects this add-on and uses its tools. Without the base, the
connector's tools and prompts and the subagent still work.

## Install

It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

Add `--scope local` to install it for one project only (just for
you), or `--scope user` for every project. It needs Node.js 20 or newer and installs two npm packages (`@modelcontextprotocol/server`,
`zod`) from the lockfile in this plugin; if the connector does not show in `/mcp`, run `npm ci` inside the plugin's folder.
Update with `claude plugin marketplace update laneconductor`, then `claude plugin update laneconductor-parallel@laneconductor`.
Restart your sessions after an update: a running connector process keeps the version it started with.

## Moving from the all-in-one plugin (versions 0.x)

Before version 1.0.0 the connector was part of the plugin `laneconductor`, which is now a Markdown-only base. If you are on 0.x,
uninstall it (`claude plugin uninstall laneconductor`), install the base (`claude plugin install laneconductor@laneconductor`)
and this add-on, and restart your sessions. The files in git are unchanged, so nothing is lost.

## What it runs and writes

- The connector is a Node process started over stdio by Claude Code (`node server/bin/lc-connector.mjs`). It works on the git
  repository of the project you have open (`CLAUDE_PROJECT_DIR`, else the current directory).
- The only program it starts is `git`, in that repository: read-only queries, and `add`, `commit` and `reset` for its own writes. It
  reads and writes files under `conductor/` (track folders, `tracks-summary.md`) and appends to `conductor/advice-log/`. Every
  write is a commit on the project's state branch (`main` by default) that contains exactly the files it wrote, and writes are
  refused when the checkout is on another branch.
- It makes no network requests of its own and never runs `git fetch`. It never pushes unless you set
  `{ "connector": { "push": "auto-state" } }` in the optional settings file `.laneconductor.json` (see `ops/settings.md` in the base plugin's skill); then it runs a fast-forward `git push` of the state branch 60
  seconds after its last write, and only when every unpushed commit touches nothing outside `conductor/`. It never forces a push.
- The advice log records tool names, success flags, timings, sizes and error codes, plus the one-line reason Claude gives when it
  deviates from advice; it holds no file contents or prompts. It is an ordinary file in your repository and goes to your git remote
  only if you or the `auto-state` setting push it.
- If a connector call fails because of a lane or status name that the project's `workflow.json` does not use, the error names the
  nearest valid one, and `get_track` and `get_context` list the valid lanes and statuses.
- When the connector ends or hits an error it did not expect, it writes one line with the reason to its log (stderr, shown by
  `claude --debug`), and keeps serving after an unexpected error.

## Where it works

Claude Code and Cowork, on your own computer. In claude.ai chat only skills load, so this add-on does nothing there.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
