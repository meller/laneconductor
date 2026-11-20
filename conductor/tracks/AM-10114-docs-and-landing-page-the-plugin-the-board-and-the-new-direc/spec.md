# Spec: Docs and landing page: the plugin, the board, and the new direction

## Problem Statement

Update the public docs and the landing page so they describe LaneConductor as it is now, not as the Postgres-and-daemon product.

What changed and must be reflected:
- The direction: Claude plus git plus a connector. Tracks are files in git, the skill and the git-backed MCP connector are delivered together as one Claude plugin, the sync daemon and Postgres UI tier are experimental and currently unmaintained (kept at the git tag v1-legacy), and Claude manages the tracks.
- The plugin: install from the marketplace (meller/laneconductor) or by upload, what it contains (the laneconductor skill and the lc-connector, which runs locally in Claude Code and Cowork), what it does not do yet (no remote connector for claude.ai chat and mobile until the remote half exists), and how to update it.
- The board: a per-project dashboard published as a private Claude artifact, refreshed by asking Claude to "update the board", built from board.json by the board script (the `/laneconductor:board` command); a snapshot, not live; track detail view when it lands.
- The recipe library as a plugin and marketplace (lc-recipes), pending the discovery test.
- Safety and privacy: the writer rule, conflict checks, conversation.md stays per machine and ignored, the scan before documents are shown on a board.
- Setup: the setup command (`/laneconductor:setup`) and the new-project flow, per-repo state branch resolution (main or master), and what to do with the daemon.

Places to update: the repository README.md, conductor/product.md and conductor/tech-stack.md where they still describe the old model, the connector README, and the landing page under landing/ (landing/index.html and its posts). The landing page is currently being edited by the posts program track, so coordinate with that work and do not overwrite its uncommitted changes. Every claim must be checked against the current code and the plan, and anything not yet verified (for example the plugin in claude.ai chat, the Anthropic directory listing) is stated as not yet available. No screenshots or numbers that have not been measured.

## Requirements

- REQ-1 Direction: README, product.md, tech-stack.md, the wiki and the landing page describe LaneConductor as Claude plus git plus a connector, delivered as a Claude plugin; the daemon and Postgres UI tier are described as experimental and currently unmaintained (tag v1-legacy), and never as how the product works now.
- REQ-2 Install: the root README and the landing page give the install routes (marketplace commands, with `--scope local` and `--scope user`; upload of the zip), how to check it loaded, how to update, what works where (skill in chat, Cowork and Claude Code; connector and board script in Claude Code and Cowork only; remote connector not available), which branch the connector writes on and that it asks before pushing.
- REQ-3 Migration: a step-by-step migration for an existing project (install the plugin, confirm the connector loaded, remove the project's own skill link or user-level skill copy so the skill is not loaded twice, stop the project's worker if one runs).
- REQ-4 Board: what it is, the board script and "update the board", private artifact, snapshot not live, track detail when it lands, the privacy scan and what is withheld.
- REQ-5 Recipe library: as filed, the recipe library plugin and marketplace with the discovery test stated as pending. Superseded in the docs by the lane-to-skill map (see Decisions).
- REQ-6 Safety and privacy: the writer rule, conflict checks, conversation.md stays per machine, what the advice log holds.
- REQ-7 Setup: the setup command and the new-project flow, per-repo state branch resolution (main or master), and what to do with the daemon.
- REQ-8 Landing page: the old product description is replaced by the plugin story (one install, skill plus connector, board) with an Install section and links to the docs; edits coordinate with the posts program track (10112) and do not overwrite its uncommitted changes.
- REQ-9 Truthfulness: every claim is checked against the current code and the plan; anything not verified (the plugin in claude.ai chat, the Anthropic directory listing, the remote connector) is stated as not yet available; no screenshots or numbers that have not been measured.
- REQ-10 Download route: a Download button on the landing page and the README download route link to a published GitHub Release; the release steps need the human at each outward step.
- REQ-11 The connector README and the plugin README stay in sync (one source: connector/PLUGIN-README.md).

## Decisions

- The landing page is a patch of landing/index.html on its own branch that touches only the LaneConductor sections; it does not touch the showcase, the nav, firebase.json or posts/.
- No Download button and no release zip route yet: no release is published. The README gives the marketplace route and says no release zip exists yet; reword once a release exists.
- Deploy only when the owner says so.
- The recipe library wording was replaced in the landing, wiki and why page by the lane-to-skill map (git commit 8915eaa2); the README describes the lane-to-skill map and says solved problems are ordinary skills in the user's own plugin or marketplace.
- The connector and plugin READMEs are owned by another agent; this track only links to them.

## Acceptance criteria

- [x] The README describes the plugin direction and says the older stack is experimental and currently unmaintained (REQ-1; README lines 17-23, 191-216 checked).
- [x] product.md and tech-stack.md open with the plugin direction and install (REQ-1; checked). Both still use the word "legacy" for the old tier: owner decision, see report.
- [x] The README install section has the marketplace commands, `--scope local` and `--scope user`, the check and update commands, the upload route with the note that no release zip is published, and the what-works-where table (REQ-2).
- [x] The README has the migration steps for an existing project (REQ-3; README section after the board).
- [x] The README board section covers the private artifact, "update the board", the snapshot, the privacy scan and what is withheld (REQ-4). Track detail view: not verified.
- [x] The README states the writer rule, conflict checks, state branch resolution, no pushes without asking, conversation.md per machine and the advice log (REQ-6, REQ-7).
- [x] The landing page has the install commands in a copyable box and an Install section, and says what is not yet available (REQ-8, REQ-9; landing/index.html checked, the file also carries uncommitted edits from other tracks).
- [~] The README install section's download route points to a published release (REQ-10): moved to AM-10153.
- [~] The landing page has a Download button (REQ-10): moved to AM-10153.
- [~] The release process is carried out step by step with the human (REQ-10): moved to AM-10153.
- [~] The connector README and the plugin README stay in sync from one source (REQ-11): moved to AM-10153.
- [x] The landing page works on mobile and renders well in its themes (REQ-8): checked live at 375 px on 2026-11-20 (no horizontal overflow; one dark theme).
- [~] Every claim on the public pages is checked against the code (REQ-9): the full pass moved to AM-10153.
- [x] The wiki board section no longer uses the `lc` command (REQ-1): the remaining `lc` lines sit in the deprecated-tier sections under their deprecation notice (owner ruling 2026-11-19); AM-10153 confirms this.

## Risks and limits

- The Download button and the release steps wait for a published GitHub release; until then the public pages say the marketplace route is the way.
- The landing page is edited by the posts program track in parallel; a deploy from a working tree with another session's drafts would publish them.
- The recipe library wording and the experimental-tier wording may differ between pages (README, product.md, wiki); a final consistency pass is not done.

## Out of scope

- Screenshots or numbers that have not been measured.
- Deploying the landing page without the owner's say.
- Publishing a GitHub release (the human approves each outward step).
