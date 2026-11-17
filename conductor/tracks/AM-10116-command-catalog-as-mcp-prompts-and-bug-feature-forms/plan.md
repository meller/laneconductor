# Track 10116: Command catalog as MCP prompts (the FITI pattern) and bug and feature forms

## Phase 1: Bug and feature forms (small, independent)

- [x] Task 1: Spec and test skeletons per `track_kind` in `connector/src/tracks.mjs` (`buildTrackFiles`); the generic skeleton stays for no kind
- [x] Task 2: Tests: bug and feature forms exact sections, problem text intact, regression-test first case for bugs, no-kind unchanged, existing create_track tests unchanged
- [x] Task 3: The skill's `setup/templates.md` and `ops/tracks.md` describe the same forms (source skill edit, regenerated into the plugin); `lc report-bug` and `lc feature-request` text mentions them (skill text done; the `lc` CLI help lines are unchanged because `lc report-bug` does not write the forms; only the connector and hand-made tracks do)

## Phase 2: The command catalog served as MCP prompts

- [x] Task 1: `connector/src/commands.mjs`: the catalog (REQ-1), written agent-neutrally
- [x] Task 2: Register prompts and the `help` prompt in `connector/src/server.mjs`; instructions mention prompts; keep the instructions under 4,096 characters
- [x] Task 3: Tests with the SDK client: `prompts/list`, `prompts/get` with arguments, missing required argument error, `help` content, no tool contract change
- [x] Task 4: README section: how to use the prompts from a client; link to FITI's pattern as the origin
- [x] Task 5: Example hints in every tool description (REQ-7), a read-only `help` tool backed by the catalog, a test for the four annotations on all tools, and the KC-8 token estimate before and after (trim wording if over budget)

## Phase 3: Generate the plugin commands from the catalog

- [x] Task 1: Generator profile builds `commands/*.md` from the catalog with the fallback line; remove `connector/plugin-extras/commands/`
- [x] Task 1b: Catalog entries and generated commands for `help`, `show-board` and `refresh-board` (REQ-8); coverage: show-board and refresh-board are aliases of the skill's `board` row, `help` is new
- [x] Task 2: Coverage test per REQ-5; the lean profile's directory emulation (built into a temp dir) and the full-plugin tests still pass
- [x] Task 3: Regenerate both plugins, bump the version, validate `--strict`

## Phase 4: Documents and the human check

- [x] Task 1: Update `connector/ARCHITECTURE.md` (the catalog is neutral core; plugin commands and MCP prompts are two adapters of it)
- [ ] Task 2 (HUMAN): AC-5 in a real session; record the result here

**Impact**: Every MCP client gets the same commands from one source, plugin commands cannot drift from them, and new tracks start as real bug or feature forms.
