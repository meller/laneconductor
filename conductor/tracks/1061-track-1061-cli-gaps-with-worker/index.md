# Track 1061: Track 1061: CLI gaps with worker

**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Phase**: Complete — verified and reviewed
**Summary**: --run flag implemented in lc CLI — foreground agent execution with status tracking
**Waiting for reply**: no

## Problem
The `lc` CLI only marks tracks for the background worker, which is inconvenient for non-Claude LLMs or users who prefer direct CLI interaction.

## Solution
Added `--run` / `-r` flag directly in `lc.mjs` — reads primary CLI config, spawns AI agent in foreground with `stdio: inherit`, updates `**Lane Status**` to running/success/failure.

## Phases
- [x] Phase 1: Planning & Research
- [x] Phase 2: Implementation Decision (pragmatic approach — no agent-runtime.mjs extraction)
- [x] Phase 3: Implement --run Flag
- [x] Phase 4: Verification (manual) — PASSED CODE REVIEW
