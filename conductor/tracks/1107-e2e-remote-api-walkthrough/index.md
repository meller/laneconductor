# Track 1107: End-to-end walkthrough — remote app + API

**Lane**: plan
**Lane Status**: success
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Not started — opened 2026-08-12
**Type**: dev
**Summary**: Run the "nothing → a track planned" path with the app and Collector API on a DIFFERENT machine than the worker — remote-api mode with real auth. Fourth sibling of 1104 (UI) / 1105 (skill) / 1106…

## Problem

The three sibling walkthroughs all run UI, API, DB and worker on one
machine — so an entire class of failures is invisible to them by
construction:

- **Auth**: locally `requireAuth` is a pass-through and `AUTH_ENABLED` is
  false. Several endpoints were recently found with *no* auth middleware at
  all, invisible locally (fixed 2026-08-12 in the 1087 Phase 8 commit) —
  and that chat-history endpoint's visibility scoping has never been
  exercised against real Firebase tokens outside unit tests.
- **Worker ↔ API trust**: `machine_token` issuance/rotation, API keys
  (track 1033), `PW_TEST_MODE`'s mock-token path vs. the real one.
- **Machine identity**: with one machine, "the project" and "this
  computer" coincide, so questions like "which machine is this project's
  worker on?" (track 1103 Q3) never even arise. Remote is where they're
  real — and where several dispatch flows have only ever been verified as
  "reasoning + unit tests, not an observed result" (1087 Phase 8's own
  honest caveat says exactly this).
- **Cloud UI code paths**: `CloudAppInner` is dead code locally. Track
  1101 (project selector dead in cloud mode — wrong prop name) survived
  precisely because nothing ever walks the cloud UI.
- **Latency/partition behaviour**: outbound-polling dispatch is *designed*
  to tolerate this (no inbound path to the worker), but designed-for and
  observed are different claims.

## The reference outcome

Same 8 items as the siblings (see [1104](../1104-e2e-ui-walkthrough/index.md))
— **plus remote-specific additions**:

9.  All actions authenticated as a real signed-in user; at least one probe
    confirms an *unauthenticated* request is actually rejected (the gate
    that local mode can never test).
10. A second user cannot see the first user's private worker or read its
    chat history (the 1033/1087 visibility scoping, against real tokens).
11. The UI states which machine the project's worker runs on (feeds 1103
    Q3 — expected to fail today; that's a finding, not a skip).
12. Kill the network between worker and API mid-run: the worker recovers
    on reconnect, and the UI's stale-worker indication is honest while
    it's gone.
13. **First-host onboarding from zero** ([1108](../1108-remote-worker-vm-provisioning/index.md)):
    a fresh user with no registered hosts is detected at login and offered
    the first-host flow (VM creation or guided manual bootstrap) — and can
    reach "one manager worker online" through it without side channels.
    Until 1108 lands, this item is expected to FAIL and is the walkthrough's
    first recorded finding, not a step to skip.

## Environment

Needs a genuinely separate API host. Options, in order of fidelity:
a real second machine / VM; the existing cloud deployment
(`.env.remote`, Firebase auth — see `global-setup.js`'s remote path); or,
minimum viable, API+DB in a container with the worker outside it and
`AUTH_ENABLED=true`. **Localhost with two processes does not count** — the
whole point is crossing a machine boundary with auth on.

## Meta: driven through the remote interfaces themselves

Same dogfooding rule as the siblings: operations on THIS track go through
the remote app UI (and remote-authenticated CLI where applicable). Every
place that's impossible today is a finding.

The wiki guide (Phase 5) is written from the recording of the real run —
including setup of the remote environment itself, which for users is the
hardest part.

## Phases
- [ ] Phase 1: Stand up the remote environment (document every step — this becomes the wiki's deployment section)
- [ ] Phase 2: Walk the reference outcome items 1-8 from the remote app; record divergences from the local runs
- [ ] Phase 3: Auth-specific passes — items 9-10 (negative probes included: unauthenticated and wrong-user requests must fail observably)
- [ ] Phase 4: Partition/latency pass — item 12
- [ ] Phase 5: Wiki guide for remote setup + usage, from the recording
- [ ] Phase 6: Whatever subset is automatable joins the E2E suite (track 1100) as a tagged remote tier — likely reusing `PW_TEST_MODE`/`global-setup.js`'s existing remote-auth scaffolding

## Depends on
**Prerequisite**: [1108](../1108-remote-worker-vm-provisioning/index.md) — the walkthrough begins as a fresh user with zero hosts, which is exactly the state 1108 exists to handle; without it Phase 2 cannot start cleanly from nothing.

[1103](../1103-e2e-onboarding-experience/index.md) (design questions this makes concrete), [1101](../1101-cloud-project-selector-dead/index.md) (first known cloud-only bug — this track verifies its fix), [1033](../1033-track-1033-worker-use-connection/index.md) (auth machinery under test), [1100](../1100-fix-playwright-e2e-suite/index.md) (Phase 6). Siblings: [1104](../1104-e2e-ui-walkthrough/index.md), [1105](../1105-e2e-skill-walkthrough/index.md), [1106](../1106-e2e-cli-walkthrough/index.md).
