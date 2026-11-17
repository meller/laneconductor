# LaneConductor

LaneConductor keeps a project's plans as plain files in git: one folder per track under
`conductor/tracks/`, holding `index.md` (state markers), `spec.md`, `plan.md`, `test.md` and
`conversation.md`. This plugin teaches Claude the workflow for them: how to plan, implement, review,
quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy.
It contains only Markdown, JSON and one icon: no program, no server, no hook.

Version {{VERSION}}.

## Install

In Claude Code: `/plugin marketplace add meller/laneconductor`, then `/plugin install laneconductor@laneconductor`.
Or use "Upload plugin" with a zip of the `plugins/laneconductor` folder.

## What is in it

- the `laneconductor` skill: the lane guides (`plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`),
  the track operations (create, move, comment, status, workflow) and the working-a-track guardrails;
- slash commands that are thin entry points to the skill, run as `/laneconductor:<name>`: `plan`, `brainstorm`,
  `implement`, `review`, `quality-gate`, `merge`, `run`, `new`, `bug`, `feature`, `status`, `move`, `comment`,
  `board`, `workflow` and `review-plan`, each taking a track number or title; `setup` and `deploy` run only when you
  name them;
- two subagents: `track-runner` works one track through one lane in its own git worktree, and `plan-reviewer`
  reads a track's spec and plan and reports gaps without changing anything.

`run`, `implement` and `review` only recommend `track-runner` (one subagent per track, each in its own worktree,
so tracks do not collide and can run in parallel) and show the exact dispatch; nothing starts until you say yes.

## What it does on your machine

The plugin itself runs nothing. The skill is instructions for Claude: it asks Claude to read and edit files and to
run shell commands in your project (git, tests, builds, and the deploy commands you configure), under your normal
Claude Code permission prompts. The skill declares no pre-approved tools, so nothing is allowed without your say.
The setup and deploy guidance runs only when you ask for it by name, and the skill asks before any merge or push.
It has no hooks; a few habits (a short status first, one next step, asking before a push) are written into the skill instead.
Nothing leaves your machine from this plugin.

## Where it works

The skill and commands work in Claude Code, Cowork and claude.ai chat (in chat the commands load as skills);
subagents run in Claude Code and Cowork only. Without the optional connector below, Claude edits the track files directly,
following the skill's file formats.

## Optional plugins

The directory can list only Markdown, so the two things in LaneConductor that need a program on your computer are
separate plugins in the same marketplace. Both depend on this one and are optional; install them after it.

- `laneconductor-board` adds the board: a static page and data snapshot of every track by lane, which Claude
  publishes as a private artifact (`lc board --site <dir>`). Install: `claude plugin install laneconductor-board@laneconductor`.
- `laneconductor-connector` adds a local MCP server for the track files: conflict-checked writes (a write needs the
  `base` from your last read and is refused with a `CONFLICT` if someone edited the file since), automatic commits
  (each write is one git commit containing only the files it wrote) and freshness warnings. Install:
  `claude plugin install laneconductor-connector@laneconductor`.

The commands and subagents here use the connector's tools when they are present and work without them otherwise;
generating the board needs `laneconductor-board` or the `lc` command-line tool. If you used the earlier single
`laneconductor` plugin, it included both; after this update install `laneconductor-board` for the dashboard and
`laneconductor-connector` to keep safe writes. Hooks are planned for the add-ons.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
