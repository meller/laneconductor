# Spec: /laneconductor:explain

## Problem Statement
`lc-explain.mjs` (board add-on, track AM-10155) is the measuring module: per lane and per phase it shows time, tokens and tool calls, a short plan, and up to three suggestions, and writes `explain.md` per track and `conductor/statistics.md`. It starts only from a terminal (`node <path>/lc-explain.mjs --repo . --track N`) or from a board button that copies a prompt. There is no slash command, so a user who has installed the plugins cannot "explain" a track the way they plan, implement or review one. Post 9 (the token measurement) is waiting for this command.

## Decisions
- D1 (owner, 2026-11-24) The command lives in the **base** plugin (`laneconductor`) as Markdown, like `/laneconductor:board`, whose procedure finds a script of the board add-on by Glob. The script stays in the board add-on, so the base plugin stays Markdown only (the property the directory review depends on). This is base text, so it needs a new base version; REQ-7 of AM-10155 said such a change is its own track, which is this one. When the new base version is released, and whether it waits for the Anthropic review of the current one, is the owner's call (not this track).
- D2 (owner, 2026-11-24) The command explains ONE track or gives a PROJECT SUMMARY; there is no `all` argument and no loop over the tracks. Reasoning: explaining every track can be very heavy (owner). The consequence the track draws from it: the summary (`statistics`, also `summary` or `project`) runs `lc-explain.mjs --statistics`, which analyses no new track: it only adds up the tracks that already have an `explain.md`, so it is light, and the person decides which tracks are worth explaining. The command says how many tracks the summary covers and that a track missing from it needs `/laneconductor:explain <number>` first. Asked for "all", the command says: explain the tracks you care about one by one, then run the summary; explaining every track is slow and is not offered as one step.

## Requirements
- REQ-1 A catalog entry `explain` (group `board`, `needsBoardScript`) in `connector/src/commands.mjs`, listed in `/laneconductor:help` with an example phrase, and generated as `commands/explain.md` of the base plugin by `scripts/build-plugin.mjs`.
- REQ-2 Arguments (D2): a track number runs `lc-explain.mjs --repo . --track <N>` for that one track; `statistics`, `summary` or `project` (the same thing) runs `--statistics`, which only aggregates the tracks that already have an `explain.md` (rebuilds `conductor/statistics.md`, shows its Recommendations) and analyses no new track; empty means ask which track, naming the track in the running lane when there is exactly one. There is no `all` argument and no loop over the tracks: asked for all, the command says to explain the tracks one by one and then run the summary, because explaining every track is slow. The summary says how many tracks it summarized and that a track missing from it needs `/laneconductor:explain <number>` first.
- REQ-3 The procedure finds the script the way `board` finds `lc-board.mjs`: Glob `**/laneconductor-board/**/bin/lc-explain.mjs` under `~/.claude/plugins/cache`, or `connector/bin/lc-explain.mjs` in the LaneConductor repository. It never builds the report by hand.
- REQ-4 Output in the chat: the short plan table and the (up to three) suggestions, one line each, and where `explain.md` was written; then one line that the board shows it as the "Agent run" tab after `/laneconductor:board refresh`. Nothing else is changed; no commit.
- REQ-5 Add-on missing: one sentence and the two install commands as written (marketplace add, plugin install, `/reload-plugins`), each in its own block; run nothing; build nothing by hand.
- REQ-6 Privacy: the command text states that the script keeps numbers only (timestamps, token counts, tool names) and that no prompt, message or file content is shown or written.
- REQ-7 The base plugin stays Markdown only: no script, no package file, no MCP server is added; `claude plugin validate . --strict` and `node scripts/build-plugin.mjs --check` pass; every plugin keeps its own version rule (base gets a patch or minor bump for the new command; board and parallel unchanged).
- REQ-8 Docs: `docs/plugin-map.md` and the base README list the command; no text claims it before it is released.

## Acceptance Criteria
- [ ] `/laneconductor:explain 10154` in this repository shows the same short plan table as `node .../lc-explain.mjs --repo . --track 10154`
- [ ] With the board add-on not installed, it says so and shows the install commands, and runs nothing
- [ ] The base plugin contains no script; strict validation and the build check pass
- [ ] `/laneconductor:explain statistics` (also `summary`, `project`) shows how many tracks it summarized, says a missing track needs `explain <number>` first, and analyses no new track; there is no `all` argument
- [ ] The help list shows the command with an example phrase

## Out of scope
Changing `lc-explain.mjs` or its report, the lanes running it automatically, releasing the base version, pushing, the LinkedIn post (it waits for this command, owner decision 2026-11-24).

## Open questions
- Does the Anthropic directory review of the current base version need to finish before a new base version is released? (the owner decides; the track only produces the version)
