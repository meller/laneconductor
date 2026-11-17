# LaneConductor

LaneConductor keeps a project's plans as plain files in git: one folder per track under
`conductor/tracks/`, holding `index.md` (state markers), `spec.md`, `plan.md`, `test.md` and
`conversation.md`. This plugin gives Claude two things for working with them:

- the `laneconductor` skill: how to plan, implement, review, quality-gate and merge a track, plus
  guidance for setting up LaneConductor in a new project and for deploying;
- `lc-connector`, a local MCP server that reads and writes those track files safely, as git commits.

Version 0.2.0.

## Install

In Claude Code: `/plugin marketplace add meller/laneconductor`, then `/plugin install laneconductor@laneconductor`.
Or use "Upload plugin" with a zip of the `plugins/laneconductor` folder. The connector needs Node.js 20 or newer
and installs its two npm packages (`@modelcontextprotocol/server`, `zod`) from the lockfile in this plugin.

## What the plugin runs

- The connector is a Node process started over stdio by Claude Code (`node server/bin/lc-connector.mjs`).
  It works on the git repository of the project you have open (`CLAUDE_PROJECT_DIR`, else the current
  directory, or an explicit `--repo`).
- It runs `git` in that repository: read-only queries (status, log, rev-parse, rev-list, config), `add`,
  `commit` and `reset` for its own writes, and `push` only in the case described below.
- It reads and writes files under `conductor/` (track folders, `tracks-summary.md`) and appends to
  `conductor/advice-log/`. Every write is a commit on the project's state branch (`main` by default) that
  contains exactly the files it wrote.
- It starts no other programs and makes no network requests of its own. It never pushes unless you set
  `{ "connector": { "push": "auto-state" } }` in `.laneconductor.json`; then it runs a fast-forward
  `git push` of the state branch, 60 seconds after its last write, and only when every unpushed commit
  touches nothing outside `conductor/`. It never forces a push and never runs `git fetch`.
- The skill is instructions for Claude. It asks Claude to read and edit files and to run shell commands in
  your project (git, tests, builds, and the deploy commands you configure) under your normal Claude Code
  permissions. The setup and deploy guidance runs only when you ask for it by name.

## What leaves your machine

Nothing, from this plugin. The connector sends no data anywhere. The advice log it keeps in your repository
records tool names, success flags, timings, sizes and error codes, plus the one-line reason Claude gives when
it deviates from advice; it holds no file contents or prompts. It is an ordinary file in your repository: it
goes to your git remote only if you or the `auto-state` setting push it.

## Where it works

The connector runs in Claude Code and Cowork on your own computer. It does not run in claude.ai chat or on
mobile, because it needs a local git checkout. The skill alone also works in chat.

## Safety

- Writes need the `base` you got from your last read; if someone edited the file since, the write is
  refused with a `CONFLICT` and Claude re-reads and merges.
- Writes are refused unless the checkout is on the state branch, so code branches never carry track state.
- Commits touch only the paths written, so unrelated staged or dirty files are never swept in.
- It never force-pushes, and by default never pushes at all.

## Board

`lc board --site <dir>` (the `lc` command-line tool from the LaneConductor repository) writes a static page
and a JSON snapshot showing every track by lane. Claude can publish them as a private artifact that only
changes when refreshed.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
