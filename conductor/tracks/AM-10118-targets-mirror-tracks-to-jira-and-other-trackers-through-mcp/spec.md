# Spec: Targets: LaneConductor as the engineering layer under a product tool (Jira first, through MCP connectors, no daemon)

## Problem Statement

LaneConductor had sync targets (Jira: `lc add-target --type jira`, a lane-to-status mapping, polling two-way sync, track 1067). They ran inside the sync daemon, which is stopped, and the legacy guide that documented them is not shipped in the plugin. The need remains, but the shape is now different (see Direction).

## Direction (human, 2026-11-17)

A small team can use LaneConductor alone: the backlog lane is the product list, a track is the feature, the board is the overview, and there is no gap between deciding and doing. When a team grows and needs roadmaps, stakeholders and cross-team priorities, a product tool (Jira, Azure DevOps, Linear, GitHub Issues, and so on) takes the PRODUCT view, and LaneConductor stays the ENGINEERING view of the same work: a ticket becomes a track, the track is planned, implemented, reviewed and gated in the repository, and the milestones go back to the ticket. The product tool's connector and LaneConductor's connector work side by side: one brings the product, the other plans and executes the technical work. They are complementary, not competing trackers.

A team that adds a product tool later must not start over: existing tracks can be linked to tickets afterwards, so history is kept.

## What the market already does (checked 2026-11-17, re-verify before any public claim)

- Atlassian offers a Jira Coding Agent (formerly Rovo Dev) that works from a Jira work item and produces code and a pull request linked to the work item, in a secure cloud sandbox, and it consumes Rovo credits (Atlassian support page: https://support.atlassian.com/rovo/docs/work-with-rovo-dev-in-jira/). So "ticket to pull request by an agent" is NOT unique to us, and the product page must never say it is.
- Atlassian's hosted Rovo MCP server lets Claude and other MCP clients search, create, update and transition Jira work items and add comments, under the person's own Jira permissions (https://www.atlassian.com/blog/rovo/atlassian-rovo-mcp-ga).
- Azure DevOps has a hosted remote MCP server (public preview when checked) exposing work items, pull requests, pipelines and test plans (https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server). Linear and others have MCP servers too; their details are not verified here.

What stays different about this approach (to state carefully, as a difference of where things live and who runs them, never as "others cannot"): the spec, plan and tests are files in the team's own repository, reviewed with the code; the work runs on the person's own machine with their own Claude, with no third-party cloud sandbox and no per-run credits from the tracker vendor; it works with no tracker at all; and the same procedures work whichever tracker, if any, sits above.

## Decision (human, 2026-11-17)

A target is an OPTIONAL ADD-ON PLUGIN, one per tool, not part of the main plugin: `laneconductor-jira` first, then others only where a connector exists and has been tried (`laneconductor-linear`, an Azure DevOps one, and so on). Each add-on declares `dependencies: ["laneconductor"]`, adds its own commands in its own namespace and its own hooks, and is installed from the owner's marketplace only. Reasons: it is only for people who use that tool; it writes to an outside system, so it should be a deliberate install; hooks (an offer to sync after a lane moves) must not run for everyone; and the core plugin stays small and agent-neutral.

Timing: NOT NOW. This stays in the backlog until the new-project flow (10117) and the hooks extension (10115) are done. Meanwhile the documents (10119 and the docs page) explain the idea and what such tools are for, without promising a date.

## Design sketch: one generic target contract, thin add-ons

The contract has two operations, written as Markdown procedures any MCP-capable agent can run through the tool's connector:
1. TAKE: read one item from the product tool (for example "take PROJ-123") and create a track from it. The item's key is stored in the track (`**External**: jira PROJ-123`, or a per-tool marker; decide in the plan). The item's title and description become the track's problem statement.
2. REPORT: at milestones (plan ready, pull request opened, merged) add a comment and move the item's status through the lane-to-status mapping.

Rules:
- Files in git stay the truth for plan, tests and implementation state; the product tool owns title, priority and the product description. One owner per field. If the item is edited after the track exists, flag it and ask; never overwrite the spec silently.
- Link, do not paste: comments carry a link and a short status line; anything longer goes through the privacy scan (`connector/src/scan.mjs`) first.
- Pull first: nothing happens until the person asks. Automatic pickup is the parked orchestrator idea, not part of this track.
- Every write to an outside system needs the person's yes (outward-facing).
- Config in `.laneconductor.json` (`targets: [{ type, connector, project_key, mapping: {plan, implement, review, quality-gate, done -> status names}, direction }]`). No tokens in the repo; credentials stay with the tool's connector. Decide in the plan whether the add-on ships a public `type: http` entry in its `.mcp.json` or reuses a connector the person already added.
- Commands in the add-on's namespace (`/laneconductor-jira:take`, `:sync`, `:targets`) and an offer-only hook after a lane move (switchable off). Scripts only, no package.json (same rules as `laneconductor-hooks`).
- The legacy daemon code (`conductor/jira-target.mjs`, `jira-collector.mjs`, `sync-targets.mjs`, `jira-auth.mjs`) and `lc add-target` stay as documented legacy; the token-based auth is not reused.

## Open questions for the plan lane

Which connector tools exist in the person's setup (read `tools/list`, never guess argument names); the lane-to-status mapping (depends on how a real team uses its statuses; ask one or two real Jira users); how item keys are stored and how existing tracks are linked later; whether to reuse the mapping logic of `jira-target.mjs`; how the add-on's hooks coexist with `laneconductor-hooks`; whether another tool (Azure DevOps first, since it has a hosted MCP server) should be the second add-on.

## Requirements

(To be written in the plan lane.)
