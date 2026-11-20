# LaneConductor Board

LaneConductor Board is an optional add-on for LaneConductor, which keeps a project's plans as plain files in git (one folder per
track under `conductor/tracks/`). It builds the board: one private page that shows every track by lane, with a needs-attention
list, which Claude publishes as a private artifact.

Version {{VERSION}}. It is distributed from the marketplace `meller/laneconductor`, not from Anthropic's directory. It has no
dependency on the base plugin or on the connector: it is one script and one page, and it works alone.

{{PLUGIN_MAP}}

## What is in it

- the board script, `server/bin/lc-board.mjs`, and its page, `server/src/board-page.html`. The base plugin's `board` command (no argument opens the board, `board refresh` rebuilds and republishes it)
  finds the script (it Globs for `**/laneconductor-board/**/bin/lc-board.mjs` under
  `~/.claude/plugins/cache`, where installed plugins live) and runs it; it shows how to install this add-on when it does not find it.

- no commands of its own: everything is typed under `/laneconductor:`. The base command `/laneconductor:board refresh` rebuilds the board and publishes only the files that changed (a partial publish: one track edited sends `board.json`, that track's document and a small `manifest.json`); the first publish, a conflict or a failure publishes everything. It needs a stored board.
- two hooks (`hooks/hooks.json`, one script, `hooks/lc-board-hook.mjs`) that note when a track changed (Edit or Write of a track file, the connector's `create_track` and
  `update_track`) in the plugin's data directory, never in your project. By default, when Claude finishes a turn after a track changed and `board.artifact_url` is stored, it is asked once to run `/laneconductor:board refresh`, and so is it when a lane starts running (plan, implement, review or quality gate), so the board shows the work as it begins; the refresh it asks for is quiet and reports nothing unless it failed. Set `board.auto_update: false` in `.laneconductor.json` to turn that off. With no stored board they do nothing at all.
  The hooks make no network request, run no program but a read-only `git` and print no file text.
- an open board refreshes its own view: while its tab is visible the page reads a tiny index, `version.json` (the board's generated time, about 60 bytes), every 15 seconds and never the board itself. When a newer board was published it reloads itself, unless you have a track open or a search typed; then it shows a "newer board" button instead. One automatic reload per two minutes at most.

This add-on adds no slash commands. You can also run the script yourself:
`node server/bin/lc-board.mjs --repo . --site <dir> --json` writes `board.html`, `board.json`, `manifest.json` and one documents file per track that
is not done into `<dir>`, which must be outside `conductor/`; with `--previous <the manifest.json read from the live artifact>` its JSON also lists what changed.

## Install

{{SELF_NOTE}}

{{INSTALL_SELF}}

{{FULL_INSTALL}}

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
  approval, never by the script or a hook.
- Board privacy: every document is scanned for secrets and personal data before it goes onto the board; a file with any match is
  withheld whole and named by track number and file name, never by its content. `conversation.md` is left out unless you set
  `board.include_conversation: true`, and sharing the artifact shares the documents on it, so share it only with people who may read
  them. The board is a snapshot: it changes only when you refresh it.

## Where it works

Claude Code and Cowork, on your own computer.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: {{PRIVACY_URL}}. Questions and bugs: https://github.com/meller/laneconductor/issues
