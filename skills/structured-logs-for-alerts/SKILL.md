---
name: structured-logs-for-alerts
description: "Write backend logs so alerts can count them: one JSON line per event with a Cloud Logging severity and a stable event name, fields from an allow-list of ids, enums, counts and durations, no secrets or personal data, rate limits against floods, and one summary line per request instead of one per statement, and a slow database query log, so a log-based metric and an alert have something exact to count."
when_to_use: "Use when adding logging to a Node or other backend on Cloud Run, Cloud Functions or Firebase, when an alert needs something to count, when an alert pages for the wrong reason, when logs hold tokens, emails or text that should not be there, when errors do not show up in Error Reporting, or when the database is slow and nothing says which route."
paths: "functions/**/src/utils/logger.*, functions/**/src/middleware/*, src/**/log*.ts"
metadata:
  kind: convention
  stack: [google-cloud, cloud-logging, cloud-run, nodejs, pino, typescript, prisma]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The backend runs where stdout and stderr are collected by Cloud Logging (Cloud Run, Cloud Functions).
    - A logger that can write JSON (the app used pino).
  verified: 2026-11-21
---

## Why this works
Observed in one of the author's apps: a small logger module writes one JSON line per entry in the
shape Cloud Logging reads, and every event that matters has a stable name in an `event` field. The
log-based metrics and alerts of that app (see cloud-monitoring-as-code) count exactly those names,
so an alert is a count of one exact string, not a search of free text. Text searches broke whenever
someone reworded a message; a few older metrics in the same app still match message text and are
the ones to move to event names (the fragility is inferred, not observed).

## Recommendation
- One module is the only logger. In production it writes JSON with `severity` and `message`; in
  development readable lines; in tests nothing. Google (checked 2026-11-21): in a JSON line the
  top-level `severity` sets the entry's severity and `message` the main text, other fields stay in
  `jsonPayload`; so map your logger's levels to Cloud Logging names (`warn` to `WARNING`, `fatal` to
  `CRITICAL`) and set the message key to `message`. Drop process id and host name: Cloud Run adds the
  instance.
- Errors: log the message and the stack under `stack_trace`. Google (checked): Error Reporting reads
  `stack_trace`, then `exception`, then `message`, from entries with severity ERROR, and wants a
  `serviceContext` with the service name. The app logs `stack_trace` and its comment says Error
  Reporting groups errors by it; that was not checked in the console.
- Name events `area.what`, lowercase, stable: `billing.checkout.failed`, `email.sent`,
  `backup.failed`, `db.slow.request`. The name is an interface: renaming one silently breaks a metric
  and an alert. Put the event name in `message` or in `event`, and count `jsonPayload.event`.
- One line per event. Where thousands can occur, log a summary: the app logs one
  `db.slow.request` line per request that had slow statements (route template, method, count, max and
  total ms, status) and not one per statement, because one app open fired about 40 per-statement lines
  and an alert on those paged for one phone. Also rate limit a noisy event per key (at most a few per
  minute, the next line carries how many were left out) so a bad day cannot flood the logs.
- Fields from an allow-list: ids, enums, counts, durations, status codes. The connector logger of that
  app drops every key not on the list and every value that is not a number, a boolean or a short
  string (clipped to 80 characters), and a user appears only as a salted hash. Never log tokens, codes,
  headers, bodies, query strings (they can hold emails), words the user typed, or an address. Redact
  `authorization`, `cookie` and app-check header paths in the logger itself in case a header object
  slips in.
- Request line: method, path without the query, status, duration, user id when signed in, level from
  the status (5xx error, 4xx warning); skip preflights and health checks. Group routes as templates
  (`/items/:id`), never raw paths.
- A logging bug must never break a request: wrap the writer in try and swallow.
- Slow database queries (Prisma, observed): install one client middleware that times every
  operation and records it when it took at least a threshold (default 500 ms, one env variable, `0`
  switches it off; off in tests). It logs one `db.slow` line with model, action and milliseconds only:
  never the SQL, parameters or data. A per-model-and-action limiter allows a few lines a minute and
  the next line carries `suppressed`. A request-scoped counter (AsyncLocalStorage, opened by a
  middleware early in the chain) counts every slow statement, also the ones the limiter hid, and the
  response's `finish` or `close` writes the single `db.slow.request` line; outside a request (a
  scheduled job, a script) it does nothing. Alert on the request line; keep the statement line for the
  dashboard.
- A line becomes a metric by its filter: resource type, service, `jsonPayload.event="<name>"`. Google:
  a log-based metric is counted from entries received after it was created, and also from logs
  excluded from storage (checked).
- Test the shape: a unit test that calls the emitter with a hostile input (a token, an email, a long
  string) and asserts the line holds none of them and has the event name.

## Claude does
Adds or reviews the logger module and the emit calls, names events, applies the allow-list and the
no-secrets rule, adds the test, and hands the event names to the monitoring script.

## You run
The tests; deploy; then look at one real line in the Logs Explorer before creating a metric on it.

## Pitfalls
- A log message that carries a name or an email "just for debugging" is a data leak in a place with
  long retention. Log ids and counts.
- Free-text alerts ("message contains X") stop working at the next rewording.
- Logging inside a loop turns one slow request into thousands of lines and a bill.

## Unproven
- The slow-query hook is Prisma 4's `$use` middleware, read in the app, not run. Whether newer
  Prisma versions still have `$use` was not settled: Prisma's client-extensions page, read on
  2026-11-21, does not say. Check before copying the hook to a newer Prisma.
- Not run: the logger was read, not executed. The size limit of one log entry and the Error
  Reporting `serviceContext` handling were not checked beyond what Google's page above states.
