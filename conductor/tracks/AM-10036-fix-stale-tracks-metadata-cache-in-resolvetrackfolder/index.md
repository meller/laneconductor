# Track AM-10036: Fix stale tracks-metadata cache in resolveTrackFolder

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: resolveTrackFolder()'s tracksMetadata is loaded once per worker process and never invalidated. A long-lived worker whose cache predates a track's creation permanently can't resolve that track's folder. Traced to three real incidents on track 10035 (2026-08-27): a duplicate scaffold folder during implement, a wrong PR-vs-direct decision at quality-gate exit, and a stuck ai-resolve-conflict session. Fix: watch conductor/tracks-metadata.json and reload on change, mirroring the existing workflow.json pattern.

## Problem

Follow-up from TU-10035 (merged 2026-08-27, commit 393fa1b): the root cause behind three separate live incidents on that track was never actually fixed — only worked around by hand each time.

## Solution

Add a chokidar watch on `conductor/tracks-metadata.json` that reloads the in-memory `tracksMetadata` cache on change, mirroring the exact pattern `workflow.json` already uses.

## Phases

- [ ] Phase 1: Add the file watch + reload, with a regression test
