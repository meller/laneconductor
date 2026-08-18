# Track 1096: Choose/change a worker's CLI + model from the UI

**Lane**: plan
**Lane Status**: success
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Plan refined — spec.md updated with Phase 6 provider-switch confirmation requirement; ready for implement
**Type**: dev
**Summary**: No UI exists to choose a worker's CLI/model when starting one, or to change an existing worker's model assignment afterward — today it's CLI-only, via .laneconductor.json's primary/secondary config…

## Problem

Raised while reviewing track 1091 (Manager Worker Type & New-Project Flow)
— out of scope there, since 1091 is specifically about the manager worker
type and new-project flow, not general worker configuration; applies to
every worker, not just manager workers.

Today, a worker's CLI (`claude`/`antigravity`/etc.) and model come from
`.laneconductor.json`'s `project.primary`/`project.secondary` config,
set only via `lc setup`'s CLI wizard or by hand-editing the file. There's
no UI path to:
1. Choose which CLI/model a *new* worker should use when starting one
   from the app.
2. Change an *existing* worker's model assignment afterward, without
   editing `.laneconductor.json` directly and restarting the worker.

## Plan Checklist

Full phase-by-phase task detail lives in `plan.md` (source of truth —
keep this summary in sync with it, don't duplicate task text here).

- [x] Phase 1: Database Migration & API Server Support
- [x] Phase 2: Worker Daemon Sync Engine
- [x] Phase 3: UI Components & Model Picker Modal
- [x] Phase 4: Integration Testing & Verification — all automated tests
      pass; Task 4.2 (browser E2E) remains **partial**, see plan.md.
- [x] Phase 5: UX Fixes (post-implementation)
- [x] Phase 6: Provider vs. model — session continuity constraint

## Depends on

Possibly related to [1089](../1089-remote-worker-provisioning/index.md)
(activating a worker on a remote machine from the app) and
[1091](../1091-manager-worker-and-new-project-flow/index.md) (new-worker
creation flow) — worth checking during planning whether this should be a
shared step in both rather than fully separate.
