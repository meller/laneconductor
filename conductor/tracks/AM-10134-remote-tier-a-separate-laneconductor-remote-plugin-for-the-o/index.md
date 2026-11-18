# Track AM-10134: Remote tier: a separate LaneConductor Remote plugin for the old remote, workers and Jira code

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Owner decision (2026-11-18): everything remote is separated from the base and from the new plugin-only way. A separate LaneConductor Remote plugin (or tier) can later create the remote LaneConductor, hold the workers architecture, the Jira connector and all other remote code. It is NOT part of the base, parallel or board plugins, and the setup must not mention it as part of the normal way. The code must not be lost: it is parked at git tag v1-legacy and must be moved to its new home, not deleted.

To decide (this is a brainstorm track, nothing is built before the owner answers):
1. What goes in: the sync daemon and workers (conductor/laneconductor.sync.mjs, conductor/services/*), the database tier (schema, collector API, ui/), the remote connector for claude.ai chat and phone (track 10121: GitHubStore, HTTP server, OAuth), the Jira connector (dropped earlier as "leave it to Atlassian"; decide whether it is revived here), the remote workers and VM provisioning tracks (1089, 1108).
2. Open question from the owner: "the plug architecture" (the owner is not sure whether it belongs to the remote tier). Ask what exactly is meant (the Fiti PLUG demo of track 10110, the plugin system itself, or a plug-in point for connectors) before placing it.
3. Where it lives: the same repo under a folder, a separate repo, or a plugin in the own marketplace only (never in the Anthropic directory, which blocks local MCP servers for non-verified orgs).
4. Mechanics: keep git history (subtree split or a tag-based move), keep the v1-legacy tag, and keep the daemon tests runnable in the new home.
5. What the base says about it: nothing in setup or in the lane guides; at most one line in the docs "remote and team features live in LaneConductor Remote".

Relates to: tracks 10121 (remote connector, backlog) and 10133 (plugin-only setup, removes old-scheme text from the shipped plugins). Do not delete any daemon code before this track is decided.
**Summary**: Owner decision (2026-11-18): everything remote is separated from the base and from the new plugin-only way. A separate LaneConductor Remote plugin (or tier) can later create the remote LaneConductor, 
