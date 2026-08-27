# Track TU-10035: Merge As A Done Lane Action

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Planned
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: TU
**Created By**: test@example.com
**Summary**: Make merging a first-class lane action: quality-gate lands tracks at done:queue, a worker claims and runs a merge skill session (transcript included), done:success means actually shipped. Replaces…

## Problem

`done:success` is declared at quality-gate exit, before code lands on main. Merging is the only pipeline step that bypasses the standard worker→skill path — handled instead by four ad-hoc dispatch handlers and two bespoke button surfaces, with no transcript, inconsistent result reporting, and five independent bugs found live on 2026-08-26/27.

## Solution

The done lane gets a standard lane action ("merge") claimed and run exactly like plan/implement/review/quality-gate: `quality-gate:success → done:queue`, worker claims it (Auto Run or ▶), a merge skill session runs in the primary checkout with a live transcript, direct mode merges (resolving conflicts in-session), pr mode opens a PR and waits at `done:waiting` with the GitHub link as the completion affordance. `done:success` comes to mean actually shipped.

## Phases

- [ ] Phase 1: Workflow semantics + skill command
- [ ] Phase 2: Worker claims and runs the merge action
- [ ] Phase 3: PR waiting + reconciler loop
- [ ] Phase 4: UI consolidation
- [ ] Phase 5: Deletions, migration, creation-time flags
- [ ] Phase 6: E2E validation
