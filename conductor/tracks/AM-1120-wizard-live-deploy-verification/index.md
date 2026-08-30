# Track AM-1120: Wizard Real-Deploy Verification (Digger Game, Live Firebase)

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Track Kind**: feature
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Auto Run**: no
**Summary**: Spun out of track 1119 (App Creator Wizard) — the one remaining unverified piece: a human-supervised real run of the wizard against a disposable Firebase/GCP project (the "digger game" scenario),…

## Problem

Track 1119 built and unit/integration-tested the full wizard → auto-generated tracks →
autonomous deploy → `app_url` pipeline, but never exercised it against real Firebase/GCP
credentials: this machine's only available credentials are tied to real production projects
(`laneconductor-site`, `makrodash`, `ocumentor-prod`, `otralingo`), so an autonomous
`/laneconductor implement` run on 1119 correctly declined to deploy against them without a
human's go-ahead (see `conductor/tracks/AM-1119-app-creator-wizard/conversation.md`). The
human's decision on 2026-08-26 was: skip it for now on 1119, track it separately so it
doesn't block closing that track out.

## Solution

A human-supervised run: pick or provision a disposable Firebase/GCP project (explicitly NOT
one of the four live production projects above), launch the App Creator wizard with a real
"digger game" description, let the generated Auto-Run tracks execute through
plan→implement→review→quality-gate→done, and record the observed outcome — did every
generated track reach `done`, and does `curl $app_url` return HTTP 200 — in this track's
`conversation.md`. This satisfies track 1119's originally-deferred TC-16 / AC-4 / AC-5.

## Phases

- [ ] Phase 1: Confirm/provision a disposable Firebase or GCP project safe to deploy to (not laneconductor-site/makrodash/ocumentor-prod/otralingo)
- [ ] Phase 2: Run the wizard end-to-end with a "digger game" description against that project; observe generated tracks run to done
- [ ] Phase 3: Verify the recorded app_url is reachable (HTTP 200) and record findings
