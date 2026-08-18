
## Track Creation Requests


## Completed Queue

### Track 1117: Fix unscoped worker-startup reset + backwards orphan-reconcile guard
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T18:50:00.000Z
**Title**: Fix unscoped worker-startup reset + backwards orphan-reconcile guard
**Description**: Two compounding sync-engine bugs found live during track 1116's dogfood run: (1) resetStuckActions(immediate=true) fires on every worker startup and resets ALL running/queued tracks project-wide with no ownership/liveness check, incorrectly marking live tracks as stuck_timeout; (2) orphan-reconcile's artifact-copy guard treats a worktree lane that has legitimately advanced past the dispatched action (i.e. a successful run) as a mismatch and skips copying, permanently stranding correct newer state. Together these silently orphaned a fully-successful 1116 implement run for its entire ~45min duration with no automatic recovery. Root-caused to exact file/line locations; plan only for now.
**Processed**: 2026-08-18T18:48:37.699Z

### Track 1116: Per-lane provider + live-model picker in Workflow Settings
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T11:50:00.000Z
**Title**: Per-lane provider + live-model picker in Workflow Settings
**Description**: Add provider + live-discovered model selection to the Workflow Settings Visual Editor's per-lane config, replacing the static claude-only model list with the same worker-reported available_models WorkerModelModal.jsx already uses, defaulting to Claude / Sonnet 5. Depends on 1111 (per-lane primary_model field/precedence, must merge first) and 1099 (dynamic worker model discovery, source of available_models). Plan only — do not implement yet.
**Processed**: 2026-08-18T09:51:18.859Z

### Track 10019: Track 10013 Phase 5 live-verify scratch
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T09:37:27.148Z
**Title**: Track 10013 Phase 5 live-verify scratch
**Description**: disposable — verifying human-lane-override guard live
**Processed**: 2026-08-18T09:37:28.097Z
