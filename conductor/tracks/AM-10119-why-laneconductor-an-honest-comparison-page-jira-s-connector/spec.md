# Spec: Why LaneConductor: an honest comparison page (use cases, not a tracker fight)

## Problem Statement

People will ask why they would use LaneConductor when their tracker (Jira, Linear, Azure DevOps) already has a Claude connector or even its own coding agent. We need one honest, sourced page (docs and landing) that explains the different jobs, where LaneConductor comes from, who it is for and who it is not for.

## Positioning (human, 2026-11-17)

- Origin: LaneConductor combines Gemini CLI's Conductor (conventions: context files, spec and plan per track) and Superpowers by Jesse Vincent (process: brainstorm, plan, sub-agents, verify), and adds a Kanban view. When it started the author did not find a Conductor for Claude or a Superpowers for Gemini. Ports of both for other agents have appeared since (so never write "does not exist"). Credit both openly.
- "Jira" stands for the whole product-management category (Jira, Linear, Azure DevOps, ...). Their job is the product view; this is a different use case, so the page compares use cases, not features.
- We do NOT compete with ticket-to-pull-request agents. Atlassian's Jira Coding Agent turns a work item into a draft pull request in a vendor cloud sandbox (needs a Standard or Premium plan and Rovo credits). The page must never claim "ticket to pull request" as ours, and never claim another product cannot do something.
- A small team can use LaneConductor alone; a larger one can add a tracker later. A tracker add-on (10118) is planned, not built, and nothing on the page depends on it.
- Not for: a team whose process lives entirely in Jira and that does not use AI agents. For everyone else who works with an AI agent.

## Requirements

- REQ-1: `docs/why-laneconductor.md`, linked from the README: short answer, origin with credits, a use-case table (tracker, tracker's coding agent, tracker's connector, plain Claude Code, LaneConductor), one worked example, alone versus with a tracker, who it is for and not for, sources.
- REQ-2: Every claim about another product links to its source and carries the check date (2026-11-17); no unverified claims (the Atlassian third-party-agent announcement returned 403 and is not used).
- REQ-3: No numbers that were not measured; factual tone.
- REQ-4: README: tagline, a "Where this comes from" section with credits, no stale command count.
- REQ-5: A short landing-page section with the same story. The owner sees the wording first; deploy only when the owner says so.

## Acceptance Criteria

- [x] AC-1: The docs page exists with the sections above and sources (commit dd495f3d).
- [x] AC-2: The README credits Conductor and Superpowers and links the page.
- [ ] AC-3: The owner reviewed the wording.
- [ ] AC-4: The landing section is added after the owner agrees.
- [ ] AC-5: Sources re-verified before a public release.
