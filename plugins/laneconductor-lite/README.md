# LaneConductor Lite

LaneConductor Lite teaches Claude a plan-first way of working on a project whose plans are plain files in git: one folder per track
under `conductor/tracks/`, holding `index.md` (state markers), `spec.md`, `plan.md`, `test.md` and `conversation.md`. It
covers how to plan, implement, review, quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy.

Version 0.6.0.

## What it is, and what it is not

It is Markdown only: a skill, slash commands (`/laneconductor-lite:<name>`) and two subagents, `track-runner` and `plan-reviewer`.
Claude edits the track files directly, following the skill's file formats, and asks before any merge or push. It declares no
pre-approved tools, so nothing is allowed without your say.

LaneConductor Lite makes no network requests, installs nothing and runs no scripts. It contains no program, no server and no hook. It has no board.

## The full plugin

The full plugin, `laneconductor`, adds a board (a private dashboard of every track by lane), conflict-checked writes so two sessions or
people cannot overwrite each other, automatic commits, a generated track summary, a secret and personal-data scan, an advice log and
a health report, and a scaffold script. It runs a local Node.js program. Lite is complete without it.

To get it, uninstall Lite first (both contain the same skill; your track files stay compatible), then run these yourself:

```
claude plugin uninstall laneconductor-lite
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
/reload-plugins
```

More: https://github.com/meller/laneconductor

## License, privacy and support

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
