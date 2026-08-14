# Track 10011: new worker providers support

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/sonnet (primary)
**Phase**: Implementation complete — all 5 phases
**Type**: dev
**Summary**: Added conductor/providers.mjs as the canonical provider registry and wired every consumer (CLI wizard, sync worker, Collector API, 5 React components) to it — fixes both reported bugs (gemini showing a claude model string; new-worker flow offering no provider choice) and closes the same class of bug across copilot/antigravity everywhere else.
