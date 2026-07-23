# Track 1080: MCP server for the Collector API

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned — ready for implement
**Type**: dev
**Summary**: A thin MCP (Model Context Protocol) server that wraps the existing Collector API (`localhost:8091`) — list/get/move/comment/create on tracks, plus inbox — so MCP clients without repo/filesystem access (Claude Desktop, other MCP agents) can drive LaneConductor directly, complementing (not replacing) the file-based skill. 8-tool v1 surface, local-api mode only, stdio transport (client owns process lifecycle — no daemon, no repeat of Track 1079's problem), MCP SDK version pinned given known protocol/SDK churn. remote-api/auth support is an explicit v2 non-goal.
