# Spec: End-to-end walkthrough — UI (browser)

## Problem Statement

A partial version of this walkthrough (2026-08-12, track 1102) broke at several
independent points — a project that wasn't a git repo, a plan button that never
dispatched, failures that surfaced nowhere — and those were found by accident
while verifying something else. The UI is the interface most likely to hide
problems: it can show a plausible-looking board while nothing behind it works.
This track makes the "nothing → a track planned" walkthrough a deliberate,
repeatable exercise for the UI specifically, and records every point where it
breaks or is unclear rather than working around it.

## Requirements

- REQ-1: Walk the full path using a real browser session against a clean,
  newly-created project — through actual UI screens, not API calls, CLI
  shortcuts, or code reading.
- REQ-2: At each step, record the *observed* result (actual UI state,
  screenshot, actual response), not the intended/assumed behavior.
- REQ-3: Reach the reference outcome (8 points below) using only the
  UI-specific path: New Project wizard, Project selector, `+ Track` modal,
  the track card's lane-action controls, the Activity panel, the track
  detail drawer, Inbox, and the CI/CD tab + deploy wizard (stop before an
  actual deploy).
- REQ-4: For every reference-outcome point the UI cannot reach, or reaches
  only partially, record it as a named finding — never silently substitute
  another interface (API/CLI) to get past it.
- REQ-5: Check track 1102's findings (F1-F8) first; link to an existing
  finding rather than duplicating it. Only file a new finding (F9+) for
  something genuinely not yet recorded there.
- REQ-6: Note every state the UI fails to represent — no worker running,
  project isn't a git repo, a lane action failed, which machine a worker is
  on — this feeds track 1103 Phase 4's design.
- REQ-7: Per the track's dogfooding rule, every lane action, comment, and
  status check on *this* track (1104) must itself be performed through the
  LaneConductor web UI. Any point where that's not possible is itself a
  finding, not a reason to fall back to a side channel.
- REQ-8: The eventual wiki UI guide (feeds track 1103 Phase 5) must be
  transcribed from the actual recorded run — real commands, real screens,
  real outputs, including rough edges that survived — not written from
  memory or assumption.
- REQ-9: The walkthrough must be encoded as a Playwright spec added to track
  1100's fast tier (Phase 5), so it can't silently rot after being written
  up once.

## The reference outcome (identical for all three sibling walkthroughs)

1. A project exists and is registered (`projects` row, `repo_path` set).
2. It is a git repo with at least one commit (lane actions need
   `git worktree add … HEAD` — see track 1102 F7).
3. Its context files exist: `product.md`, `tech-stack.md`, `workflow.md`,
   `product-guidelines.md`, `design-language.md`, `deployment-stack.md`,
   `kpis.md`, `user-stories.md`, `quality-gate.md`.
4. A worker is running for it, and the interface makes clear *which
   machine* it is on and whether it is manual or automatic.
5. A track can be created, and its 5 files are scaffolded (`index`, `spec`,
   `plan`, `test`, `conversation`) with a real populated `test.md`.
6. A lane action (plan) can be triggered from this interface and actually
   runs to completion — the track reaches `plan/success`.
7. The run is observable from this interface while it happens, and its
   output is readable afterwards.
8. Failures are visible: if the action fails, this interface says so with a
   usable reason (no silent `claimed`/`running` limbo — track 1102 F8).

## Acceptance Criteria

- [ ] A brand-new project was created via the UI's `+ Project` wizard against
      a clean (previously-nonexistent) directory, and observed (in the
      browser) to be registered — visible in the project selector,
      `repo_path` set.
- [ ] The created project is confirmed to be a working git repo with at
      least one commit, OR that failure is filed as a finding referencing
      1102 F7 rather than worked around.
- [ ] All 9 context files are confirmed present for the new project.
- [ ] The UI shows a worker running for the project, stating which machine
      it's on and whether it is manual (sync-only) or automatic
      (sync+poll) — OR that gap is recorded as a finding feeding 1103
      Phase 4.
- [ ] A track was created via the `+ Track` modal and all 5 files exist on
      disk, with `test.md` containing real (non-stub) test cases.
- [ ] The Plan lane action was triggered from a control on the track card
      (never curl/API/CLI) and the track reached `plan/success`, OR that
      failure is filed referencing 1102 F5 rather than triggered another
      way to get past it.
- [ ] While the plan action ran, its progress was observable from the
      Activity panel, and its output/transcript was readable afterward
      from the track detail drawer.
- [ ] A failure path was observed at least once, and the UI showed a clear
      reason rather than leaving the track in silent `claimed`/`running`
      limbo (1102 F8) — if it doesn't, that absence is itself the finding.
- [ ] The Inbox and CI/CD tab + deploy wizard were walked and their
      behavior recorded; no real deploy was executed.
- [ ] Every lane action / comment / status check performed on Track 1104
      itself went through the LaneConductor UI; any inability to do so is
      recorded as a finding.
- [ ] A written walkthrough transcribed from this run's actual recording
      exists (or is queued as Phase 4), and a Playwright spec encoding it
      exists in track 1100's fast tier (or is queued as Phase 5).
