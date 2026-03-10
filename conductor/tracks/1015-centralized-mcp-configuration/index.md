# Track 1015: Centralized MCP Configuration (Extension-Only)

**Lane**: backlog
**Lane Status**: success
**Progress**: 0%
**Phase**: Backlog
**Summary**: Provide specialized, project-specific MCP servers (e.g., knowledge base, browser) that are not natively supported by LLM CLIs.

## Problem
While modern agents (Claude Code, Gemini CLI) natively handle filesystem, bash, and git operations excellently, they lack access to specialized, project-specific tools (like a web browser for visual regression, or a semantic search over internal knowledge bases). Managing these specialized tools per-machine creates inconsistencies.

## Solution
Store an `mcp_servers` array in `.laneconductor.json` specifically for **"Extension-Only"** tools (excluding things the CLIs do better natively, like filesystem/git). The Sync Worker will inject a temporary MCP config file when spawning agents. This ensures all agents across all machines have access to the same specialized extensions without compromising their native CLI capabilities.

## Phases
- [ ] Phase 1: Config schema + DB column (`mcp_servers JSONB`)
- [ ] Phase 2: Sync worker — read + push mcp_servers to /project/ensure
- [ ] Phase 3: buildCliArgs() — inject MCP config file when spawning agents
- [ ] Phase 4: UI — project settings panel for MCP server management
- [ ] Phase 5: Docs + SKILL.md update
