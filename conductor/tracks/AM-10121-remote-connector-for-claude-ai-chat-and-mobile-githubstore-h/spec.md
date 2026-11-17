# Spec: Remote connector for claude.ai chat and mobile: GitHubStore, HTTP server, OAuth, deploy (carved out of 10106)

## Problem Statement

Carved out of track 10106 when it was closed on 2026-11-17. The local connector (stdio, git-backed) is done and shipped in the plugin. This track is the REMOTE half: the same tools served over HTTP so claude.ai chat and the mobile app can read and write tracks through GitHub, with no laptop involved.

Leftover work, with the original task numbers in 10106's plan.md (the plan and spec there hold the full contracts):
- Phase 7, GitHubStore: read path with ETag cache and request budgets, write path with createCommitOnBranch and retry, the unknowns U4 (tarball cost) and U5 (stale expectedHeadOid error shape), and the shared tool-contract suite passing on both stores.
- Phase 8, remote HTTP server and auth: OAuth authorization server role (Google sign-in per FITI or GitHub), per-user repo selection, container and Cloud Run or Firebase config, advice-log buffering, a self-describing /start page. The human performs the deploy, the App or OAuth registration and puts secrets in Secret Manager; Claude never sees them.
- Phase 9, remote beta validation: add the connector on claude.ai web against a scratch GitHub repo, the staleness and CONFLICT scenarios, rate-limit budgets, and the client compatibility matrix (what claude.ai web, mobile and Claude Code actually did).
- Plugin follow-ups that need the remote URL: add the `type: http` entry so claude.ai and Cowork list it on the plugin's Connectors tab (10106 5c Task 6), and list the remote connector separately in Anthropic's directory (5e Task 14). Directory submission of the whole plugin stays parked: the directory does not accept a local MCP server from an unverified publisher.

Open decisions (D1 to D5 in 10106): which sign-in (Google per FITI, or GitHub), hosting (Cloud Run behind Firebase Hosting), who is allowed, and whether decisions are tracked in git (privacy). Why backlog: the plugin works locally today; the remote half costs a deploy, a registration and ongoing hosting, and it is only worth it if you need tracks from chat or the phone. Decide that first.

## Requirements

(To be written in the plan lane.)
