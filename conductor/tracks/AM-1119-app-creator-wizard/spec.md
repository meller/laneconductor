# Spec: App Creator Wizard Mode (E2E New-Project Wizard)

## Problem Statement

Creating a project in LaneConductor today is a single small form (`NewProjectModal.jsx`)
that collects name, repo source, purpose, tech stack, and KPIs into one
`scaffold_context` blob and dispatches `create-project` to a manager worker. That
scaffolds conductor files — and then stops. The user must separately configure
deployment (`lc setup-deploy`, CLI-only), create tracks by hand, mark them
`**Auto Run**: yes`, and watch the board with no guidance on what happens next or
where their finished app lives.

Competitors in the "full app creator" market (Lovable, Bolt, v0, Replit) take a
product description and return a deployed, linkable webapp. LaneConductor has every
building block — manager workers, track auto-run, lane automation, deploy pipeline —
but no single flow that connects them.

**Target experience**: the user opens the wizard, describes "the digger game", fills
in KPIs/design/stack/deployment once, clicks Launch — and LaneConductor plans tracks,
runs them through the full lane workflow autonomously, deploys to Firebase/GCP, and
shows a "Your app is live" link, with a progress view that explains what's happening
at each stage.

## Requirements

- REQ-1 **Multi-step wizard UX**: Replace the single-form New Project modal with a
  stepper wizard: (1) Basics (name, repo source, manager worker), (2) Product
  (description, target users, KPIs), (3) Design & Tech Stack (visual style prompt,
  stack presets or free text), (4) Deployment (provider + credentials status —
  Firebase/GCP first), (5) Review & Launch. Each step is a reusable component;
  the existing quick single-form path remains available ("Quick create" toggle)
  so current users are not forced through five steps.
- REQ-2 **Reusable deployment step**: The deployment step reuses the existing
  deployment domain logic rather than duplicating it — it produces the same
  artifacts `lc setup-deploy` produces (`conductor/deploy.json`,
  `conductor/deployment-stack.md`, `.env.example`) via the scaffold dispatch, and
  shows credential status (verified / NOT CONFIGURED) the way `DeployPanel`
  (CICDView.jsx) consumes them. Component extraction must leave `DeployPanel`
  working unchanged.
- REQ-3 **Track auto-generation**: On Launch, the manager worker's create-project
  flow additionally generates an initial track breakdown from the wizard input
  (e.g. scaffold → core gameplay/feature tracks → deploy track), registered
  through the existing `file_sync_queue.md` mechanism, each with
  `**Auto Run**: yes` and correct `**Author**`/`**Created By**` markers, so a
  sync+poll worker picks them up without human dragging.
- REQ-4 **Autonomous run to deployment**: The generated final track deploys the app
  using the configured `deploy.json` (Firebase Hosting / GCP first). On success it
  records the live URL. A new `app_url` field on the project (DB + API) stores it.
- REQ-5 **"Follow your build" UX**: After Launch, the wizard hands off to a progress
  view that (a) explains the lane workflow in plain language for newcomers,
  (b) shows live per-track progress, and (c) prominently surfaces the final app
  URL when the deploy track completes. The project card also shows a "Live" link
  once `app_url` is set.
- REQ-6 **Failure visibility**: If any auto-run track fails/blocks, the progress
  view shows it in "Needs your input" terms (reusing Inbox classification), never
  silently stalls.
- REQ-7 The wizard works in the current local-api mode; cloud mode may hide
  machine-specific fields (same pattern as `CLOUD_MODE` in NewProjectModal).

## Acceptance Criteria

- [x] AC-1: A user can open New Project, switch to Wizard mode, and complete all five
      steps; each step validates before advancing; Back preserves entered values.
      *(Verified Phase 1: NewProjectModal.test.jsx — full step walkthrough + Back
      preserving values, both passing.)*
- [ ] AC-2: Completing the wizard with a Firebase/GCP deployment choice produces a
      project whose repo contains `conductor/deploy.json` and
      `conductor/deployment-stack.md` reflecting the wizard's answers.
- [ ] AC-3: After Launch, tracks appear on the Kanban board without any manual track
      creation, each carrying `**Auto Run**: yes`, and a running sync+poll worker
      begins executing them from the queue.
- [ ] AC-4: With valid Firebase/GCP credentials configured, the generated deploy
      track actually deploys the app and the project's `app_url` is set to a
      reachable URL (verified by fetching it).
- [ ] AC-5: The progress view shows each generated track's lane/progress live, and
      when the deploy track finishes, the live app link is visible both there and on
      the project card.
- [ ] AC-6: A deliberately failed track (e.g. bad credentials) surfaces in the
      progress view as needing input within one worker cycle.
- [ ] AC-7: Existing flows are unbroken: quick single-form create still works, and
      `DeployPanel` in CICDView behaves as before (existing tests pass).
      *(Verified Phase 1 for the "quick create still works" half — the
      full existing ui test suite shows the same 30 pre-existing failures on
      main with zero new failures. DeployPanel-specific check is Phase 2's job
      once its helpers are extracted.)*

## Data Model Changes

- `projects.app_url TEXT` (nullable) — live deployed URL; set by the deploy track's
  completion path via the collector API (`POST /api/projects/:id/app-url`; migration:
  `ui/server/migrations/011_app_url.sql`).
- `worker_dispatch` payload for `create-project` gains optional
  `wizard: { design, deployment, track_plan_hint }` alongside the existing
  `scaffold_context` — additive, older workers ignore it.

## API Contracts

- `POST /api/dispatch/create-project` — payload extended (additive) with `wizard`
  block; response unchanged.
- `POST /api/projects/:id/app-url` — body `{ "app_url": "<https url>" | null }`; 400 on a
  non-http(s), non-null value; 404 if the project doesn't exist; sets/clears `projects.app_url`.
  A dedicated endpoint rather than folding into the existing `PATCH /api/projects/:id` (which
  requires `name` — a human-rename contract, not this track's own-run reporting contract).
- `GET /api/projects` (the list endpoint — no single-project `GET /api/projects/:id` route exists
  in this codebase) now includes `app_url` per row.

## Out of Scope (explicit — not deferred acceptance criteria)

- Providers beyond Firebase Hosting / GCP (Vercel, AWS…) — the deployment step's
  provider list is extensible but only Firebase/GCP ships in this track.
- Automatic provisioning of Firebase/GCP projects or credentials (user must have
  gcloud/firebase auth configured on the worker machine; the wizard verifies and
  reports, it does not create accounts).
- Cloud-mode (remote-api) end-to-end run — UI must render, but the e2e scenario is
  validated on local-api only.
