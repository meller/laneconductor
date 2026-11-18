# Track 10124: Skill advisor: recommend the right skill at the right lane, install it with consent

Seed: the lane-to-skill map from track 10123 (merged). Principles are in spec.md (second opinion, never wrap a skill, install only after an explicit yes each time, no silent settings edits, public sources only).

## Phase 1: Check what exists (gate) DONE 2026-11-18

- [x] Task 1: What the platform already offers (sources: Anthropic's plugin install page https://code.claude.com/docs/en/plugins/install.md, and the tool definitions in this desktop app)
- [x] Task 2: The smallest worthwhile build is decided (below)
- [x] Task 3: Registry survey (2026-11-18, web search; not yet vetted for quality or security)

### Findings (verified, with a correction to the research sub-agent)

What exists on the platform:
- Discovery and install UI on every surface: `/plugin` (Discover tab, marketplaces, scopes user, project and local), the desktop app's plugin browser, VS Code's plugin manager. In a session `/plugin install <name>@<marketplace>` does NOT install at once: it opens the plugin's details so the person reviews what it adds and chooses a scope. `/plugin install <name> --marketplace <source>` adds an unknown marketplace only after showing the source and asking to confirm.
- Shell install: `claude plugin install <name>@<marketplace> [--marketplace <source>] [--scope user|project|local]`, a reload is needed (`/reload-plugins`). Plugins that install by running a marketplace-named command ask the person to accept it (`--yes` skips that in scripts).
- `claude plugin details <name>` shows the always-on token cost of an installed plugin.
- Project scope: committing `enabledPlugins` in `.claude/settings.json` turns a plugin on for collaborators but does NOT download it; each person runs `claude plugin install ... --scope project` once per clone.
- In THIS desktop app a model has tools to search the person's claude.ai plugin catalog and skills (SearchPlugins, SearchSkills, ListPlugins, ListSkills) and to render an install card (SuggestPluginInstall) that the person clicks. They cover the person's claude.ai account and organization catalog, not arbitrary local or GitHub marketplaces.
- A model sees descriptions of INSTALLED skills only; uninstalled ones are invisible.

Correction: the research sub-agent said models cannot trigger plugin installation. In the desktop app a model can propose one through the install card (the person clicks), and in any session Claude can run `claude plugin install` through Bash under the normal Bash permission prompt. What does NOT exist: anything that knows the lane or the problem.

Skill registries and finders that already exist (third-party; vet before recommending): the `find-skills` skill from Vercel Labs (`npx skills add vercel-labs/skills --skill find-skills`; it searches the skills.sh directory, clawhub.ai and GitHub and shows install commands, with an optional security scan); the skills.sh CLI (`npx skills find`, `add`, `list`, `check`); MCP servers that search skills semantically (for example claude-skills-mcp, a Skills Registry MCP, mcp-skillset, Skillsmith, Skillselion); aggregator sites. So a general registry is NOT ours to build.

Decision (smallest worthwhile build): NO installer and NO registry of our own. Build only (1) a SMALL, vetted, dated catalog (names, source, why, licence, the stack it applies to), (2) the rule for WHEN to recommend: at a lane start, on a matching situation, AND by the project's stack read from `conductor/tech-stack.md` and marker files (firebase.json, prisma/schema.prisma, a Vite config and similar), which LaneConductor already maintains, (3) the recommendation text with the exact built-in commands (`/plugin install <name> --marketplace <source>`, each shell command in its own bash fence so the desktop app shows a Run button), the person runs them; on an explicit yes Claude may run `claude plugin install ... --scope local` via Bash under its normal permission prompt, (4) a fallback line: if nothing in the catalog fits, suggest a generic finder such as the `find-skills` skill (show the command, never run it, and say it is third-party and unvetted), (5) where the client has it, offer the install card for catalog plugins found by SearchPlugins, (6) an offer to add the plugin to the project's `.claude/settings.json` `enabledPlugins` (a persistent settings change: always ask first, never silent).

Packaging of our own generic skills (decision pending, see track 10129): either one optional Markdown-only plugin in our marketplace, or a few themed ones installed per use case (for example GCP and Firebase hosting; AI and Gemini; web app: PWA, cache buster, sign-in; data: Postgres, Prisma, test database). Themed packs keep the always-on description cost small because people install only what they use, and the stack-aware recommendation above is what tells a project which pack it needs.

## Phase 2: The catalog

- [x] Task 1: Catalog format (one small JSON or Markdown file in the skill, dated): per lane, per problem type and per stack tag the skill or pack name, source (marketplace and plugin, or repository), why it helps, licence, the install command
- [x] Task 2: Seed it from the 10123 map (Superpowers skills, MIT) and our own generic packs once they exist; check that every source exists and the named skill is really in it; record the date
- [x] Task 3: A checker script that fails on a missing field, an unknown lane, a source that does not resolve, or a private-looking name; tests with fixtures
- [x] Task 4: Vet `find-skills` (read its SKILL.md and what it runs, its licence, whether it needs `npx`) before it is named as the fallback; record the verdict; if it fails the vetting, name no fallback

## Phase 3: When to recommend

- [x] Task 1: A skill procedure `ops/suggest-skills.md`: detect what is installed (the session's skills list, `claude plugin list`), read the project's stack from `conductor/tech-stack.md` and marker files, compare with the catalog for the current lane, situation and stack, recommend only what is missing, with the reason, the source and the cost note (`claude plugin details` after installing)
- [x] Task 2: Hook it into the lane guides: at lane start, and on a matching situation (a bug track, a failing quality gate, a review to answer, work that needs a worktree), and in `/laneconductor:new-project` once the stack is known
- [x] Task 3: Declined answers are remembered per project outside git (under `.git/`, never committed), so a declined skill is not offered twice

## Phase 3b: Track context (REQ-12)

- [x] Task 1: A short rule in the base skill (a few lines, same text source as the other offers): real work with no track in play gets one sentence and three ways in (update the nearest track, create one, go on without one); small things get nothing; never blocks; never creates without a yes; "no track" once silences it for the session
- [x] Task 2: How the current track is found (the prompt, a branch named after a track, the track this session has running) written once and used by the advisor, `next` and the lane guides; text tests (TC-18 to TC-20)

## Phase 4: The install proposal

- [x] Task 1: Propose, do not install: show the exact built-in command in its own bash fence and what it adds; the person runs it (the base never runs an install), then remind to `/reload-plugins` and confirm it loaded
- [x] Task 2: Failure is reported with the command and its output, never retried silently, never worked around by editing settings or permissions
- [x] Task 3: A catalog entry and base command `/laneconductor:suggest-skills` (what is recommended for the current lane and stack; install on request); coverage test; a dry run that prints the commands without running them
- [x] Task 4: The optional offer to record the plugin in the project's `.claude/settings.json` (ask first; show the exact diff)

## Phase 5: Disclosure, release

- [x] Task 1: README and plugin README say plainly that the plugin installs nothing without the person's yes, from the named sources, and what it runs (the directory's security scan reads this)
- [x] Task 2: Version bump, regenerate, tests, build check, strict validate on the plugins and the marketplace

## Phase 6: Real use (HUMAN)

- [ ] Task 1: In a real session, open a bug track: the advisor recommends a debugging skill with a reason; say yes and confirm it installs and loads; say no on another and confirm it is not offered again
- [ ] Task 2: In a project with firebase.json, the advisor recommends the matching pack from the stack, once
- [ ] Task 3: Record what was recommended, what was wrong or noisy, and whether the platform's own card was used

**Impact**: The person no longer has to know which skill to load; LaneConductor, which knows the lane and the stack, says so from a small vetted list, points to a finder for the rest, and the platform's own install steps do the installing, only if the person asks.
