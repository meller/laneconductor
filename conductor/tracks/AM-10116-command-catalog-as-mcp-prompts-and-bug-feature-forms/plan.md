# Track 10116: Command catalog as MCP prompts (the FITI pattern) and bug and feature forms

## Phase 1: Bug and feature forms (small, independent)

- [ ] Task 1: Spec and test skeletons per `track_kind` in `connector/src/tracks.mjs` (`buildTrackFiles`); the generic skeleton stays for no kind
- [ ] Task 2: Tests: bug and feature forms exact sections, problem text intact, regression-test first case for bugs, no-kind unchanged, existing create_track tests unchanged
- [ ] Task 3: The skill's `setup/templates.md` and `ops/tracks.md` describe the same forms (source skill edit, regenerated into the plugin); `lc report-bug` and `lc feature-request` text mentions them

## Phase 2: The command catalog served as MCP prompts

- [ ] Task 1: `connector/src/commands.mjs`: the catalog (REQ-1), written agent-neutrally
- [ ] Task 2: Register prompts and the `help` prompt in `connector/src/server.mjs`; instructions mention prompts; keep the instructions under 4,096 characters
- [ ] Task 3: Tests with the SDK client: `prompts/list`, `prompts/get` with arguments, missing required argument error, `help` content, no tool contract change
- [ ] Task 4: README section: how to use the prompts from a client; link to FITI's pattern as the origin
- [ ] Task 5: Example hints in every tool description (REQ-7), a read-only `help` tool backed by the catalog, a test for the four annotations on all tools, and the KC-8 token estimate before and after (trim wording if over budget)

## Phase 3: Generate the plugin commands from the catalog

- [ ] Task 1: Generator profile builds `commands/*.md` from the catalog with the fallback line; remove `connector/plugin-extras/commands/`
- [ ] Task 1b: Catalog entries and generated commands for `help`, `show-board` and `refresh-board` (REQ-8); coverage: show-board and refresh-board are aliases of the skill's `board` row, `help` is new
- [ ] Task 2: Coverage test per REQ-5; lean directory emulation and add-on tests still pass
- [ ] Task 3: Regenerate both plugins, bump the version, validate `--strict`

## Phase 4: Documents and the human check

- [ ] Task 1: Update `connector/ARCHITECTURE.md` (the catalog is neutral core; plugin commands and MCP prompts are two adapters of it)
- [ ] Task 2 (HUMAN): AC-5 in a real session; record the result here

**Impact**: Every MCP client gets the same commands from one source, plugin commands cannot drift from them, and new tracks start as real bug or feature forms.
