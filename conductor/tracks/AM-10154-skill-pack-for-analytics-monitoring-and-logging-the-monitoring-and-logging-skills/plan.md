# Plan: AM-10154

## Phase 1: Capture check and reading
- [ ] Task 1: Run the capture check for each skill (an owner convention or an incident, working code that shows it, real time spent) and search the library for an overlap before adding anything
- [ ] Task 2: Read the monitoring sources (`apply.py`, `dashboard.json`, `prod-status.ts`) and the logger; write down what was observed, in general words, and what was not (REQ-1, REQ-2, REQ-4)
- [ ] Task 3: Check the Google-side claims against Google's documentation in the same session (Cloud Monitoring alert policies, uptime checks, log-based metrics, budgets, structured log fields); label the rest unproven

## Phase 2: The monitoring skill
- [ ] Task 4: Draft `skills/cloud-monitoring-as-code/SKILL.md` (and `files/` if a template helps) in the library format; format check and privacy gate (REQ-1, REQ-3)
- [ ] Task 5 (HUMAN): Read the draft; say yes or no before it is saved

## Phase 3: The logging skill
- [ ] Task 6: Draft `skills/structured-logs-for-alerts/SKILL.md`; format check and privacy gate (REQ-2, REQ-3)
- [ ] Task 7 (HUMAN): Read the draft; say yes or no before it is saved

## Phase 4: The pack
- [ ] Task 8: Add both skills to `scripts/skill-packs.json`, bump the pack to 0.2.0, update the pack's description, regenerate, update the pack-table tests, the root README row and the landing and wiki rows (REQ-5)
- [ ] Task 9: Full tests, strict validation, privacy gate, a fresh-profile install from GitHub (REQ-5)
- [ ] Task 10 (HUMAN): Say "deploy" for the site text; then deploy from a clean copy of main and verify live
