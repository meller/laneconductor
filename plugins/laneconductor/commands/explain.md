---
description: Explain where an agent run's time and tokens went for one track, or give a project summary of the tracks already explained (the argument statistics), like an SQL EXPLAIN
argument-hint: "[track number | statistics]"
---
Explain: `$ARGUMENTS` (nothing given means ask me which track). Show where the time and the tokens of an agent run went, like an SQL EXPLAIN. The numbers come from the explain script (`lc-explain.mjs`) of the board add-on: never work them out, estimate them or write the report by hand.

1. What I gave: a track number (`10106` or `AM-10106`) explains that one track; `statistics`, `summary` or `project` (the same thing) gives the project summary; empty: ask which track, and name the track that is in the running lane (`**Lane Status**: running` in its `index.md`) when exactly one is, with none or several ask without naming one. There is no `all`: if I ask to explain all tracks, say that explaining every track is slow and is not offered as one step, and tell me to explain the tracks I care about one by one and then run the summary. Anything else: ask which one I mean.
2. Find the explain script of the board add-on (its `bin/lc-explain.mjs`; in the LaneConductor repository `connector/bin/lc-explain.mjs`) and run it from the project root: `--repo . --track <number>` for a track, `--repo . --statistics` for the project summary. The summary analyses no new track: it only adds up the tracks that already have an `explain.md`. Run nothing else with it.
3. Show the short plan as the script printed it: its table, and the suggestion lines below it (at most three), one line each. For the project summary, show how many tracks it summarized (the line `Tracks with an explain.md: N`, or `N tracks have statistics`) its Insight lines (the totals, the highest cache-read ratio, the most human waiting) and its Recommendations, so the whole summary comes back into this chat, and say that a track missing from it needs `explain <number>` first (this command with that track's number). Do not paste the details.
4. Say where the report was written (`conductor/tracks/<folder>/explain.md` for a track, `conductor/statistics.md` for the summary; a track run also rebuilds `conductor/statistics.md`). Those are the only files written; change nothing else and make no commit.
5. Say in one line that the board shows the report as the "Agent run" tab of the track, and the statistics under the Project button, after the board is refreshed (the `board` command with `refresh`).
6. Privacy: the script keeps numbers only (timestamps, token counts, tool names); no prompt, message or file content is shown or written. Say so in one line.
7. If the board add-on is not installed, say so in one sentence and show how to get it; run nothing and build nothing by hand.

In Claude Code, type it as `/laneconductor:explain 10106` or `/laneconductor:explain statistics` (also `summary` or `project`); a track missing from the summary needs `/laneconductor:explain <number>` first; after `/laneconductor:board refresh` the board shows the report as the "Agent run" tab of the track.

The explain script belongs to the optional laneconductor-board add-on: find it with Glob `**/laneconductor-board/**/bin/lc-explain.mjs` under `~/.claude/plugins/cache` (or `connector/bin/lc-explain.mjs` in the LaneConductor repository) and run `node <that path> --repo . --track <number>`, or `node <that path> --repo . --statistics` for the project summary. If neither exists, the laneconductor-board add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: run nothing, do not work out the numbers and do not write the report by hand. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

More: https://github.com/meller/laneconductor
