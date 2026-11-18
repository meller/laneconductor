# Spec: Workflow transitions follow-up: defaults, stay and stop, Verdict, clear parking markers on outcome

## Problem Statement

Follow-up to track 10131 (merged 2026-11-18), from the audit (findings A1, A3, C5). The shared resolver ignores `defaults.on_success` and `defaults.on_failure`, and `stay`/`stop` are only kept for the daemon through a shim (parity differences D7 to D9 of 10131). `outcome` does not write or clear `**Verdict**`, and the bundled lane guides served to projects with no skill folder (connector/guides/review.md, quality-gate.md) omit the clear-at-claim line; `update_track` accepts any Verdict string although the daemon only accepted pass or fail.

Scope: decide and implement `defaults.*` fallback and `stay`/`stop` in the shared resolver (with table tests on the otralingo legacy fixture); `outcome` writes Verdict where the lane produces one and clears Waiting Reason and Waiting On Tracks on resume; validate Verdict; add the clear-at-claim line to the bundled guides. Keep the context-size budget test (KC-8) passing; it is nearly at its limit.

## The need

(To be filled in.)

## Who it is for

(To be filled in.)

## Wanted outcome

(To be filled in.)

## Acceptance criteria

(To be filled in.)

## Out of scope

(To be filled in.)
