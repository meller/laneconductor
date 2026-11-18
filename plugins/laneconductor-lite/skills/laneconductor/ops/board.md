# board: needs the full plugin

For "board", "show the board", "update the board", "refresh the board" or `/laneconductor-lite:board`.

The board, a private dashboard of every track by lane, is part of the full LaneConductor plugin. LaneConductor Lite does not
include it. Say that in a sentence or two, then show the person how to get the full plugin (the commands are in
[../FULL-PLUGIN.md](../FULL-PLUGIN.md); show them as written):

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
/reload-plugins
```

The person runs these, after `claude plugin uninstall laneconductor-lite`. Do nothing else: do not look for a board, do not generate or build one,
do not publish anything, and never run an install command yourself. If the person only wants an overview, offer to list the tracks
by lane from their `index.md` files instead. More: https://github.com/meller/laneconductor
