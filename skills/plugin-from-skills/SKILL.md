---
name: plugin-from-skills
description: "Package your skills into Claude plugins, publish them from your own marketplace, and optionally submit a Markdown-only plugin to Anthropic's plugin directory: a skills folder, a pack list, a small generator, the local checks, the portal steps and answers, and what to do about policy holds."
when_to_use: "Use when someone has skills or commands to share as a plugin, wants a plugin marketplace of their own, wants to submit a plugin to Anthropic's plugin directory, is about to open the directory portal, or met a policy hold or a Validate warning there; also when a project should ship its own plugin."
metadata:
  kind: process
  stack: [claude-plugin, marketplace, anthropic-directory]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The `claude` command line is installed, and the skills exist as `skills/<name>/SKILL.md`.
    - For the directory, a public GitHub repository, a public privacy page, and an account that may submit (the owner's) are needed.
  verified: 2026-11-20
  smoke_check: claude plugin validate --help
---

## Why this works
Observed in the author's own projects with LaneConductor: one repository ships a marketplace and
several Markdown-only plugins built by a small generator from a `skills/` folder, and one such plugin
went through Anthropic's directory portal (scan passed; a reviewer decision was still pending when
this was written). Generating the plugin folders, and checking them against the disk before every
push, means a skill is never copied by hand and a plugin never drifts from its source.

## Recommendation
- Layout: `skills/<name>/SKILL.md` (plus optional `files/`), a pack list `scripts/skill-packs.json`
  (copy `files/skill-packs.json.tmpl`; each skill in exactly one pack), and the generator
  `scripts/build-plugin.mjs` (copy `files/build-plugin.mjs.tmpl`). It writes `plugins/<pack>/`
  (`plugin.json`, the skills byte for byte, a README, the LICENSE, an icon if `scripts/icon.png`
  exists) and `.claude-plugin/marketplace.json`; `--check` compares with the disk and fails on any
  difference. Add a `LICENSE` and a square `scripts/icon.png`.
- Group skills by what a person wants to install, not all in one plugin: every installed skill adds
  its listing to each session (the author measured about 120 to 620 tokens per pack).
- Give plugin names a prefix, not the bare skill name: a plugin and a skill with one name show as
  `name:name` in the `/` menu.
- `plugin.json` keys: name, displayName, version, description, author, homepage, repository, license,
  keywords, `privacyPolicyUrl`. Do not add `documentationUrl` or `supportUrl`: the portal warned
  they are unrecognized. Each pack keeps its own version.
- Checks before every push: `claude plugin validate --strict <plugin>` for each plugin and for the
  repository root (the marketplace), and `claude plugin validate --profile directory <plugin>` for
  the one going to the directory. Then a clean install in a throwaway profile:
  `CLAUDE_CONFIG_DIR=<empty dir> claude plugin marketplace add <owner>/<repo>`, then
  `claude plugin install <plugin>@<marketplace>`, `claude plugin list` and
  `claude plugin details <plugin>` (components and the always-on token cost).
- For Anthropic's directory, only a Markdown-only plugin from an unverified publisher qualified.
  The portal's own reports blocked: a local MCP server (`.mcp.json`), package files and lockfiles,
  any file that is not Markdown, text, JSON, YAML or a PNG/JPEG/GIF/WebP/ICO image, and the agent key
  `isolation`. Skill frontmatter may use only `name`, `description`, `when_to_use` and
  `argument-hint`, as plain `key: value` lines; a skill with `metadata` or `paths` installs from
  your own marketplace but not from the directory. Add a README, a licence, a square icon and a
  public privacy page.
- The portal (claude.ai/directory/manage/new/plugin) has six steps: Source (repository and plugin
  folder, then Validate), Content (a read-only overview), Listing (read from `plugin.json` and the
  README), Data handling (four questions), Compliance (a contact email and four confirmations),
  Review and submit. Answer Data handling from what the plugin really does; a Markdown-only plugin
  with no network access reads only, sends nothing and retains nothing.
- After a successful Validate do not push to the tracked branch before Submit: the report goes stale
  ("Source doesn't match") and must be re-run. After submission each later commit to the branch is
  picked up about every 6 hours as a new version of the same number and scanned again, so batch
  pushes until there is a decision. A first version is published by a reviewer, never automatically.

## Claude does
- Set up the layout from the templates, run the generator and the checks, run the clean-install
  test, read the portal's steps and fields without answering, and draft the Data handling answers
  and the README facts from the plugin's real behaviour.

## You run
- Everything in the portal: the account, Validate, the Data handling answers, the contact email, the
  four confirmations, the terms and the final Submit. Claude never ticks, accepts or submits.
- `git push` of the repository, when you decide.

## Pitfalls
- A credential folder name next to a URL in command text (a `.vercel` line in a deploy guide's
  `.gitignore` list, with a documentation URL elsewhere) was read as a credential being forwarded and
  held the submission; the hold cleared after the mention was removed. Keep words such as `.env`,
  tokens and credentials away from URLs in shipped text.
- A README sentence that ends right after a URL (`... is https://example.com/privacy.`) made the
  portal's documentation link include the period and break. Put each URL on its own line.
- A publisher name that resembles another publisher gets a policy hold that only a reviewer can
  release; no fix exists on your side.
- "Files the policy review couldn't cover" means some files were too large or too many to read; it
  held a plugin with 23 commands, one about 66 KB. The portal says no action is needed unless asked;
  trimming large text is the lever.
- `claude plugin validate` passing does not predict the portal: the portal also runs a safety scan
  and a policy review that no local command runs.
- The portal form lives only in its browser tab until saved; closing a tab can raise a "leave this
  site?" dialog that blocks browser automation.
- Do not say a plugin is listed anywhere, in a README or on a site, until a reviewer has published it.

## Unproven
- Whether a plugin passes the review: the first submission was still in review on 2026-11-20.
- The file limits (256 KiB per file, 512 files) and the hook rule come from an earlier portal run and
  the author's emulation of it, not from published documentation; re-check them before relying on them.
- How a reviewer treats a plugin with many or large commands: no comment had been made.
