# Track 1077: Migrate Gemini CLI support to Antigravity

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: CLI-dispatch already fully supported `agy`/antigravity alongside `gemini` before this track (`runAIAgent`/`callLLMConversational` in `bin/lc.mjs`, `buildCliArgs` in `laneconductor.sync.mjs` — untouched). This track closed the two real gaps: `bin/lc.mjs`'s setup wizard now labels `gemini` "(retired — use antigravity)" in both agent menus and prints a non-blocking deprecation warning (with the `lc config` command to switch) when it's chosen; and `SKILL.md`'s `/laneconductor setup collection` docs (reachability table, model-discovery table, menu summary lines, example `.laneconductor.json`, DB schema comment) now document `agy` and match what the wizard actually offers. No runtime dispatch changed — existing `gemini`-configured projects keep working exactly as before.
