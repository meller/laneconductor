## Track Creation Requests


### Track 1068: Marketing & Sales (Biz Dev) Track Support
**Status**: processed
**Type**: track-create
**Created**: 2026-05-06T00:00:00.000Z
**Title**: Marketing & Sales (Biz Dev) Track Support
**Description**: Extend LaneConductor to support non-dev track types (marketing, sales, support) with KPI definitions, auto-research measurement, closed-loop experiment workflow, and skill recommendations.
**Metadata**: { "priority": "high", "assignee": null }

## Completed Queue

### Track 1077: Migrate Gemini CLI support to Antigravity
**Status**: processed
**Type**: track-create
**Created**: 2026-07-12T09:45:00.000Z
**Title**: Migrate Gemini CLI support to Antigravity
**Description**: Google retired the standalone Gemini CLI in favor of Antigravity. Update LaneConductor's agent config (lc setup's CLI selection wizard, bin/lc.mjs's reachability/model-discovery checks, track 1013's multi-CLI agent support) to detect and drive Antigravity instead of `gemini`/`npx @google/gemini-cli`. Complements track 1073 (which made LaneConductor discoverable *by* Antigravity as a workspace skill) — this is LaneConductor driving Antigravity as an agent CLI.
**Processed**: 2026-07-12T09:48:56.805Z

### Track 1076: Fix `/track` POST timeout + unverified queue "processed" marking
**Status**: processed
**Type**: track-create
**Created**: 2026-07-10T14:30:00.000Z
**Title**: Fix `/track` POST timeout + unverified queue "processed" marking
**Description**: Every POST /track times out at 15s during a full project reconcile (confirmed not a Postgres lock via pg_stat_activity — the slowness is in ui/server/index.mjs's handler). Separately, file_sync_queue.md marks track-create entries "processed" without verifying the POST actually succeeded, silently dropping them when the collector is down/slow — this is exactly what happened to Tracks 1074/1075 during this session. Also consider making the worker's reconcile pass incremental instead of touching every track on every restart.
**Processed**: 2026-07-10T15:02:17.077Z

### Track 1074: Fix `lc worker restart` missing canonical sync-script fallback
**Status**: processed
**Type**: track-create
**Created**: 2026-07-09T18:30:00.000Z
**Title**: Fix `lc worker restart` missing canonical sync-script fallback
**Description**: bin/lc.mjs's restart command hardcodes the per-project sync-script path with no fallback to the canonical installed copy (unlike start), so it kills the running worker and then crashes for any project without a local conductor/laneconductor.sync.mjs copy. Extract a shared resolveSyncScript() helper used by both start and restart, and reorder restart to validate the script exists before killing the old worker.
**Processed**: 2026-07-10T14:27:17.405Z

### Track 1075: Structured Pino logging for the worker + UI/API
**Status**: processed
**Type**: track-create
**Created**: 2026-07-09T18:30:00.000Z
**Title**: Structured Pino logging for the worker + UI/API
**Description**: Port coachai's Track 070 pattern (Pino + Pinorama) to LaneConductor's own worker (laneconductor.sync.mjs) and API (ui/server/index.mjs), via a standalone pinorama --server instance + pinorama-transport (not the pipe pattern, since both are detached background daemons) on its own port/storage path to avoid colliding with any managed project's own Pinorama.
**Processed**: 2026-07-10T14:27:16.510Z

### Track 1073: Support Antigravity Extension
**Status**: processed
**Type**: track-create
**Created**: 2026-07-02T16:52:00.000Z
**Title**: Support Antigravity Extension
**Description**: Update lc setup and /laneconductor setup (in SKILL.md) to automatically symlink the LaneConductor skill to .agents/skills/laneconductor and rule to .agents/rules/laneconductor.md so that Google Antigravity can discover it as a custom workspace skill and rule.
**Processed**: 2026-07-02T14:52:10.653Z

### Track 1072: Landing Page — Updated 3-Step Setup Flow
**Status**: processed
**Type**: track-create
**Created**: 2026-05-20T00:00:00.000Z
**Title**: Landing Page — Updated 3-Step Setup Flow
**Description**: Create landing/welcome.html as a dedicated /welcome onboarding page; add Firebase rewrite; deploy corrected 3-step flow (make install → lc setup → lc ui start + lc start) to prod.
**Processed**: 2026-05-20T12:45:52.042Z

### Track 1071: CLI Help — Scoped Sections
**Status**: processed
**Type**: track-create
**Created**: 2026-05-20T00:00:00.000Z
**Title**: CLI Help — Scoped Sections
**Description**: Reorganize `lc --help` output into scoped sections (Infrastructure, Project Setup, Worker, Track Management, Configuration, Deployment) so users know which commands run on the installation vs per-project.
**Processed**: 2026-05-20T11:57:34.567Z

### Track 1069: LinkedIn Launch Post
**Status**: processed
**Type**: track-create
**Created**: 2026-05-07T11:00:00.000Z
**Title**: LinkedIn Launch Post
**Description**: Personal LinkedIn post for LaneConductor launch — founder story angle, Karpathy autoresearch hook, whole-business AI orchestration scope
**Processed**: 2026-05-07T09:12:07.680Z

### Track 10002: E2E Test 1776105188197
**Status**: processed
**Type**: track-create
**Created**: 2026-04-13T18:33:10.592Z
**Title**: E2E Test 1776105188197
**Description**: Automated Playwright e2e — verifies new track flows to worker and back
**Processed**: 2026-04-13T18:33:15.081Z


