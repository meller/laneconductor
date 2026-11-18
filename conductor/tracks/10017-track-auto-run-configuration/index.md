# Track 10017: track auto run configuration

**Lane**: backlog
**Lane Status**: queue
**Phase**: Parked in the backlog on 2026-11-18: belongs to the worker tier (experimental, currently unmaintained), not the plugins.
**Status**: plan
**Progress**: 100%

## Problem
lets have a configuration per track (both FS and DB) if they could be picked by workers that are not sync only - default no (backward compatibily for workers - if no indicator - dont pick it up)

## Solution
To be defined.

## Phases
- [ ] Phase 1: Implementation
**Summary**: All 7 phases implemented, tested with real DB/worker/browser verification (see conversation.md) — grep for "auto_run" now returns real matches across sync.mjs, claim-scope.mjs, index.mjs, and…
**Waiting for reply**: no
**PR Number**: 2
**PR URL**: https://github.com/meller/laneconductor/pull/2
**PR Status**: merged
