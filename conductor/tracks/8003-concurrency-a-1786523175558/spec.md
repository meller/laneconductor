# Spec: Concurrency A 1786523175558

## Problem Statement
This track is a synthetic fixture created by the Playwright E2E suite
(`conductor/tests/playwright/brainstorm-concurrency.spec.js`) to exercise the
sync worker's per-lane concurrency limit (`parallel_limit: 1` for the `plan`
lane, see `conductor/workflow.json`). It carries no real product
requirement — its only purpose is to occupy the `plan` lane's single
concurrency slot while a second track (`Brainstorm B`) is verified to stay
queued/waiting.

## Requirements
- REQ-1: The track completes its `plan` lane cycle (claim → success)
  without manual intervention, so the worker frees the concurrency slot for
  the next queued track.

## Acceptance Criteria
- [ ] Track transitions from `plan:running` to `plan:success` on its own,
      with no other track able to enter `plan:running` concurrently while
      this one holds the slot.
