# LaneConductor Board

`laneconductor-board` is a local add-on for the [LaneConductor plugin](https://github.com/meller/laneconductor).
It adds the board: a static page and a data snapshot that show every track of your project by lane, with a
needs-attention list and, when you open a track, its documents. The board needs a script that runs on your computer,
so it is a separate plugin you install from the marketplace, not from Anthropic's directory (the directory accepts
only Markdown, text, JSON, YAML and a few image types from a publisher that is not a verified organization). It
depends on the `laneconductor` plugin, which supplies the skill and the `/laneconductor:board` command; Claude Code
installs both together.

Version 0.3.0.

## Install

In Claude Code: `/plugin marketplace add meller/laneconductor`, then `/plugin install laneconductor-board@laneconductor`
(the command-line form is `claude plugin install laneconductor-board@laneconductor`). It needs Node.js 20 or newer and
no npm package: the plugin is one script and the source files it imports.

Migration: the old single `laneconductor` plugin included the board script and the connector. That plugin is now the
lean main plugin, so after updating it, install `laneconductor-board` to get the dashboard, and
`laneconductor-connector` to keep safe writes.

## Use

Run `/laneconductor:board`. Claude generates the page and data into a temporary folder outside your repository,
publishes them as a private artifact and keeps its URL in `.laneconductor.json` (`board.artifact_url`), then refreshes
that artifact the next time you ask. The board is a snapshot: it changes only when you refresh it. By hand:
`node server/bin/lc-board.mjs --repo . --site <dir>` writes `board.html` (identical every run, no data in it),
`board.json` and one `docs/<number>.json` per track that is not done; `--json` prints the file list as one object.
The same command is available as `lc board --site <dir>` in the `lc` command-line tool of the LaneConductor repository.

## What it runs and reads

The script runs `git` read-only in your project (the origin remote's URL and the current branch name) and reads
`conductor/workflow.json`, `.laneconductor.json` and each track's `index.md`, `spec.md`, `plan.md` and `test.md`. It
writes only into the folder you name with `--site`, which may not be inside `conductor/`. It starts no other programs
and makes no network requests of its own; publishing the artifact is done by Claude, with your approval, never by the
script. The page itself, when someone opens it, loads its three fonts from Google Fonts and nothing else.

## Privacy

Before any document goes onto the board, every file is scanned for secrets and personal data (tokens, keys,
connection strings with passwords, credential assignments, e-mail addresses); a file with any match is withheld
whole and named on stderr by track number and file name, never by its content. `conversation.md` is left out unless
you set `board.include_conversation: true`, and `board.include_docs: false` in `.laneconductor.json` turns all
documents off. Sharing the artifact shares the documents on it, so share it only with people who may read them.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
