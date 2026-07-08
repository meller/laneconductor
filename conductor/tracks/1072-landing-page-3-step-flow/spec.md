# Spec: Landing Page — Updated 3-Step Setup Flow

## Problem Statement
The landing page onboarding flow has two issues:
1. `landing/index.html` previously showed `lc install && lc setup` — `lc install` is a no-op (already fixed in track 1071, needs deploy)
2. `https://www.laneconductor.com/welcome` serves `index.html` via catch-all — no dedicated welcome page exists

## Requirements
- REQ-1: `/welcome` should be a focused onboarding page (no marketing noise), showing only the 3-step flow
- REQ-2: `landing/index.html` quick-start section must reflect the corrected steps (already updated in code, needs deploy)
- REQ-3: The 3-step flow must be consistent across index.html, welcome.html, and wiki.html
- REQ-4: Step scope labels must be clear (per machine vs per project vs per session)

## Correct 3-Step Flow
```
01 — INSTALL  (once per machine)
  Clone the repo and run make install to register the lc CLI globally.
  make install

02 — SETUP  (once per project)
  In your project repo, initialize LaneConductor.
  lc setup

03 — START  (each session)
  Start the shared dashboard, then the project worker.
  lc ui start    ← shared Kanban dashboard (once per machine)
  lc start       ← project worker (once per session)
```

## Acceptance Criteria
- [ ] `landing/welcome.html` exists with focused 3-step onboarding content
- [ ] `firebase.json` routes `/welcome` → `/welcome.html` before the catch-all
- [ ] `landing/index.html` quick-start section matches the 3-step flow (already in code)
- [ ] Deployed to production via `lc deploy prod`
