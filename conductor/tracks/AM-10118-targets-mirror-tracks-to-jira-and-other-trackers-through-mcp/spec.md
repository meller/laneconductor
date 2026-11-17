# Spec: Targets: mirror tracks to Jira and other trackers through MCP connectors, on demand, no daemon

## Problem Statement

LaneConductor had sync targets (Jira: `lc add-target --type jira`, a lane-to-status mapping, polling two-way sync, track 1067). They ran inside the sync daemon, which is stopped, and the legacy guide that documented them is not shipped in the plugin. The need remains: a person wants their tracks mirrored in the tracker their team uses.

## Decision (human, 2026-11-17)

A target is an OPTIONAL ADD-ON PLUGIN, one per tracker, not part of the main plugin. The first is `laneconductor-jira`, shipped with its own hooks; others follow the same pattern later (`laneconductor-linear`, and so on). Each add-on declares `dependencies: ["laneconductor"]`, adds its own commands in its own namespace (`/laneconductor-jira:sync`, `:targets`) and its own hooks, and is installed from the owner's marketplace only. Reasons: it is only for people who use that tracker; it writes to an outside system, so it should be a deliberate install; hooks (an offer to sync after a lane moves) must not run for everyone; and it keeps the core plugin small and agent-neutral.

## Design sketch

- Files in git stay the truth; the tracker is a mirror. No daemon.
- Config in `.laneconductor.json` (`targets: [{ type: 'jira', connector, project_key, mapping: {plan, implement, review, quality-gate, done -> status names}, direction: 'push' | 'both' }]`). No tokens in the repo; credentials stay with the Jira MCP connector (decide in the plan whether the add-on ships a public `type: http` entry in its `.mcp.json` for the Atlassian remote server or reuses a connector the person already added).
- `/laneconductor-jira:sync`: push the tracks changed since the last sync: one issue per track keyed by track number, the issue key stored in a track marker (`**Jira**: KEY-123`), status from the mapping. Every write to Jira needs the person's yes (outward-facing).
- `/laneconductor-jira:targets`: list, add, map.
- Optional pull: status changes in Jira become PROPOSED lane changes, applied only after the person agrees. Conflict rule: if both sides changed, show both and ask.
- Hooks (in the add-on): after a lane move offer one line 'sync to Jira?' (offer only, switchable off). Scripts only, no package.json (same rules as `laneconductor-hooks`).
- The procedure is Markdown plus the mapping idea, so another MCP-capable agent can run it later through an adapter.
- The legacy daemon code (`conductor/jira-target.mjs`, `jira-collector.mjs`, `sync-targets.mjs`, `jira-auth.mjs`) and `lc add-target` stay as documented legacy; the token-based auth is not reused.

## Open questions for the plan lane

Which Jira and Linear connector tools exist in the person's setup (read `tools/list`, never guess argument names); how issue keys are stored; whether to reuse the mapping logic of `jira-target.mjs`; how the add-on's hooks coexist with `laneconductor-hooks`; the directory rules do not apply (a local-install add-on).

## Requirements

(To be written in the plan lane.)
