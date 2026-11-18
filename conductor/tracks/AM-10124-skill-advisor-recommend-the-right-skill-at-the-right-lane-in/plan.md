# Track 10124: Skill advisor: recommend the right skill at the right lane, install it with consent

Seed: the lane-to-skill map from track 10123 (merged). Principles are in spec.md (second opinion, never wrap a skill, install only after an explicit yes each time, no silent settings edits, public sources only).

## Phase 1: Check what exists (gate) DONE 2026-11-18

- [x] Task 1: What the platform already offers (sources: Anthropic's plugin install page https://code.claude.com/docs/en/plugins/install.md, and the tool definitions in this desktop app)
- [x] Task 2: The smallest worthwhile build is decided (below)

### Findings (verified, with a correction to the research sub-agent)

What exists:
- Discovery and install UI on every surface: `/plugin` (Discover tab, marketplaces, scopes user, project and local), the desktop app's plugin browser, VS Code's plugin manager. In a session `/plugin install <name>@<marketplace>` does NOT install at once: it opens the plugin's details so the person reviews what it adds and chooses a scope. `/plugin install <name> --marketplace <source>` adds an unknown marketplace only after showing the source and asking to confirm.
- Shell install: `claude plugin install <name>@<marketplace> [--marketplace <source>] [--scope user|project|local]`, a reload is needed (`/reload-plugins`). Plugins that install by running a marketplace-named command ask the person to accept it (`--yes` skips that in scripts).
- `claude plugin details <name>` shows the always-on token cost of an installed plugin.
- Project scope: committing `enabledPlugins` in `.claude/settings.json` turns a plugin on for collaborators but does NOT download it; each person runs `claude plugin install ... --scope project` once per clone; Claude Code reports 'enabled in project settings but not installed'.
- In THIS desktop app a model has tools to search the person's claude.ai plugin catalog and skills (SearchPlugins, SearchSkills, ListPlugins, ListSkills) and to render an install card (SuggestPluginInstall) that the person clicks. They cover the person's claude.ai account and organization catalog, not arbitrary local or GitHub marketplaces.
- A model sees descriptions of INSTALLED skills only; uninstalled ones are invisible.

Correction: the research sub-agent said models cannot trigger plugin installation. In the desktop app a model can propose one through the install card (the person clicks), and in any session Claude can run `claude plugin install` through Bash under the normal Bash permission prompt. What does NOT exist: anything that knows the lane or the problem, and a recommendation for a plugin that is in a local or GitHub marketplace and not in the claude.ai catalog.

Decision (smallest worthwhile build): NO installer of our own. Build only (1) the curated, dated, lane-aware catalog (names, source marketplace, why, licence), (2) the rule for WHEN to recommend (lane start, a matching situation, on request), (3) the recommendation text that gives the exact built-in commands (`/plugin install <name> --marketplace <source>`, which opens the platform's own review-and-scope step) and, when the person says yes, may run `claude plugin install ... --scope local` through Bash under its normal permission prompt, (4) where the client has it, offer the install card for catalog plugins found by SearchPlugins, (5) an offer to add the plugin to the project's `.claude/settings.json` `enabledPlugins` so collaborators are told (a persistent settings change: always ask first, never silent).

## Phase 2: The catalog

- [ ] Task 1: Catalog format (one small JSON or Markdown file in the skill, dated): per lane and per problem type the skill name, source (marketplace and plugin, or repository), why it helps, licence, the install command
- [ ] Task 2: Seed it from the 10123 map (Superpowers skills, MIT) and check that every source exists and the named skill is really in it; record the date
- [ ] Task 3: A checker script that fails on a missing field, an unknown lane, a source that does not resolve, or a private-looking name; tests with fixtures

## Phase 3: When to recommend

- [ ] Task 1: A skill procedure `ops/skills.md`: detect what is installed (the session's skills list, `claude plugin list`), compare with the catalog for the current lane and situation, recommend only what is missing, with the reason, the source and the cost note (`claude plugin details` after installing)
- [ ] Task 2: Hook it into the lane guides: at lane start, and on a matching situation (a bug track, a failing quality gate, a review to answer, work that needs a worktree)
- [ ] Task 3: Declined answers are remembered per project outside git (under `.git/`, never committed), so a declined skill is not offered twice

## Phase 4: The install proposal

- [ ] Task 1: Propose, do not install: show the exact built-in command and what it adds; on an explicit yes run `claude plugin install ... --scope local` via Bash (the Bash permission prompt still applies), then remind to `/reload-plugins` and confirm it loaded
- [ ] Task 2: Failure is reported with the command and its output, never retried silently, never worked around by editing settings or permissions
- [ ] Task 3: A catalog entry and plugin command `/laneconductor:skills` (what is recommended for the current lane; install on request); coverage test; a dry run that prints the commands without running them
- [ ] Task 4: The optional offer to record the plugin in the project's `.claude/settings.json` (ask first; show the exact diff)

## Phase 5: Bundled skills, disclosure, release

- [ ] Task 1: Decide whether to bundle skills inside the plugin: only skills we wrote; a third-party skill is recommended and installed, not copied
- [ ] Task 2: README and plugin README say plainly that the plugin installs nothing without the person's yes, from the named sources, and what it runs (the directory's security scan reads this)
- [ ] Task 3: Version bump, regenerate, tests, build check, strict validate on the plugin and the marketplace

## Phase 6: Real use (HUMAN)

- [ ] Task 1: In a real session, open a bug track: the advisor recommends a debugging skill with a reason; say yes and confirm it installs and loads; say no on another and confirm it is not offered again
- [ ] Task 2: Record what was recommended, what was wrong or noisy, and whether the platform's own card was used

**Impact**: The person no longer has to know which skill to load; LaneConductor, which knows the lane, says so, and the platform's own install steps do the installing, only if the person asks.
