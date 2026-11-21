# Spec: the monitoring and logging skills (AM-10154)

The pack `laneconductor-analytics-monitoring` ("LaneConductor Skills: Analytics, Monitoring and Logging") was started on 2026-11-20 with one skill, `ga4-gtag-with-consent` (0.1.0, in the marketplace, installed from a fresh profile and checked). This track adds the other two, one skill per pattern: a skill that bundles two conventions is two skills.

## Why three skills and not one

Each runs at a different moment (building the page, deploying, debugging production), Claude loads a skill only when its description matches the work, and the library caps a skill at about 8,000 characters. One combined skill would be too long and would load for every task that touches any of the three.

## Sources (one of the owner's apps; read only, never run, never copied by value)

- Monitoring: `infra/monitoring/apply.py` (creates the uptime checks, log metrics, alert policies and a budget; idempotent, looked up by display name, created only if missing, `--dry-run` prints what would be created, retired alerts are deleted on a normal run), `infra/monitoring/dashboard.json` (a dashboard with about a dozen tiles) and `scripts/prod-status.ts` (a one-screen read-only status: counts, names and dates, no secrets).
- Logging: `functions/backend/src/utils/logger.ts` and the lines the metrics count (for example one line per slow request).

## Requirements

- REQ-1 A skill `cloud-monitoring-as-code` (name to confirm in the brainstorm): production monitoring as a script in the repository, not clicks in a console. It covers the idempotent apply-by-name shape with a dry-run, log-based metrics counting a stable log line, alert policies on those metrics with thresholds and windows, an uptime check, a budget alert, a dashboard kept as JSON, and a read-only status script. Every claim about Cloud Monitoring is checked against Google's documentation in the session it is written, or labelled unproven.
- REQ-2 A skill `structured-logs-for-alerts` (name to confirm): structured JSON logs from the backend with a severity and a stable event name that log-based metrics and alerts can count, one line per event, no secrets or personal data in a log line, and how a line becomes a metric. Checked against Google's documentation for structured logging and log-based metrics, or labelled unproven.
- REQ-3 Each skill passes the format check (`node skills-tools/bin/check.mjs`: zero errors, zero warnings), the privacy gate with the local deny list (zero findings), has the `verified` date set to the day both passed, and keeps private names, project ids, emails, bucket names and paths out (placeholders only).
- REQ-4 Anything that can be tried safely is tried before a claim is kept (as the analytics template was run in a browser). Code in another repository is never run: what the script does is stated as observed from reading it.
- REQ-5 The pack goes to 0.2.0 with both skills, the marketplace entry, the generated plugin map, the root README row and the landing and wiki pack rows say so, the full test suite passes, strict validation passes, and a fresh profile installs the pack from GitHub and lists the skills. The versions line on the site updates itself; the site text needs a deploy, on the owner's word.
- REQ-6 No base plugin file changes, so there is no new base version for these (an advisor catalog entry for the pack would be base text, and is out of scope here).

## Done before this track

- The pack and `ga4-gtag-with-consent` 0.1.0 (analytics, consent, Search Console, sitemap and robots tests), pushed as 3bfba3ba; tests 925, strict validation, privacy gate clean, template run in a browser, install checked from a fresh profile.

## Out of scope

An advisor catalog entry and stack tags for the pack (base text); using the skills in other projects (each project does that itself); the GA4 setup of the LaneConductor site (track 10149).

## Decisions (2026-11-21, plan lane; the owner can overrule any of them)

- D1 Names stay `cloud-monitoring-as-code` and `structured-logs-for-alerts`: each says the pattern, and a person typing "alert on slow requests" or "log so I can alert" matches the description. A rename is cheap until the pack is released.
- D2 The status script is described in the monitoring skill, not shipped as a template. It reads one app's own counts, so a template would be that app's code with names changed, and nothing here can run it against Google Cloud (REQ-4). The skill states the shape (read only, counts, names and dates, no secrets) and says it was observed, not run.
- D3 The apply script is not shipped as a template either, for the same reason: it needs a Google Cloud project to run, and an untested template teaches a wrong shape with confidence. If the owner has a project to try it in, a template can be added in a later version.
- D4 The budget alert stays a section of the monitoring skill: it is created by the same apply script, by the same look-up-by-name step. Split it out only if the monitoring body goes past 8,000 characters.
- D5 Capture check (REQ-3 and the process step 1): the library has no monitoring or logging skill (searched `skills/` on 2026-11-21; the only hits are a security-alert line in `llm-through-tokentalos`), so there is nothing to update instead. Both patterns are the owner's convention with working code; the real-time-spent test is the owner's call at the draft review.

## Owner input needed before the build

- The path or name of the repository that holds the working code. The skills are written from reading it (read only); without it the plan stops at Phase 1.

## Open questions

- None that block planning. D1 to D4 stand unless the owner says otherwise.
