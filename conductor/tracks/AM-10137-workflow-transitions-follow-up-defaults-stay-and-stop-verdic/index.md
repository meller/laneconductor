# Track AM-10137: Workflow transitions follow-up: defaults, stay and stop, Verdict, clear parking markers on outcome

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Reviewed by a read-only reviewer (pass), gated on main with the plugins 1.2.2 release (516 connector tests, strict validate on all three plugins), shipped 2026-11-18.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Follow-up to track 10131 (merged 2026-11-18), from the audit (findings A1, A3, C5). The shared resolver ignores `defaults.on_success` and `defaults.on_failure`, and `stay`/`stop` are only kept for the daemon through a shim (parity differences D7 to D9 of 10131). `outcome` does not write or clear `**Verdict**`, and the bundled lane guides served to projects with no skill folder (connector/guides/review.md, quality-gate.md) omit the clear-at-claim line; `update_track` accepts any Verdict string although the daemon only accepted pass or fail.

Scope: decide and implement `defaults.*` fallback and `stay`/`stop` in the shared resolver (with table tests on the otralingo legacy fixture); `outcome` writes Verdict where the lane produces one and clears Waiting Reason and Waiting On Tracks on resume; validate Verdict; add the clear-at-claim line to the bundled guides. Keep the context-size budget test (KC-8) passing; it is nearly at its limit.
**Summary**: Follow-up to track 10131 (merged 2026-11-18), from the audit (findings A1, A3, C5). The shared resolver ignores `defaults.on_success` and `defaults.on_failure`, and `stay`/`stop` are only kept for the
**Part Of**: 10145
**Verdict**: pass
