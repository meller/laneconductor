# Track AM-10140: update_track: Lane is an implicit precondition for Lane Status, leaving done needs reopen

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Reviewed by a read-only reviewer (pass), gated on main with the plugins 1.2.2 release (516 connector tests, strict validate on all three plugins), shipped 2026-11-18.
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings B3, B4, severity medium). The compare-and-swap in connector/src/tools/update-track.mjs:69-80 only checks the markers the call sets. A `Lane Status`-only write does not compare `Lane`, so a stale `success` can land on a lane a human has just moved the track to; and nothing stops a valid-base write out of `done`. The daemon had a lane regression guard (rank, `done` terminal, unknown lanes fail closed: services/lane-regression-guard.mjs:75-150). No test covers either case.

Scope: make `Lane` an implicit precondition whenever `Lane Status` is set; refuse leaving `done` unless `reopen: true`; two tests (stale Lane Status after a human move; done to plan without reopen); keep the lane-guide advice "a human's manual move wins" consistent. Also return the current `base` in CONFLICT details so callers stop retrying blindly with the same base (audit D6: 8 of otralingo's 9 conflicts came within 450 ms).
**Summary**: From the audit (findings B3, B4, severity medium). The compare-and-swap in connector/src/tools/update-track.mjs:69-80 only checks the markers the call sets. A `Lane Status`-only write does not compare
**Part Of**: 10145
**Verdict**: pass
