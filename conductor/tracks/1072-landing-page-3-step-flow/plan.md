# Plan: Track 1072 — Landing Page 3-Step Setup Flow

## Phase 1: Create landing/welcome.html

**Problem**: `/welcome` has no dedicated page — currently serves `index.html` via the `**` catch-all rewrite, which dumps a full marketing page on new users expecting a focused onboarding flow.
**Solution**: Create a standalone `welcome.html` and add a specific Firebase rewrite for `/welcome` before the catch-all.

- [ ] Task 1: Create `landing/welcome.html` — focused onboarding page, dark theme matching index.html tokens
  - Use same CSS design tokens as `index.html` (`:root` vars: `--bg`, `--text`, `--blue`, `--cyan`, `--font-mono`, etc.)
  - Header: LaneConductor logo text + "Get Started" subtitle
  - Two-path layout matching the "How it works" section in index.html:
    - **Standard (CLI + Dashboard)** — 3 steps with scope labels
    - **AI-Native (Skill Only)** — 3 steps
  - Standard path steps:
    ```
    01 — INSTALL   (once per machine)
      make install
    02 — SETUP     (once per project)
      lc setup
    03 — START     (each session)
      lc ui start   ← shared Kanban dashboard
      lc start      ← project worker
    ```
  - AI-Native path steps (same as index.html AI-Native section)
  - Footer links: "Full docs →" (wiki.html), "GitHub →" (repo URL), "laneconductor.com →"
  - No nav bar, no hero section, no features — just the onboarding steps

- [ ] Task 2: Add Firebase rewrite in `firebase.json` for the `landing` target
  - Insert before the `**` catch-all:
    ```json
    { "source": "/welcome", "destination": "/welcome.html" }
    ```
  - This ensures `/welcome` serves `welcome.html` instead of falling through to `index.html`

## Phase 2: Verify index.html and deploy

**Problem**: Changes from Track 1071 are committed locally but not yet deployed to laneconductor.com.
**Solution**: Confirm index.html is correct (already verified — 3-step flow matches spec), then deploy.

- [ ] Task 1: Confirm `landing/index.html` quick-start section ✅ (already verified: make install → lc setup → lc ui start && lc start)
- [ ] Task 2: Run `lc deploy prod` to push landing changes to production
  - Deploy command: `bash scripts/deploy.sh prod` → `firebase deploy --only hosting:landing`
  - Deploys: `landing/index.html`, `landing/welcome.html`, `landing/wiki.html`, updated `firebase.json`
  - Verify post-deploy: https://www.laneconductor.com/welcome should show focused onboarding
