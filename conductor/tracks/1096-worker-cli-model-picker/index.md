# Track 1096: Choose/change a worker's CLI + model from the UI

**Lane**: plan
**Lane Status**: success
**Progress**: 80%
**Last Run**: claude/claude-opus-5 (primary)
**Phase**: Plan re-verified against the shipped code — three spec-vs-code mismatches found; Phase 7 opened for the one that needs code (Start-worker launch picker)
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
- [ ] Phase 4: Integration Testing & Verification — automated tests green
      (8/8, re-run 2026-08-24), but Task 4.2 (browser E2E) has **never been
      performed**. Previously marked `[x]` here while `plan.md` had it
      unchecked; `plan.md` was right.
- [x] Phase 5: UX Fixes (post-implementation)
- [x] Phase 6: Provider vs. model — session continuity constraint
- [ ] Phase 7: Gaps found by verifying the spec against the code —
      7.1/7.2 (doc corrections) done this pass; **7.3 needs code** (the
      "Start Sync Worker" launch path still has no CLI/model picker, so
      spec §3.3 is half built) and 7.4 needs a heartbeat test.

## Depends on

Possibly related to [1089](../1089-remote-worker-provisioning/index.md)
(activating a worker on a remote machine from the app) and
[1091](../1091-manager-worker-and-new-project-flow/index.md) (new-worker
creation flow) — worth checking during planning whether this should be a
shared step in both rather than fully separate.
**Waiting for reply**: yes
