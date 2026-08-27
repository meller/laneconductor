# Track AM-1119: App Creator Wizard Mode (E2E New-Project Wizard)

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Phase 6 complete — Task 3 (real digger-game deploy) spun out to track 1120 per human decision
**Type**: dev
**Track Kind**: feature
**Waiting for reply**: no
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Multi-step App Creator wizard (product, KPIs, design/tech stack, deployment via reused deploy UX) that auto-generates Auto-Run tracks and drives them end-to-end to a deployed Firebase/GCP webapp with a live app link and a "follow your build" progress view.

## Problem

Project creation is a single flat form that stops after scaffolding — deployment config, track creation, and auto-run all require separate manual expert steps, and the finished app's location is never surfaced.

## Solution

A five-step wizard (Basics → Product & KPIs → Design & Stack → Deployment → Review & Launch) that dispatches one enriched create-project payload; the manager worker scaffolds, writes deploy.json, generates 3–6 Auto-Run tracks ending in a deploy track, and the system records and displays the live app URL.

## Phases

- [x] Phase 1: Wizard shell + step components
- [x] Phase 2: Deployment step (reuse deploy UX/domain)
- [x] Phase 3: Track auto-generation with Auto Run
- [x] Phase 4: Deploy-to-URL + app_url plumbing
- [x] Phase 5: "Follow your build" progress view
- [x] Phase 6: E2E validation — the digger game scenario (Task 3 spun out to track 1120)
**PR Number**: 17
**PR URL**: https://github.com/meller/laneconductor/pull/17
**PR Status**: open
