# Track 10034: Auto-run demo (throwaway)

**Status**: plan
**Progress**: 0%

## Problem
The `**Auto Run**` gate and the sync+poll auto-claim loop are unit-tested but have never been watched working together live on a real project. Mocks can't show a card moving on its own.

## Solution
Run one live, evidence-recorded auto-claim cycle on this track (plus a negative control proving the gate gates), write down whatever the live run surfaces that mocks don't, then discard the track. No product code is written.

## Phases
- [ ] Phase 1: Establish the observation setup
- [ ] Phase 2: Demonstrate the positive case (autonomous claim)
- [ ] Phase 3: Demonstrate the gate (negative control)
- [ ] Phase 4: Write up findings
- [ ] Phase 5: Teardown (human-confirmed — hard delete)
**Lane**: plan
**Lane Status**: success
**Type**: dev
**Track Kind**: feature
**Summary**: Demo/verification track — exercises the existing auto_run gate end to end against a live sync+poll worker. No product code to be written; deliverable is recorded evidence. Safe to discard after.
**Auto Run**: yes
