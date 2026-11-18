---
description: "The board needs the full LaneConductor plugin: shows how to get it"
---
The board (a private dashboard of every track by lane) is part of the full LaneConductor plugin; LaneConductor Lite does not include it. Do nothing else: do not look for a board, do not generate or publish anything, and never run an install command yourself.

Tell me that in a sentence or two, then show me these commands as written (I run them myself, after `claude plugin uninstall laneconductor-lite`, because both plugins contain the same skill; my track files stay compatible):

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor@laneconductor
/reload-plugins
```

More: https://github.com/meller/laneconductor
