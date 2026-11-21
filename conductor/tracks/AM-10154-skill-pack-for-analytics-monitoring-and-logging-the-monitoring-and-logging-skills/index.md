# Track AM-10154: Skill pack for analytics, monitoring and logging: the monitoring and logging skills

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Built and deployed 2026-11-21: pack 0.2.0 with three skills (301b9c85); site text live and equal to main. Waits for review and the quality gate.
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: The owner wants knowing how a product does to be one pack of skills: analytics, monitoring and logging. Analytics is done. Monitoring (Cloud Monitoring as code: uptime checks, log-based metrics, alert policies, a budget alert and a dashboard, applied by an idempotent script, plus a read-only production status script) and logging (structured logs with stable event names that the log-based metrics and alerts count, no secrets) exist only as working code in one of the owner's apps. Nothing in the library says how they were done, so each new project would work them out again.
**Summary**: Capture two skills from the owner's working code, `monitoring` and `logging`, with the skill-from-code process (capture check, read the code, check every claim against Google's docs or label it unproven, format check, privacy gate, the owner's yes), add them to the pack `laneconductor-analytics-monitoring`, release it as 0.2.0, and tell the site and README.
