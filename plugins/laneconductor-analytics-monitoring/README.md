# LaneConductor Skills: Analytics, Monitoring and Logging

Skills for knowing how a product does: Google Analytics 4 behind a consent choice with Search Console ownership and a tested sitemap.xml and robots.txt; production monitoring on Google Cloud as one idempotent script; structured logs and a slow-query log that alerts can count.

A skill pack for Claude Code, version 0.2.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `ga4-gtag-with-consent`: Add Google Analytics 4 the privacy-friendly way: Google's own tag (gtag.js) with your own measurement id, loaded only after the visitor accepts, advertising features off, an opt-out that stops sending, a few named events with safe parameters, a first-touch campaign source, plus Search Console ownership and a real sitemap.xml and robots.txt with a test.
- `cloud-monitoring-as-code`: Set up production monitoring on Google Cloud as one idempotent script kept in the repository: an uptime check, log-based metrics that count stable log lines, alert policies on those metrics, a budget alert and a dashboard kept as JSON, applied with gcloud by display name with a dry-run, plus a read-only one-screen status script.
- `structured-logs-for-alerts`: Write backend logs so alerts can count them: one JSON line per event with a Cloud Logging severity and a stable event name, fields from an allow-list of ids, enums, counts and durations, no secrets or personal data, rate limits against floods, and one summary line per request instead of one per statement, and a slow database query log, so a log-based metric and an alert have something exact to count.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-analytics-monitoring@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-analytics-monitoring@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
