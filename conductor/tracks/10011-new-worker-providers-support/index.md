# Track 10011: new worker providers support

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned
**Type**: dev
**Summary**: Root cause: no canonical provider registry — 9 independently hardcoded provider/model lists (CLI wizard, sync worker, server, 5 UI components) plus an agy/antigravity id mismatch. Plan adds conductor/providers.mjs as single source of truth, fixes WorkersList' hardcoded claude-model fallback, and adds real provider choice to the track panel's "+ New worker" flow.
