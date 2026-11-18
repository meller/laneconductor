# Track AM-10133: Plugin-only setup: no lc CLI, no old scheme, setup offers the recommended plugins

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: The owner's decision (2026-11-18): the `lc` command line and the old scheme (daemon, database, `make install`, rc file, `lc` subcommands, `.laneconductor.json` as a control file) do not exist any more. LaneConductor is the plugins plus files in git. Everything that still assumes the old scheme must change to the plugin architecture.

Seen on 2026-11-18 in the Fiti PLUG first run of `/laneconductor:setup`: the session ran `which lc`, found `/usr/local/bin/lc` (the old daemon CLI, still on this machine), and probed `.laneconductor.json`. Setup must never look for or depend on `lc`.

Scope:
1. Inventory every shipped text and tool that still names `lc`, `lc board`, `lc new`, `lc update-track`, `lc track-dir`, `lc worktrees`, `lock.mjs`, `measure.mjs`, `make install`, `laneconductorrc`, or `.laneconductor.json` (the base plugin has about 17 files that mention one of these: commands show-board/board/refresh-board, lanes plan/implement/quality-gate/merge, setup/scaffold/templates, deploy/setup-deploy, ops board/tracks/new-project/working-a-track, README, SKILL.md; the add-ons also have `lc-*` binary names and README text). For each: replace with the plugin way (connector tools when the parallel add-on is installed, direct file edits otherwise, the board add-on's own script), or delete.
2. Decide what `.laneconductor.json` is now (probably only the board URL and the chosen options, or nothing), write it down in the reference, and make setup, the board commands and the connector agree.
3. Setup recommends and offers the plugins and skills: after the project is read, setup says which of `laneconductor-parallel` (conflict-checked tools, track-runner, worktrees), `laneconductor-board` (the shared board) and the small starter set of skills fit THIS project, why, and prints each install command in its own ```bash fence (show, never run, never install without a yes). Source of truth is the one catalog `connector/plugin-extras/recommended-plugins.json`; the base does not recommend what is already installed. Keep the hook for the skill advisor (track 10124) for generic skills.
4. Update docs and the landing/wiki text that still describe the old scheme (list the files; do not deploy the landing; do not touch the other session's uncommitted landing edits).
5. Tests: the base plugin must stay free of daemon-era words (existing test), a new test that no shipped text names an `lc` subcommand or `make install`, and a setup walk-through test on a scratch repo with no `lc` on PATH.

Out of scope: deleting the legacy daemon code or the `v1-legacy` tag; removing `bin/lc.mjs` from this repository; changing the `/usr/local/bin/lc` link on this machine (tell the owner it exists).
**Summary**: The owner's decision (2026-11-18): the `lc` command line and the old scheme (daemon, database, `make install`, rc file, `lc` subcommands, `.laneconductor.json` as a control file) do not exist any more
