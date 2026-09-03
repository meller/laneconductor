# Track TU-10049: Wizard: GitHub + Jira + GCP Credential Onboarding

**Lane**: implement
**Lane Status**: queue
**Progress**: 90%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: Extend the existing New Project wizard so a user can connect GitHub (repo access/App install), Jira (issue-tracker linkage), and GCP (project + service-account or delegated credentials) during…

## Added scope (2026-09-03, folded in before planning)
- **Jira** joins GitHub + GCP as a third real, functional credential/connection type in the wizard — not just a placeholder. Needs its own auth flow (Jira uses OAuth 2.0 (3LO) or API token + email, not a GitHub-App-style installation) and its own credential-status check, mirroring how GitHub/GCP are handled.
- **Alternatives dropdown — applies to every provider category, not just source control**: each of the three pickers (source control, issue tracker, cloud) lists its own real alternatives by name, visibly present, disabled/non-clickable, tagged "FFU":
  - Source control (GitHub is real): GitLab, Bitbucket, etc.
  - Issue tracker (Jira is real): Linear, Asana, etc.
  - Cloud (GCP is real): AWS, Azure, etc.
  Exact set per category TBD at planning. Purpose is roadmap signaling, not functionality — clicking one must not error or silently no-op without feedback; it should read as clearly "not yet available."
- No existing Jira integration exists anywhere in the codebase today (verified via grep) — this is net-new, not extending something partial.
**Merge Mode**: direct
**Auto Run**: yes
