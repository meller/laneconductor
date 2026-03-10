# Track 010: Auto-Implement on Start

**Lane**: backlog
**Lane Status**: success
**Progress**: 100%

## Problem
Moving a track to in-progress on the board is a manual gesture that currently does nothing beyond changing the lane. You then have to open a terminal and run `/laneconductor implement NNN` manually. The board should be self-driving — drag a card to in-progress and Claude starts working on it automatically.

## Solution
The heartbeat worker polls for tracks that have just transitioned to `in-progress` with `0%` progress (fresh start only — not resume). When detected, it fires `claude -p "/laneconductor implement NNN"` in a background process, records that the run was launched, and prevents duplicate launches. Re-running requires explicit user action.

## Phases
- [ ] Phase 1: Transition detection in heartbeat worker
- [ ] Phase 2: Auto-launch with duplicate prevention
- [ ] Phase 3: UI indicator + manual re-run trigger
