---
name: cloud-monitoring-as-code
description: "Set up production monitoring on Google Cloud as one idempotent script kept in the repository: an uptime check, log-based metrics that count stable log lines, alert policies on those metrics, a budget alert and a dashboard kept as JSON, applied with gcloud by display name with a dry-run, plus a read-only one-screen status script."
when_to_use: "Use when a Cloud Run or Firebase app needs alerts or a dashboard, when someone clicked alerts together in the console and nobody knows what exists, when an alert pages too often or never fires, when a monthly budget alert is wanted, or when asked what is the state of production right now."
paths: "infra/monitoring/*, scripts/prod-status.*"
metadata:
  kind: convention
  stack: [google-cloud, cloud-monitoring, cloud-logging, cloud-run, gcloud, python]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A Google Cloud project with billing, and gcloud signed in with rights to create monitoring resources, log metrics and budgets.
    - The backend writes one structured log line per event with a stable name (see the skill structured-logs-for-alerts).
  verified: 2026-11-21
  smoke_check: python3 infra/monitoring/apply.py --dry-run
---

## Why this works
Observed in one of the author's apps: monitoring lives in one file, `infra/monitoring/apply.py`, next
to a `dashboard.json`, so what exists in production is readable in git and a new environment is one
command. Every resource is looked up by display name and created only when missing, so the script
is safe to run again after every change. It grew over many tracks (new metrics and alerts were
added as features shipped) and it stayed readable because each addition is one table row and one
comment saying which track and which log line it counts. The same app keeps a second script,
`prod-status`, that prints production's state on one screen.

## Recommendation
- One script, desired state in tables: uptime checks, log metrics (name to log filter), alert
  policies (name to condition), one notification channel, a budget, a dashboard file. It calls
  `gcloud` with `--format=json` (a subprocess, no client libraries) and takes project, owner email
  and budget amount from environment variables with defaults.
- Create-only plus an explicit retire list. Removing a name from a table does not remove it from the
  project; put replaced policies in a `RETIRED` list that a normal run deletes and the dry-run prints
  as "would delete". `--dry-run` prints `ok` or `would create` per item and changes nothing: run it
  first, always. Never run the script from a build step.
- Apply a metric and its alert only after the deploy that writes the log line. Google: a log-based
  metric counts only entries received after it was created (checked 2026-11-21).
- Log metrics: the filter is the resource type, the service name and `jsonPayload.event="<name>"`; a
  family of events is one regex (`jsonPayload.event=~"^billing\\."`). Count the event name, never
  the message text. Cloud Monitoring name: `logging.googleapis.com/user/<metric>` (checked).
- Alert shapes that worked: "must never happen" (a failed payment, a replayed token, a failed backup)
  is a count above 0 over a 10-minute window; a spike is a count above N over 15 to 60 minutes
  (`ALIGN_DELTA`, `REDUCE_SUM`, alignment period equal to the window, duration 0). Each policy
  carries a documentation line naming the runbook and the status command.
- Uptime: a check on the site and one on a deep health URL that touches the database (every 5
  minutes, 10 s timeout, SSL validated, three regions, status 200); an alert on `check_passed` and one
  on `time_until_ssl_cert_expires` under 14 days (metric name checked in Google's docs). The script
  probes the deep URL and skips its alert until that endpoint is deployed.
- Waiting for something that should happen (a nightly backup): an absence alert, but keep its window
  under a day. For longer ("no weekly backup in 8 days") the daily job logs a `...stale` event and a
  normal count alert catches that line.
- Tune from real pages. In the author's app a p95 alert of 3 s for 15 minutes paged on one cold
  minute after a deploy and became 5 s for 30 minutes; a slow-query alert paged for one phone open and
  became "requests with slow statements" counted from one summary line per request (see
  structured-logs-for-alerts), with the threshold raised twice after ordinary evenings. Retire the old
  policy by name.
- Budget: three threshold rules (50, 90, 100 percent), email through the same notification channel,
  filtered to the project. Google: an alerts-only budget does not stop spending, and the first
  notification can take several hours (checked).
- Dashboard: tiles in `dashboard.json`; on a rerun the script adds tiles whose title the live
  dashboard lacks and keeps its etag; it never replaces the live one.
- `prod-status` (TypeScript or any language): read-only `gcloud` calls only, one section per
  concern (health, release, traffic and errors, money path, jobs, monitoring, storage), counts,
  names and dates, never a secret or user data. Every section tolerates a failed call and prints
  `n/a (reason)`; a capped read prints `500+`.

## Claude does
Reads the app's log events and deploys, writes or extends `infra/monitoring/apply.py` as above (one
table row and a one-line comment per item), runs `--dry-run` and shows what would be created, and
never runs the apply itself. Adds the status script sections for new events.

## You run
`python3 infra/monitoring/apply.py --dry-run`, then without the flag after the deploy that writes the
lines, once, yourself. `gcloud auth login` first.

## Pitfalls
- A metric created before its lines exist shows no data; a count alert stays quiet, so a typo in the
  event name never alerts. Look at the metric once after the first real event.
- A name left in a table after you rename it creates a second policy; retire the old one.
- Google: when a threshold condition has no data, open alerts stay open and new ones do not open by
  default, so a quiet metric is not a healthy one.

## Unproven
- The app's script comments a 23.5 hour limit for absence alerts; Google's page today says alignment
  period plus retest window must not exceed 25 hours (checked). Keep it under a day either way.
- The script uses `gcloud alpha` for policies and channels; whether these are generally available
  now was not checked. Its monitoring-query-language 5xx condition is not checked against Google's
  current MQL guidance.
- Not run here: the script was read, never executed.
