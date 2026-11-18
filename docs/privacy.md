# LaneConductor privacy policy

This covers both LaneConductor plugins: `laneconductor` (the full plugin) and `laneconductor-lite` (the Markdown-only plugin).

## What they read and write

They read and write only your own project's files: the track folders under `conductor/tracks/` and the other files in
`conductor/`, plus `.laneconductor.json` when it exists. Claude does the reading and writing in your session, with your normal
permission prompts. The full plugin's local connector (a program running on your machine) writes the same files, and commits them
to your local git repository.

## What leaves your machine

Nothing, except what you choose to send:

- Neither plugin makes network requests of its own.
- Neither plugin has analytics, telemetry or tracking, and neither collects or stores anything about you anywhere but in your own
  project's files.
- The text of your files is read by Claude, as it is for anything you ask Claude to do; that is covered by Anthropic's terms for the
  product you use, not by this page.
- Track files are ordinary files in your git repository: they leave the machine when you push the repository. Neither plugin pushes
  by itself, except that the full plugin has an opt-in setting (`connector.push: auto-state` in `.laneconductor.json`, off by
  default) that pushes track-only commits to your project's own git remote. LaneConductor Lite has no such setting.
- The full plugin's board is a page that Claude publishes as an artifact, only when you approve it. It is private by default, and
  sharing it is your choice. A secret and personal-data scan runs before anything is included, and files with a match are withheld.
  LaneConductor Lite has no board.

## Contact

Questions about this policy: https://github.com/meller/laneconductor/issues
