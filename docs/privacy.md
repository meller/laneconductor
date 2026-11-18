# LaneConductor privacy policy

This covers the three LaneConductor plugins: `laneconductor` (the base, Markdown only), and the two optional add-ons
`laneconductor-parallel` (a local connector and a sub-agent for parallel work) and `laneconductor-board` (the board script).

## What they read and write

They read and write only your own project's files: the track folders under `conductor/tracks/` and the other files in
`conductor/`, plus the optional settings file `.laneconductor.json` when it exists. Claude does the reading and writing in your session, with your normal
permission prompts. The `laneconductor-parallel` add-on's local connector (a program running on your machine) writes the same files,
and commits them to your local git repository. The `laneconductor-board` add-on's script reads the track files and writes a page and
data into a folder you name, outside `conductor/`.

## What leaves your machine

Nothing, except what you choose to send:

- None of the plugins makes network requests of its own.
- None of the plugins has analytics, telemetry or tracking, and none collects or stores anything about you anywhere but in your own
  project's files.
- The text of your files is read by Claude, as it is for anything you ask Claude to do; that is covered by Anthropic's terms for the
  product you use, not by this page.
- Track files are ordinary files in your git repository: they leave the machine when you push the repository. No plugin pushes by
  itself, except that `laneconductor-parallel` has an opt-in setting (`connector.push: auto-state` in the optional settings file `.laneconductor.json`, off by
  default) that pushes track-only commits to your project's own git remote. The base plugin and the board add-on have no such setting.
- The board is a page that Claude publishes as an artifact, only when you approve it, using the page and data the
  `laneconductor-board` add-on builds. It is private by default, and sharing it is your choice. A secret and personal-data scan runs
  before anything is included, and files with a match are withheld. The base plugin alone has no board.

## Contact

Questions about this policy: https://github.com/meller/laneconductor/issues
