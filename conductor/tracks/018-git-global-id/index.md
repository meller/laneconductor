# Track 018: git_global_id Schema + Population

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
LaneConductor identifies projects by `repo_path` (absolute local path), which breaks when the
same repository is cloned on a different machine. The cloud collector needs a stable,
cross-machine project identity.

## Solution
Derive a deterministic `git_global_id` (UUID v5) from the git remote URL and store it in
the `projects` table. Populate it at `setup collection` time and lazily on first cloud sync.
This becomes the routing key for the Phase 3 LC Cloud Collector.

## Phases
- [x] Phase 1: DB migration — add `git_global_id UUID` column to `projects`
- [x] Phase 2: Populate existing row for the laneconductor project
- [x] Phase 3: Wire into `setup collection` (auto-populate on project UPSERT)
- [x] Phase 4: Expose via collector API + update SKILL.md
