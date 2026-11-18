# Track 10124: Skill advisor: recommend the right skill at the right lane, install it with consent

Seed: the lane-to-skill map from track 10123. Principles are in spec.md (second opinion, never wrap a skill, install only after an explicit yes each time, no silent settings edits, public sources only).

## Phase 1: Check what exists (gate; build nothing before this)

- [ ] Task 1: Read what this app and Claude Code already offer for finding and installing plugins and skills (the plugin and skill search and suggest-install card in the desktop app, `/plugin`, `claude plugin list`, `claude plugin marketplace add`, `claude plugin install`, the skills listing available to a session). Record in spec.md what each does, which client has it, and what it cannot do (it does not know the lane or the problem).
- [ ] Task 2: Decide, and record in spec.md, the smallest thing worth building: most likely only the curated lane-aware catalog plus the rule for WHEN to recommend, using the platform's own install card or the plain commands. If the platform already recommends well in context, stop and say so.

## Phase 2: The catalog

- [ ] Task 1: Catalog format (one small JSON or Markdown file in the skill, dated): per lane and per problem type the skill name, source (marketplace and plugin, or repository), why it helps, licence, install steps
- [ ] Task 2: Seed it from the 10123 map (Superpowers skills, MIT) and check that every source exists (fetch or clone it) and that the named skill is really in it; record the date
- [ ] Task 3: A checker script that fails on a missing field, an unknown lane, a source that does not resolve, or a private-looking name; tests with fixtures

## Phase 3: When to recommend

- [ ] Task 1: A skill procedure `ops/skills.md`: detect what is installed (the session's skills list, `claude plugin list`), compare with the catalog for the current lane and situation, recommend only what is missing, with the reason and the source
- [ ] Task 2: Hook it into the lane guides: at lane start, and on a matching situation (a bug track, a failing quality gate, a review to answer, work that needs a worktree)
- [ ] Task 3: Declined answers are remembered per project, outside git (under `.git/`, never committed), so a declined skill is not offered twice

## Phase 4: The install flow

- [ ] Task 1: Show exactly what will be added and from where (the marketplace, the plugin, the scope, local by default), ask, and only on an explicit yes run the commands; remind to `/reload-plugins`; confirm it loaded
- [ ] Task 2: Failure is reported with the command and its output, never retried silently, never worked around by editing settings or permissions
- [ ] Task 3: A catalog entry and plugin command `/laneconductor:skills` (list what is recommended for the current lane, install on request) so every client gets it; coverage test; a dry-run that prints the commands without running them

## Phase 5: Bundled skills, disclosure, release

- [ ] Task 1: Decide whether to bundle skills inside the plugin: only skills we wrote; a third-party skill is recommended and installed, not copied (record the decision in spec.md)
- [ ] Task 2: README and plugin README say plainly that the plugin installs nothing without the person's yes, from the named sources, and what it runs (the directory's security scan reads this)
- [ ] Task 3: Version bump, regenerate, tests, build check, strict validate on the plugin and the marketplace

## Phase 6: Real use (HUMAN)

- [ ] Task 1: In a real session, open a bug track: the advisor recommends a debugging skill with a reason; say yes and confirm it installs and loads; say no on another and confirm it is not offered again
- [ ] Task 2: Record what was recommended, what was wrong or noisy, and whether the platform's own card was used

**Impact**: The person no longer has to know which skill to load; LaneConductor, which knows the lane, says so, and installs it only if asked.
