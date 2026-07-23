# Track 1080: MCP server for the Collector API

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Backlogged — no active MCP client needs this yet
**Type**: dev
**Summary**: Thin MCP (stdio) server wrapping the existing `localhost:8091` REST API (list/get/move/comment/create tracks + inbox), for MCP clients without repo/filesystem access (Claude Desktop, etc.). Backlogged: Claude Code already reads/writes track files directly via the filesystem — no API/MCP involved in that path — so this only matters once there's an actual MCP client that needs it, and adding it now would mean maintaining a second, API-first interaction path alongside this project's filesystem-first design rather than just adding a feature. Spec/plan/test.md preserved for when it's needed.
