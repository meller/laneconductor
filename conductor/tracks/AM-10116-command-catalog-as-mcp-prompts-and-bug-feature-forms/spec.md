# Spec: Command catalog as MCP prompts (the FITI pattern) and bug and feature forms

## Problem Statement

Commands exist twice today: as hand-written plugin command files (Claude only) and as skill routing rows. The agent-neutral way is the FITI pattern: the connector exposes each command as an MCP prompt (prompts/list, prompts/get) plus a help prompt with example phrases. Any MCP client then sees the same commands, including claude.ai and mobile through the remote connector, where plugin commands do not exist. The plugin's command files should then be GENERATED from the same catalog, so there is one source of truth.

Also: "flag a bug" and "feature request" only set a `track_kind` marker today. Both create the same generic spec skeleton. They should create real forms: a bug form (symptom, steps to reproduce, expected, actual, suspected area, environment) and a feature form (the need, who it is for, the wanted outcome, acceptance criteria, out of scope), with a bug track's test.md starting with a regression-test case.

Reference: ~/Code/fiti/functions/src/mcp.js (server.registerPrompt, the prompts table, aliases) and its `help` tool.

## Requirements

- REQ-1 (catalog, agent-neutral): `connector/src/commands.mjs` is the single source of every command: `name`, `title`, `description`, `args` (name, description, required) and a short `procedure` text that points at the lane guides and the connector tools by their plain names. It names no Claude-specific tool prefix and no plugin path. It covers every command row in the skill routing table that is a command (plan, brainstorm, implement, review, quality-gate, merge, run, new, bug, feature, status, move, comment, board, workflow, setup, deploy, review-plan) plus `help`.
- REQ-2 (MCP prompts): the stdio server registers each catalog entry as an MCP prompt (SDK `registerPrompt`, as FITI does) so `prompts/list` returns them and `prompts/get` returns one user message: the procedure with the arguments filled in. A `help` prompt lists every command with one example phrase each. The server instructions mention that prompts exist. Additive: no existing tool, response shape or error code changes.
- REQ-3 (Claude adapter generated): `scripts/build-plugin.mjs` generates the plugin's `commands/*.md` from the catalog (frontmatter `description` and `argument-hint` from the entry; body = procedure plus the plugin-specific fallback line: use the connector tools when present, otherwise edit the track files following the skill). The hand-written files in `connector/plugin-extras/commands/` are removed. Output stays deterministic and passes the lean-plugin directory emulation test.
- REQ-4 (bug and feature forms): `create_track` with `track_kind: bug` writes a spec skeleton with, after the Problem Statement, the empty sections: Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment; and a test.md whose first case is the regression test that reproduces the bug before the fix. `track_kind: feature` writes: The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope. No kind keeps today's generic skeleton. The `problem` text is always placed under Problem Statement unchanged. The skill's `setup/templates.md` and `ops/tracks.md` describe the same forms, so hand-made tracks match.
- REQ-5 (coverage): the coverage test compares the catalog with the skill routing table (every routing-table command is in the catalog or in coverage.json with a reason) and checks that every catalog entry produces exactly one plugin command file and one MCP prompt.
- REQ-6 (neutral core): nothing in the catalog or the prompts depends on Claude. Claude-only behaviour (frontmatter, subagent names, fallback wording) lives in the generator profile.
- REQ-7 (hints, FITI style): every connector tool description ends with one or two `Example:` lines mapping a natural phrase to the call (for example `Example: "plan track 10106" -> get_context {lane: "plan"} then get_track {track: 10106}`), written in the neutral catalog vocabulary; a `help` TOOL (read-only, empty input) returns the command catalog with one example phrase per command, as FITI's does, so clients that do not surface prompts can still ask "what can you do". The four annotation hints (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) stay on every tool; a test asserts all four are present on every tool including `help`. The tool descriptions plus the help text stay within the context budget (KC-8: report the new token estimate).

## Acceptance Criteria

- [ ] AC-1: An MCP client (the SDK test client) lists the prompts and gets each one with arguments substituted; `help` lists all commands.
- [ ] AC-2: The generated plugin commands match the catalog; no hand-written command file remains; the coverage test passes.
- [ ] AC-3: `create_track` with `track_kind` bug or feature writes the forms above; the problem text is intact; a track with no kind is unchanged.
- [ ] AC-4: The plugin and the add-on still pass `claude plugin validate --strict` and the directory emulation test; the lean plugin still ships only Markdown, JSON and the icon.
- [ ] AC-5 (HUMAN): in a real client, a prompt such as `help` appears and returns the list; `/laneconductor:bug ...` creates a bug track with the form.
- [ ] AC-6: Each tool description carries Example lines; `help` returns every command with an example phrase; all tools carry the four annotation hints; the KC-8 estimate is reported and not more than 15% above today's.
