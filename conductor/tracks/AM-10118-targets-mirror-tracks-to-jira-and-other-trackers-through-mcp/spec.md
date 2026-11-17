# Spec: Targets: an optional add-on for teams that also use a product tool (Jira first, through MCP connectors, no daemon)

## Problem Statement

LaneConductor had sync targets (Jira: `lc add-target --type jira`, a lane-to-status mapping, polling two-way sync, track 1067). They ran inside the sync daemon, which is stopped, and the legacy guide that documented them is not shipped in the plugin. Some teams will want their work linked to the product tool they already use. This track is that optional bridge. It is not the product's headline.

## Direction (human, 2026-11-17)

LaneConductor is a plan-first working process kept as files in git (it combines the conventions of Gemini CLI's Conductor and the discipline of Superpowers, with a Kanban view). It is not a product tracker and it does not compete with ticket-to-pull-request agents. A small team can use it alone: the backlog lane is the product list, a track is the feature, the board is the overview. A team that grows and needs roadmaps and cross-team priorities can add a product tool (Jira, Azure DevOps, Linear, GitHub Issues, and so on) for the PRODUCT view; LaneConductor stays the working view of the same items. The tool's connector and LaneConductor's connector work side by side: one brings the product, the other plans and does the technical work. They are complementary.

Not for: a team whose process lives entirely in Jira and that does not use AI agents. A team that adds a product tool later must not start over: existing tracks can be linked to items afterwards.

## What the market already does (checked 2026-11-17, re-verify before any public claim)

- Atlassian offers a Jira Coding Agent (formerly Rovo Dev) that works from a Jira work item and produces code and a draft pull request in a secure cloud sandbox; it needs AI features, Rovo credits and a Standard or Premium plan (https://support.atlassian.com/rovo/docs/generate-code-from-a-work-item-in-jira/). So "ticket to pull request by an agent" is NOT ours and must never be claimed.
- Atlassian's hosted Rovo MCP server lets Claude and other MCP clients search, create, update and transition Jira work items and add comments, under the person's own Jira permissions (https://www.atlassian.com/blog/rovo/atlassian-rovo-mcp-ga).
- Azure DevOps has a hosted remote MCP server (public preview when checked) exposing work items, pull requests, pipelines and test plans (https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server). Linear and others have MCP servers; their details are not verified here.

The difference to state carefully (a difference of where things live and who runs them, never "others cannot"): the spec, plan and tests are files in the team's own repository, reviewed with the code; the work runs on the person's machine with their own Claude; it works with no tracker at all.

## Decision (human, 2026-11-17)

A target is an OPTIONAL ADD-ON PLUGIN, one per tool, not part of the main plugin: `laneconductor-jira` first, then others only where a connector exists and has been tried. Each add-on declares `dependencies: ["laneconductor"]`, adds its own commands in its own namespace and its own hooks, and is installed from the owner's marketplace only. Reasons: it is only for people who use that tool; it writes to an outside system, so it should be a deliberate install; hooks must not run for everyone; the core plugin stays small and agent-neutral.

Timing: NOT NOW. Backlog until the new-project flow (10117) and the hooks extension (10115) are done. The docs page (`docs/why-laneconductor.md`) explains the idea without promising a date.

## Design sketch: one generic target contract, thin add-ons

Two operations, written as Markdown procedures any MCP-capable agent can run through the tool's connector:
1. TAKE: read one item from the product tool ("take PROJ-123") and create a track from it, storing the item key in the track (`**External**: jira PROJ-123`, decide in the plan). The item's title and description become the problem statement.
2. REPORT: at milestones (plan ready, pull request opened, merged) add a comment and move the item's status through the lane-to-status mapping.

Rules:
- One owner per field: the product tool owns title, priority and product description; the track owns plan, tests and implementation state. If the item is edited after the track exists, flag it and ask; never overwrite the spec silently.
- Link, do not paste: comments carry a link and a short status line; anything longer goes through the privacy scan (`connector/src/scan.mjs`) first.
- Pull first: nothing happens until the person asks. Automatic pickup is the parked orchestrator idea.
- Every write to an outside system needs the person's yes.
- Config in `.laneconductor.json` (`targets: [{ type, connector, project_key, mapping, direction }]`), no tokens in the repo; credentials stay with the tool's connector.
- Commands in the add-on's namespace (`/laneconductor-jira:take`, `:sync`, `:targets`) and an offer-only hook after a lane move (switchable off). Scripts only, no package.json (same rules as `laneconductor-hooks`).
- The legacy daemon code (`conductor/jira-target.mjs`, `jira-collector.mjs`, `sync-targets.mjs`, `jira-auth.mjs`) and `lc add-target` stay as documented legacy; the token-based auth is not reused.

## Open questions for the plan lane

Which connector tools exist in the person's setup (read `tools/list`, never guess argument names); the lane-to-status mapping (ask one or two real Jira users); how item keys are stored and how existing tracks are linked later; whether to reuse the mapping logic of `jira-target.mjs`; how the add-on's hooks coexist with `laneconductor-hooks`; whether Azure DevOps (it has a hosted MCP server) should be the second add-on.

## Requirements

(To be written in the plan lane.)
