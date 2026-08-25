# Track AM-1119: App Creator Wizard Mode (E2E New-Project Wizard)

**Lane**: quality-gate
**Lane Status**: running
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Phase 1 of 6 complete — wizard shell + step components
**Type**: dev
**Track Kind**: feature
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Multi-step App Creator wizard (product, KPIs, design/tech stack, deployment via reused deploy UX) that auto-generates Auto-Run tracks and drives them end-to-end to a deployed Firebase/GCP webapp…

## Problem

Project creation is a single flat form that stops after scaffolding — deployment config, track creation, and auto-run all require separate manual expert steps, and the finished app's location is never surfaced.

## Solution

A five-step wizard (Basics → Product & KPIs → Design & Stack → Deployment → Review & Launch) that dispatches one enriched create-project payload; the manager worker scaffolds, writes deploy.json, generates 3–6 Auto-Run tracks ending in a deploy track, and the system records and displays the live app URL.

## Phases

- [x] Phase 1: Wizard shell + step components
- [ ] Phase 2: Deployment step (reuse deploy UX/domain)
- [ ] Phase 3: Track auto-generation with Auto Run
- [ ] Phase 4: Deploy-to-URL + app_url plumbing
- [ ] Phase 5: "Follow your build" progress view
- [ ] Phase 6: E2E validation — the digger game scenario
**Auto Run**: yes
