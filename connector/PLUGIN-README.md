# LaneConductor

LaneConductor keeps a project's plans as plain files in git: one folder per track under
`conductor/tracks/`, holding `index.md` (state markers), `spec.md`, `plan.md`, `test.md` and
`conversation.md`. This one plugin teaches Claude the workflow for them (how to plan, implement, review,
quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy) and includes
the local connector that reads and writes the track files safely and the board generator.

Version {{VERSION}}.

## What is in it

- the `laneconductor` skill: the lane guides (`plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`),
  the track operations (create, move, comment, status, workflow) and the working-a-track guardrails;
- slash commands that are thin entry points to the skill, run as `/laneconductor:<name>`: `plan`, `brainstorm`,
  `implement`, `review`, `quality-gate`, `merge`, `run`, `new`, `bug`, `feature`, `status`, `move`, `comment`,
  `board`, `workflow` and `review-plan`, each taking a track number or title; `setup` and `deploy` run only when you
  name them;
- two subagents: `track-runner` works one track through one lane in its own git worktree, and `plan-reviewer`
  reads a track's spec and plan and reports gaps without changing anything. `run`, `implement` and `review` only
  recommend `track-runner` (one subagent per track, so tracks do not collide) and show the exact dispatch; nothing
  starts until you say yes;
- the connector, a local MCP server (`/mcp` shows `plugin:laneconductor:lc`; its tools are named
  `mcp__plugin_laneconductor_lc__<tool>`): conflict-checked writes (a write needs the `base` from your last read and
  is refused with a `CONFLICT` if someone edited the file since), automatic commits (each write is one git commit
  containing only the files it wrote) and freshness warnings;
- the board generator, `server/bin/lc-board.mjs`, used by `/laneconductor:board`: a static page and data snapshot of
  every track by lane, which Claude publishes as a private artifact.

Hooks are planned and will be listed here when they ship. Until then a few habits (a short status first, one
next step, asking before a push) are written into the skill.

## Install

In Claude Code:

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
```

Add `--scope local` to install it for one project only (just for you), or `--scope user` for every project.
Or use "Upload plugin" in Claude (desktop app or claude.ai: Customize, Plugins, Add) with `laneconductor-<version>.zip`
from the Releases page of https://github.com/meller/laneconductor. After an upload install, `/mcp` should show the
connector; if it does not, run `npm ci` inside the plugin's folder. It needs Node.js 20 or newer and installs its two
npm packages (`@modelcontextprotocol/server`, `zod`) from the lockfile in this plugin. Update with
`claude plugin marketplace update laneconductor`, then `claude plugin update laneconductor@laneconductor`.
If you keep a copy of the LaneConductor skill in your own project (`.claude/skills/laneconductor`) or in
`~/.claude/skills`, remove it so the skill is not loaded twice.

## What it runs and writes

- The connector is a Node process started over stdio by Claude Code (`node server/bin/lc-connector.mjs`). It works on
  the git repository of the project you have open (`CLAUDE_PROJECT_DIR`, else the current directory).
- The only program it starts is `git`, in that repository: read-only queries, and `add`, `commit` and `reset` for its own
  writes. It reads and writes files under `conductor/` (track folders, `tracks-summary.md`) and appends to
  `conductor/advice-log/`. Every write is a commit on the project's state branch (`main` by default) that contains
  exactly the files it wrote, and writes are refused when the checkout is on another branch.
- It makes no network requests of its own and never runs `git fetch`. It never pushes unless you set
  `{ "connector": { "push": "auto-state" } }` in `.laneconductor.json`; then it runs a fast-forward `git push` of the
  state branch 60 seconds after its last write, and only when every unpushed commit touches nothing outside `conductor/`.
  It never forces a push.
- The advice log records tool names, success flags, timings, sizes and error codes, plus the one-line reason Claude gives
  when it deviates from advice; it holds no file contents or prompts. It is an ordinary file in your repository and goes
  to your git remote only if you or the `auto-state` setting push it.
- The board script runs `git` read-only (the origin URL and the current branch name), reads `conductor/workflow.json`,
  `.laneconductor.json` and each track's `index.md`, `spec.md`, `plan.md` and `test.md`, and writes only into the
  folder you name with `--site`, never inside `conductor/`. Publishing the artifact is done by Claude, with your
  approval, never by the script.
- The skill is instructions for Claude: it asks Claude to read and edit files and to run shell commands in your project
  (git, tests, builds, and the deploy commands you configure) under your normal Claude Code permission prompts. It
  declares no pre-approved tools, and it asks before any merge or push.

## Board privacy

Every document is scanned for secrets and personal data before it goes onto the board; a file with any match is
withheld whole and named by track number and file name, never by its content. `conversation.md` is left out unless you
set `board.include_conversation: true`, and sharing the artifact shares the documents on it, so share it only with
people who may read them.

## Where it works

The connector, the board script and the subagents run in Claude Code and Cowork on your own computer. In claude.ai chat
only the skill and the commands load (as skills), and Claude edits the track files directly, following the skill.

## Not in Anthropic's directory

This plugin is not in Anthropic's plugin directory, because the directory accepts only Markdown from a publisher that is
not a Verified organization and this plugin runs a local program; install it from the marketplace above or by upload.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
