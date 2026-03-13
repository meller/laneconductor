# Track 1013: Multi-CLI Agent Support (Gemini, Codex, Amp)

**Lane**: backlog
**Lane Status**: success
**Progress**: 0%
**Last Run By**: gemini
**Phase**: Spec & Planning
**Summary**: Complete multi-CLI wiring for Codex and Amp; fix hardcoded skill path; add exhaustion detection for all CLIs

## Problem
`buildCliArgs()` and exhaustion detection in `laneconductor.sync.mjs` only fully support `claude` and `gemini`. Codex and Amp fall through to an untested generic path. The skill path is hardcoded to the user's home directory. `setup collection` model discovery only covers Claude and Gemini.

## Solution
Add explicit CLI invocation formats for Codex and Amp in `buildCliArgs`, dynamic skill path resolution, exhaustion detection patterns for all supported CLIs, and model discovery in `setup collection`. Track 1008 (per-lane LLM) builds on this foundation.

## Phases
- [ ] Phase 1: Codex CLI invocation + exhaustion detection
- [ ] Phase 2: Amp CLI invocation + exhaustion detection
- [ ] Phase 3: Dynamic skill path resolution (remove hardcoded path)
- [ ] Phase 4: Setup collection — model discovery for Codex + Amp
- [ ] Phase 5: Documentation + workflow.md examples
