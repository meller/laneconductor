# Spec: /laneconductor:explain

## Problem Statement
`lc-explain.mjs` (board add-on, track AM-10155) is the measuring module: per lane and per phase it shows time, tokens and tool calls, a short plan, and up to three suggestions, and writes `explain.md` per track and `conductor/statistics.md`. It starts only from a terminal (`node <path>/lc-explain.mjs --repo . --track N`) or from a board button that copies a prompt. There is no slash command, so a user who has installed the plugins cannot "explain" a track the way they plan, implement or review one. Post 9 (the token measurement) is waiting for this command.

## Decisions
- D1 (owner, 2026-11-24) The command lives in the **base** plugin (`laneconductor`) as Markdown, like `/laneconductor:board`, whose procedure finds a script of the board add-on by Glob. The script stays in the board add-on, so the base plugin stays Markdown only (the property the directory review depends on). This is base text, so it needs a new base version; REQ-7 of AM-10155 said such a change is its own track, which is this one. When the new base version is released, and whether it waits for the Anthropic review of the current one, is the owner's call (not this track).

## Requirements
- REQ-1 A catalog entry `explain` (group `board`, `needsBoardScript`) in `connector/src/commands.mjs`, listed in `/laneconductor:help` with an example phrase, and generated as `commands/explain.md` of the base plugin by `scripts/build-plugin.mjs`.
- REQ-2 Arguments: a track number runs `lc-explain.mjs --repo . --track <N>`; the word `statistics` runs `--statistics` (rebuilds `conductor/statistics.md`, shows its Recommendations); empty means ask which track, naming the track in the running lane when there is exactly one.
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
- [ ] The help list shows the command with an example phrase

## Out of scope
Changing `lc-explain.mjs` or its report, the lanes running it automatically, releasing the base version, pushing, the LinkedIn post (it waits for this command, owner decision 2026-11-24).

## Open questions
- Does the Anthropic directory review of the current base version need to finish before a new base version is released? (the owner decides; the track only produces the version)
