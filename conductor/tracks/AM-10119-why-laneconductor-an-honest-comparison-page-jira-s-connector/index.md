# Track AM-10119: Why LaneConductor: an honest comparison page (Jira's connector, Linear, community plugins, plain Claude)

**Lane**: review
**Lane Status**: queue
**Progress**: 70%
**Phase**: Docs page written (docs/why-laneconductor.md and README origin section, commit dd495f3d), not pushed. Open: the owner's review of the wording, the short landing section (needs the owner's go; landing/index.html has another session's uncommitted edits), re-verify sources before any release.
**Track Kind**: feature
**Type**: marketing
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10114
**Problem**: People will ask why they would use LaneConductor when their tracker already has a Claude connector or plugin. We need one honest, sourced "why use it and when not to" page (docs and landing) that compares the options and positions the real difference: where the plan lives and who owns the system of record.

Facts gathered 2026-11-17 (web search, to be re-verified with the official pages before publishing): Atlassian hosts a remote MCP server (the Rovo MCP server) that exposes Jira, Confluence and Compass to MCP clients including Claude, with OAuth; a Claude Code setup line exists for the hosted server. Claude's plugin marketplace lists a Linear plugin. Community plugins exist for Jira with spec-driven and TDD workflows, and some sync Jira task trees with local state in both directions. So "access to Jira from Claude" and even "local copy of Jira tasks" are not unique to us.

The comparison should therefore be about different jobs: (1) a tracker's connector gives Claude access to issues in a cloud system of record; (2) LaneConductor keeps the specs, plans and tests as files in git next to the code (local-first, works offline, versioned and reviewed with the code, branchable), with lanes and guidance, conflict-safe writes across sessions, one subagent per track in its own worktree, a private board, recipes of known solutions, and a privacy scan; (3) together: work locally, then mirror to the tracker through its connector (track 10118, the `laneconductor-jira` add-on).

Rules for the page: every claim about another product is sourced and dated; no negative claims we cannot verify ("nobody else does X" is not allowed unless checked); say plainly when someone should NOT use LaneConductor (a team whose process lives entirely in Jira, no use of Claude, no wish to keep plans in the repo); include a small table (what it is, where plans live, offline, who it is for, cost of setup) and the combined workflow; no numbers that were not measured; keep tone factual, not promotional.

Where it lives: a docs page (`docs/why-laneconductor.md`) linked from the README, and a short section on the landing page (coordinate with tracks 10114 and 10112). Depends on 10114 (docs rewrite) so the claims match.
**Summary**: People will ask why they would use LaneConductor when their tracker already has a Claude connector or plugin. We need one honest, sourced "why use it and when not to" page (docs and landing) that comp
**Priority**: high
