# Spec: Docs and landing page: the plugin, the board, and the new direction

## Problem Statement

Update the public docs and the landing page so they describe LaneConductor as it is now, not as the Postgres-and-daemon product.

What changed and must be reflected:
- The direction: Claude plus git plus a connector. Tracks are files in git, the skill and the git-backed MCP connector are delivered together as one Claude plugin, the sync daemon and Postgres UI tier are parked (tag v1-legacy), and Claude manages the tracks.
- The plugin: install from the marketplace (meller/laneconductor) or by upload, what it contains (the laneconductor skill and the lc-connector, which runs locally in Claude Code and Cowork), what it does not do yet (no remote connector for claude.ai chat and mobile until the remote half exists), and how to update it.
- The board: a per-project dashboard published as a private Claude artifact, refreshed by asking Claude to "update the board", built from board.json by the lc board command; a snapshot, not live; track detail view when it lands.
- The recipe library as a plugin and marketplace (lc-recipes), pending the discovery test.
- Safety and privacy: the writer rule, conflict checks, conversation.md stays per machine and ignored, the scan before documents are shown on a board.
- Setup: lc setup and the new-project flow, per-repo state branch resolution (main or master), and what to do with the daemon.

Places to update: the repository README.md, conductor/product.md and conductor/tech-stack.md where they still describe the old model, the connector README, and the landing page under landing/ (landing/index.html and its posts). The landing page is currently being edited by the posts program track, so coordinate with that work and do not overwrite its uncommitted changes. Every claim must be checked against the current code and the plan, and anything not yet verified (for example the plugin in claude.ai chat, the Anthropic directory listing) is stated as not yet available. No screenshots or numbers that have not been measured.

## Requirements

(To be written in the plan lane.)
