# Track AM-10116: Command catalog as MCP prompts (the FITI pattern) and bug and feature forms

**Lane**: done
**Lane Status**: success
**Progress**: 95%
**Phase**: Closed by the owner 2026-11-22 with one open human task: AC-5 (in a real client a prompt such as help appears and returns the list, and /laneconductor:bug creates a bug track) was not run. The code is on main; quality gate passed.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10106, 10115
**Problem**: Commands exist twice today: as hand-written plugin command files (Claude only) and as skill routing rows. The agent-neutral way is the FITI pattern: the connector exposes each command as an MCP prompt (prompts/list, prompts/get) plus a help prompt with example phrases. Any MCP client then sees the same commands, including claude.ai and mobile through the remote connector, where plugin commands do not exist. The plugin's command files should then be GENERATED from the same catalog, so there is one source of truth.

Also: "flag a bug" and "feature request" only set a `track_kind` marker today. Both create the same generic spec skeleton. They should create real forms: a bug form (symptom, steps to reproduce, expected, actual, suspected area, environment) and a feature form (the need, who it is for, the wanted outcome, acceptance criteria, out of scope), with a bug track's test.md starting with a regression-test case.

Reference: ~/Code/fiti/functions/src/mcp.js (server.registerPrompt, the prompts table, aliases) and its `help` tool.
**Summary**: One command catalog in the connector served as MCP prompts and a help prompt, plugin commands generated from it, and real bug and feature forms for new tracks.
