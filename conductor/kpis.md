# Project KPIs — LaneConductor

## North-Star Metrics

### Awareness
| Metric | Target | Time Horizon | Status | Notes |
|--------|--------|--------------|--------|-------|
| GitHub Stars | 500 | Q2 2026 | tracking | 8 stars as of 2026-05-07 |
| Show HN Score | 100 | per launch | tracking | Track 1052 — actual: 1 |
| Reddit Post Upvotes | 50 | per post | tracking | Track 1053 — posts removed (karma), megathread live |
| LinkedIn Reactions | 50 | per post | tracking | Track 1069 — 1 reaction, 119 impressions (7h) |
| DEV.to Reactions | 30 | per post | tracking | Track 1070 — pending publish |

### Adoption
| Metric | Target | Time Horizon | Status | Notes |
|--------|--------|--------------|--------|-------|
| Active Projects (installs in use) | 100 | Q2 2026 | tracking | Projects with a worker syncing in the last 7 days |
| Daily Active Users (dashboard) | 200 | Q3 2026 | not started | Unique users opening the Kanban UI |
| Returning Projects (week 2+) | 40% | Q3 2026 | not started | Retention signal — projects still active after first week |

### Cloud (Track 1017)
| Metric | Target | Time Horizon | Status | Notes |
|--------|--------|--------------|--------|-------|
| Cloud Signups | 50 | Q3 2026 | not started | Waiting on Track 1017 + 1002 |
| Cloud MRR | $500 | Q4 2026 | not started | Track 1003 billing |

## Contributing Tracks

Tracks with `**Maps To**` in their KPI block roll up here automatically (via `KpiRollupPanel` in the UI).

| Track | Title | Maps To | KPI Actual | Target | Status |
|-------|-------|---------|------------|--------|--------|
| 1052 | Show HN Post | Show HN Score | 1 | 100 | failed — replanned |
| 1053 | Reddit Launch Posts | Reddit Post Upvotes | 0 | 50 | posts removed (karma) — megathread live |
| 1056 | Product Hunt Listing | Product Hunt Upvotes | — | 200 | cancelled — not aligned with OSS adoption goal |
| 1069 | LinkedIn Launch Post | LinkedIn Reactions | 1 | 50 | live — window closes 2026-05-10 |
| 1070 | DEV.to Article | DEV.to Reactions | — | 30 | planned — pending publish |

## Notes

- Targets are directional for a launch-phase dev tool with no paid marketing budget — adjust as data comes in
- "Active projects" is the most important long-term signal; awareness metrics are one-time launch events
- Cloud metrics are gated on Track 1017 (cloud infra) and Track 1003 (billing) shipping
