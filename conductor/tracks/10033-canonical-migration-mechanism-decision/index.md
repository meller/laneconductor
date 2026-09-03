# Track 10033: Decide the canonical migration mechanism

**Lane**: backlog
**Lane Status**: running
**Progress**: 0%
**Type**: dev
**Summary**: Track 1102's F22 investigation (Phase 16, 2026-08-25) found this repo runs two parallel, undocumented migration mechanisms — the `migrations/` + Atlas `atlas_schema_revisions` ledger, and a separate…

## Problem
Two migration mechanisms exist with no documented rule for which one is authoritative, or how they're kept from drifting apart. This has already caused a real production incident (F10c's fix sitting inert on the live DB for 5 days) and is very likely to recur for the next migration authored on a branch that lives more than a few days.

## Solution
Pick one mechanism as canonical (most likely Atlas, given its ledger and checksum discipline), document the decision, and either deprecate/migrate away from the other or explicitly document the split responsibility if both are staying. Whatever is decided, add something to the workflow (a pre-apply check, CI gate, or SKILL guidance) that would have caught at least the un-ledgered direct-apply gap without a human tracing it by hand.

## Phases
- [ ] Phase 1: Audit exactly what each mechanism currently owns (`migrations/` vs `ui/server/migrations/`) and why both exist
- [ ] Phase 2: Decide and document the canonical mechanism
- [ ] Phase 3: Add a guard (CI check, SKILL guidance, or pre-apply script) against the three F22 failure modes recurring silently

## Depends on
- [1102](../1102-e2e-session-findings/index.md) — F22 / Phase 16, the investigation that found this gap
