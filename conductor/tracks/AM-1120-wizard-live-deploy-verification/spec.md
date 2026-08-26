# Spec: Wizard Real-Deploy Verification (Digger Game, Live Firebase)

## Problem Statement

Track 1119 (App Creator Wizard) implemented and tested — with mocks and integration tests
against a mock collector — the entire chain from wizard Launch to an autonomously deployed,
linked webapp. The one thing it deliberately never did is run that chain for real: this
worker's only available cloud credentials belong to the user's real Google/Firebase account,
which already hosts four live production projects. Deploying an experimental "digger game"
scaffold through that account unattended, with no human reviewing the generated tracks before
they run, is a costly and hard-to-reverse action that requires explicit authorization —
exactly the kind of action `/laneconductor implement` must not decide on its own (see
`conductor/tracks/AM-1119-app-creator-wizard/conversation.md`'s Phase 6 note). The human
decided (2026-08-26) to skip this for now and track it here instead of leaving 1119 open.

## Requirements

- REQ-1 **Disposable target**: identify or provision a Firebase/GCP project that is safe to
  deploy throwaway content to — NOT `laneconductor-site`, `makrodash`, `ocumentor-prod`, or
  `otralingo`.
- REQ-2 **Live wizard run**: launch the App Creator wizard (track 1119) with a real "digger
  game" product description, a real KPI, and a deployment step pointed at the disposable
  target from REQ-1.
- REQ-3 **Unattended pipeline observation**: let the generated Auto-Run tracks execute through
  the full lane workflow (plan → implement → review → quality-gate → done) without manual
  intervention beyond the initial Launch, and record what actually happened for each track.
- REQ-4 **Reachability check**: once the deploy track reports `app_url`, fetch it and confirm
  an HTTP response (200, or a documented reasonable equivalent) — not just that a URL string
  was recorded.

## Acceptance Criteria

- [ ] AC-1: A disposable Firebase/GCP project is confirmed or created, distinct from the four
      named production projects.
- [ ] AC-2 (was track 1119's AC-4): the generated deploy track actually deploys the digger-game
      app and `projects.app_url` is set to a URL that responds when fetched.
- [ ] AC-3 (was track 1119's AC-5, live half): every generated track for this run reaches
      `done`, and `FollowBuildView` (built in 1119 Phase 5) showed the live link once the
      deploy track finished — screenshot or transcript recorded.
- [ ] AC-4 (was track 1119's TC-16): observations — pass or fail, including any track that got
      stuck or needed a retry — are written to this track's `conversation.md`.

## Out of Scope

- Any change to track 1119's own code — this track is verification only. If the live run
  surfaces a real bug in the wizard/deploy pipeline, file it as its own bug track referencing
  both 1119 and 1120 rather than fixing it inline here.
- Automatic provisioning tooling for the disposable project (REQ-1) beyond what `gcloud`/
  `firebase` CLI already offers interactively — this is a one-time human-run setup step, not a
  reusable feature.
