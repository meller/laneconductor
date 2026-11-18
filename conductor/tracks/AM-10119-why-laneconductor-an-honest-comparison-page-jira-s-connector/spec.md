# Spec: Why LaneConductor: an honest comparison page (use cases, not a tracker fight)

## Problem Statement

People will ask why they would use LaneConductor when their tracker (Jira, Linear, Azure DevOps) already has a Claude connector or even its own coding agent. We need one honest, sourced page (docs and landing) that explains the different jobs, where LaneConductor comes from, who it is for and who it is not for.

## Requirements

- REQ-1: `docs/why-laneconductor.md`, linked from the README: short answer, origin with credits, a use-case table (tracker, tracker's coding agent, tracker's connector, plain Claude Code, LaneConductor), one worked example, alone versus with a tracker, who it is for and not for, sources.
- REQ-2: Every claim about another product links to its source and carries the check date (2026-11-17); no unverified claims (the Atlassian third-party-agent announcement returned 403 and is not used).
- REQ-3: No numbers that were not measured; factual tone.
- REQ-4: README: tagline, a "Where this comes from" section with credits, no stale command count.
- REQ-5: A short landing-page section with the same story. The owner sees the wording first; deploy only when the owner says so.
- REQ-6: The page says plainly when someone should NOT use LaneConductor, and never claims "ticket to pull request" as ours or that another product cannot do something.

## Decisions

- 2026-11-17 (human, positioning): origin: LaneConductor combines Gemini CLI's Conductor (conventions: context files, spec and plan per track) and Superpowers by Jesse Vincent (process: brainstorm, plan, sub-agents, verify), and adds a Kanban view. When it started the author did not find a Conductor for Claude or a Superpowers for Gemini. Ports of both for other agents have appeared since (so never write "does not exist"). Credit both openly.
- 2026-11-17 (human): "Jira" stands for the whole product-management category (Jira, Linear, Azure DevOps, ...). Their job is the product view; this is a different use case, so the page compares use cases, not features.
- 2026-11-17 (human): we do NOT compete with ticket-to-pull-request agents. Atlassian's Jira Coding Agent turns a work item into a draft pull request in a vendor cloud sandbox (needs a Standard or Premium plan and Rovo credits). The page must never claim "ticket to pull request" as ours, and never claim another product cannot do something.
- 2026-11-17 (human): a small team can use LaneConductor alone; a larger one can add a tracker later. A tracker add-on (10118) is planned, not built, and nothing on the page depends on it. Later change, as the page now stands (commit b20fd6f7): the page says LaneConductor ships no tracker connector of its own and that the vendor's connector is used next to it.
- 2026-11-17 (human): not for a team whose process lives entirely in Jira and that does not use AI agents. For everyone else who works with an AI agent.
- Facts gathered 2026-11-17 (web search, to be re-verified with the official pages before publishing): Atlassian hosts a remote MCP server (the Rovo MCP server) that exposes Jira, Confluence and Compass to MCP clients including Claude, with OAuth. Claude's plugin marketplace lists a Linear plugin. Community plugins exist for Jira with spec-driven and TDD workflows, and some sync Jira task trees with local state in both directions. So "access to Jira from Claude" and "local copy of Jira tasks" are not unique to us; the comparison is about different jobs: a tracker's connector gives Claude access to issues in a cloud system of record; LaneConductor keeps the specs, plans and tests as files in git next to the code (local-first, works offline, versioned and reviewed with the code, branchable) with lanes and guidance, conflict-safe writes across sessions, one subagent per track in its own worktree, a private board and a privacy scan; together, work locally and use the tracker's own connector.
- Depends on 10114 (docs rewrite) so the claims match.
- Open for the owner: the review of the wording; whether and when the landing section is added (landing/index.html carries another session's uncommitted edits).

## Acceptance criteria

- [x] The docs page exists with the sections above (short answer, origin, use-case table, example, alone or with a tracker, who it is for and not for, sources) and the Conductor and Superpowers credits (REQ-1; docs/why-laneconductor.md, commit dd495f3d and later).
- [x] The README credits Conductor and Superpowers and links the page (REQ-4; README lines 28-46 and 201).
- [x] The page carries a Sources section with the check date 2026-11-17 and links for each product it describes (REQ-2).
- [x] The page names who it is not for and that ticket-to-pull-request agents are a better fit for that job (REQ-6).
- [ ] Every sourced statement matches the live source: not verified here (the sources were not re-fetched); re-verify before any release.
- [ ] The owner reviewed the wording: not verified.
- [ ] The landing section is added after the owner agrees (REQ-5): not done, landing/index.html has no section for it.
- [ ] No unmeasured numbers anywhere on the page (REQ-3): not verified by a full read.

## Risks and limits

- Claims about other products go stale; the page carries the check date and the sources must be re-verified before any release.
- A negative claim about another product ("cannot do X") is not allowed unless checked; the page stays factual and describes what the sources say.
- The landing page is edited by other tracks in parallel; a deploy from a tree with another session's drafts would publish them.

## Out of scope

- A tracker integration or add-on of our own (the page says LaneConductor ships none).
- Competing with ticket-to-pull-request agents.
- Deploying the landing page without the owner's say.
