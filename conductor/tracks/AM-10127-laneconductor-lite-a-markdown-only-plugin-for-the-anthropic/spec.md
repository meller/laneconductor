# Spec: LaneConductor Lite: a Markdown-only plugin for the Anthropic directory, with pointers to the full plugin

## Problem Statement

Decision (human, 2026-11-18): the directory portal's Validate (run 2026-11-18) blocks the full plugin for an organization that is not Verified (local MCP server, package.json and lockfile, scripts and .mjs files, package.json fields, the agent frontmatter key `isolation`). Discoverability needs a directory listing, so we publish a Markdown-only plugin, LaneConductor Lite, as a funnel. When something needs the full plugin (the board, conflict-checked writes, automatic commits, the privacy scan, health report), Lite says so and gives the install commands for the full plugin; the person runs them.

Build (generator profile in scripts/build-plugin.mjs, output committed under `plugins/laneconductor-lite/`, not added to the marketplace file):
1. Plugin identity: name `laneconductor-lite` (its own namespace `/laneconductor-lite:`), displayName `LaneConductor Lite`, same version as connector/package.json, honest description (the plan-first process in Markdown; the full plugin adds a board and safe writes). plugin.json keeps only fields the portal knows: remove unknown fields (the 2 warned about, probably documentationUrl and supportUrl; use homepage, repository, license, author, keywords) and add the listing field `privacyPolicyUrl`.
2. Only file types the portal accepts: Markdown, text, JSON, YAML, and PNG/JPEG/GIF/WebP/ICO. No .mcp.json, no package.json or lockfile, no .mjs, no scripts, no `conductor/` helper folder, no `server/`.
3. Agents: remove the `isolation` key (and any other frontmatter key the portal rejects; only `isolation` was reported but verify with the portal's allowed list in its message: plain key: value lines; unknown keys are blocked). `track-runner` then creates its own worktree first (`git worktree add`, with the person's agreement) and works there; keep the rule that it never merges or pushes.
4. Commands: the Lite commands do the same work by editing the track files directly, following the skill's `ops/tracks.md`; they must not mention connector tools or the board script as if present. `board`, `show-board` and `refresh-board` explain that the board needs the full plugin and show the install commands (below), and do nothing else.
5. The funnel, one source of truth: a skill file `FULL-PLUGIN.md` in the Lite skill: what the full plugin adds (board dashboard, conflict-checked writes so two sessions or people cannot overwrite each other, automatic commits, generated track summary, secret and personal-data scan, advice log and health report, scaffold script), and the install commands exactly: `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor@laneconductor`, then `/reload-plugins`; note to uninstall laneconductor-lite first (same skill, same track files, the files stay compatible); link https://github.com/meller/laneconductor. The Lite SKILL.md gets a short section: mention the full plugin only when relevant (the person asks for a board or dashboard, mentions several sessions or people editing the same tracks or worries about overwrites, or asks for automatic commits, a privacy scan or health report), once per session, as an option; never nag; NEVER run an install command yourself, show it and let the person run it. The Anthropic directory policy bans listings that exist primarily as advertising, so Lite must be genuinely useful on its own and the pointers short.
6. README of Lite (more than 40 words, honest): what it is and is not, what the full plugin adds, how to get it, that Lite makes no network requests, installs nothing, runs no scripts; LICENSE (copy of the repository's).
7. A short privacy policy page `docs/privacy.md` in this repository (what the plugins read and write, nothing leaves the machine, no analytics) used as `privacyPolicyUrl` (the GitHub URL of that file).
8. Tests: extend or replace `connector/test/directory-lean.test.mjs` so it emulates what the portal actually blocks, from the 2026-11-18 report (allowed file types only, no .mcp.json, no package.json or lockfile, no scripts or shebang lines, plugin.json known fields only, agent frontmatter without `isolation`, README length, LICENSE present, each file under 256 KiB, at most 512 files), applied to `plugins/laneconductor-lite`; `node scripts/build-plugin.mjs --check` covers the Lite folder too; the Lite command set equals the catalog; the board commands and README contain the install commands; no hard-coded command count in public text.
9. Verify: `cd connector && npm test`, `node scripts/build-plugin.mjs --check`, `claude plugin validate ./plugins/laneconductor-lite --strict`, and the existing full plugin still validates. Nothing is pushed or submitted by the implementer; the lead re-runs the portal Validate (a check only) and the owner submits.

Not in scope: the full plugin's content (unchanged), the remote connector, becoming a Verified organization (dropped as too complicated).

## The need

(To be filled in.)

## Who it is for

(To be filled in.)

## Wanted outcome

(To be filled in.)

## Acceptance criteria

(To be filled in.)

## Out of scope

(To be filled in.)
