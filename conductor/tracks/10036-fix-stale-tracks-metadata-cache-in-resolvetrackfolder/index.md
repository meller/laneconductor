# Track AM-10036: Fix stale tracks-metadata cache in resolveTrackFolder

**Lane**: implement
**Lane Status**: running
**Progress**: 0%
**Phase**: Planned — Phase 1 ready to implement
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: resolveTrackFolder()'s tracksMetadata is loaded once per worker process and never invalidated. A long-lived worker whose cache predates a track's creation permanently can't resolve that track's…

## Problem

Follow-up from TU-10035 (merged 2026-08-27, commit 393fa1b): the root cause behind three separate live incidents on that track was never actually fixed — only worked around by hand each time.

## Solution

Add a chokidar watch on `conductor/tracks-metadata.json` that reloads the in-memory `tracksMetadata` cache on change, mirroring the pattern `workflow.json` already uses — hardening the loader and the writer first, since a watch turns the loader's silent empty-default-on-parse-failure into an active cache-wiping hazard.

Planning correction: a reload *does* already exist (`laneconductor.sync.mjs:7437`), but it sits inside the API-mode branch of the auto-launch interval behind four gates — `syncOnly`, at-capacity, `local-fs`, and `pullWorkflow()` failure — any of which strands the cache indefinitely. See spec.md's Root Cause.

## Phases

- [ ] Phase 1: Make the reload safe (strict loader + atomic save), then make it event-driven (the watch), with real-worker regression tests
