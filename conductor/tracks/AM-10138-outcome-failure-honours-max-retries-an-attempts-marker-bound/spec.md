# Spec: outcome:failure honours max_retries (an Attempts marker bounds the loop)

## Problem Statement

From the audit (finding A2, severity medium). The connector never reads `max_retries` or counts attempts: otralingo sets `in-progress.max_retries: 2`, so those numbers are dead data, and the implement guide says "leave Lane Status queue" with no bound, so review fail to implement to review can loop forever. The daemon kept `.retry-count` per lane, reset it on lane change, did not count aborts or misconfig, and applied on_failure only after max_retries (conductor/laneconductor.sync.mjs:6938-6999, commit 8f9d6057).

Scope: an `**Attempts**` marker bumped by `update_track outcome:failure`; reset on lane change; at `max_retries` apply `on_failure`, otherwise stay `queue`; decide what the parity shim RETRY_REQUEUE (10131, D11) becomes; tests on the otralingo legacy fixture. Depends on the transitions follow-up track (defaults, stay and stop).

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
