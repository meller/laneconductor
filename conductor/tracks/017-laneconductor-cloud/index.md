# Track 017: Cloud Mode

**Lane**: done
**Lane Status**: success
**Progress**: 86%
**Quality Gate**: ⚠️ FAILED — Test coverage 50.4% (required: ≥80%) — Re-checked 2026-02-27 12:40 UTC — See conversation.md

## Problem
LaneConductor is local-only. Developers want remote visibility and team collaboration without
managing their own Postgres. Currently there is no way to switch between local and remote DB,
and the skill has no migration tooling.

## Solution
Add cloud mode to this repo: collector pattern decouples the worker from DB credentials.
Worker POSTs to collector HTTP endpoints; collectors write to Postgres (local or cloud).
Cloud path = paste a LC cloud URL + token — zero worker code changes needed.

Key architectural decisions:
- **Collector pattern** — worker is pure file watcher + HTTP poster, zero DB knowledge
- **Filesystem is source of truth** — track files re-sync trivially to any DB
- **Comments are DB-only** — need export/import via `/laneconductor syncdb` on DB switch
- **GitHub OAuth** — workspace = GitHub org, members synced automatically

## Phases
- [x] Phase 1: Dual Sync (direct DB in worker) — superseded by collector pattern
- [x] Phase 2: Local Collector + Worker Refactor (Task 6: SKILL.md update pending)
- [x] Phase 3: LC Cloud Collector — Firebase Functions
- [x] Phase 4: Cloud UI Reader + Dashboard
- [ ] Phase 5: Billing — Stripe
- [ ] Phase 6: `/laneconductor syncdb` Command
