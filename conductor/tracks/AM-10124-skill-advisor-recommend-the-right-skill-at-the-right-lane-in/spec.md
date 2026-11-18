# Spec: Skill advisor: recommend the right skill at the right lane, install it with consent

## Problem Statement

Idea (human, 2026-11-18): today Claude is missing something. When a person hits a problem, they have to know which skill to load; Claude sees only the descriptions of skills that are already installed and cannot recommend one that is not. LaneConductor knows the lanes, so it can recommend a skill at the right moment, and with the person's yes install it. LaneConductor is an orchestrator that knows skills; it never wraps or replaces them.

Principles: second opinion, not controller (a recommendation with a reason, never an order); nothing is installed without an explicit yes each time, showing the exact commands first; no silent edits to settings or permissions; the person's own plugin marketplaces and public sources only, never a private name in the shipped catalog; every recommendation says why and where the skill comes from.

Depends on track 10123 (the lane-to-skill map). Not before it.

## Requirements

The parts below were set as "parts to design in the plan lane" and are now written as requirements; the owner's simplification of 2026-11-18 (see Decisions) shapes how they are met.

- REQ-1 Catalog: a small curated catalog shipped in the plugin (Markdown or JSON, dated): per lane and per problem type (a failing test or a bug, a stuck plan, a review to answer, work that needs a worktree) the skill name, its source (marketplace and plugin, or repository), why it helps, its licence, and the install steps (`claude plugin marketplace add ...`, `claude plugin install ...`, then `/reload-plugins`). Every entry's source is checked to exist before it ships. Start with Superpowers (MIT) and the person's own marketplaces; the lane-to-skill map from track 10123 is the seed. The catalog entry fields agreed with the owner are listed in test.md TC-1.
- REQ-2 Detecting what is installed: use the plugin and skill listings Claude Code and the desktop app already offer (for example `claude plugin list`, the skills list in context). Recommend only what is missing, and never nag twice for one that was declined (remember the answer per project, outside git).
- REQ-3 When to recommend: at the start of a lane, when a lane guide sees a matching situation (a bug track, a failing quality gate, a review comment), by the project's stack (read from `conductor/tech-stack.md` and marker files), and on request (`/laneconductor:skills`, a catalog entry so every client gets it).
- REQ-4 The install flow: show what will be added and from where, ask, run the person's approved commands (scope local by default), remind to reload, confirm it loaded. Failure is reported, never retried silently.
- REQ-5 Curated set: recommend and install, bundle only skills we wrote. Third-party skills such as Superpowers are bundled only with the licence and attribution kept, or better not copied at all.
- REQ-6 Platform check: this desktop app already has plugin and skill search and a suggest-install card, and Claude Code has `/plugin`. The value to add is the lane-aware, curated map, not another installer. Verify what exists before building.
- REQ-7 Directory and safety: a plugin that can run an install is something the directory's security scan reads. The README must say plainly that it installs only after the person's yes, from the named sources, and what it runs.
- REQ-8 Plain text, at the moment of intent (owner, 2026-11-18): an offer is one or two plain sentences with each install command in its own bash fence; no forms; the work is never blocked by an offer; nothing is offered twice in a session; at most two items per offer. The cases are in test.md TC-4 to TC-10.
- REQ-9 Starter set at setup: `/laneconductor:setup` and `/laneconductor:new-project` end with three or four recommended plugins chosen from the project's stack and type, offered once. The cases are in test.md TC-11 and TC-12.
- REQ-10 The add-ons (laneconductor-parallel, laneconductor-board) are ordinary catalog entries with the same offer pattern, not special wording or code paths (test.md TC-13).
- REQ-11 The catalog covers every lane (test.md TC-14).
- REQ-12 Track context (owner, 2026-11-18): the advisor works on the current track (its lane, Type and stack), so the base skill has a short rule: when the person asks for real work (it changes files or takes more than a quick answer) and no track is in play, Claude says so in one sentence and offers to update the nearest existing track (search first; the default is "Update track N?"), create a new one, or go on without a track. Without a track the work is never blocked and nothing is created without a yes; small things (a question, a one-line fix, reading) get no offer; "no track" once means no more offers this session. The current track comes from the prompt, from a branch named after a track, or from the track this session has running. Cases: test.md TC-18 to TC-20.

## Decisions

- 2026-11-18 (owner): the plugin is meant to work in a track context by default, but a track is optional for small things. The rule is a soft offer in the base skill (REQ-12), not a lock: the base is Markdown only and cannot force it.
- 2026-11-18 (owner): the experience is simplified: plain text offers at the moment of intent, a starter set at setup, and the add-ons (parallel, board) are ordinary catalog entries, not special. The base is the discovery module (planning, implementation, setup); everything else is something it can offer.
- 2026-11-18: NO installer and NO registry of our own. Build only (1) a small, vetted, dated catalog (names, source, why, licence, the stack it applies to); (2) the rule for when to recommend: at a lane start, on a matching situation, and by the project's stack read from `conductor/tech-stack.md` and marker files (firebase.json, prisma/schema.prisma, a Vite config and similar); (3) the recommendation text with the exact built-in commands (`/plugin install <name> --marketplace <source>`, each shell command in its own bash fence so the desktop app shows a Run button), which the person runs, and on an explicit yes Claude may run `claude plugin install ... --scope local` via Bash under its normal permission prompt; (4) a fallback line: if nothing in the catalog fits, suggest a generic finder such as the `find-skills` skill (show the command, never run it, and say it is third-party and unvetted); (5) where the client has it, offer the install card for catalog plugins found by SearchPlugins; (6) an offer to add the plugin to the project's `.claude/settings.json` `enabledPlugins` (a persistent settings change: always ask first, never silent). The survey behind this decision is in plan.md Phase 1.
- 2026-11-18: Leaning, not decided: recommend and install, bundle only skills we wrote (REQ-5). Packaging of our own generic skills is pending, see track 10129: either one optional Markdown-only plugin in our marketplace, or a few themed ones installed per use case.

## Data model and API

- Catalog: one small JSON or Markdown file, dated. Entry fields as in test.md TC-1: name, kind (`addon`, `skillpack`, `thirdparty`), source, why, licence, `installs_code`, lane(s), track `Type`(s), stack tags, level (`prerequisite` or `helps`), install commands.
- Existing groundwork (from tracks 10128 and 10133): `connector/plugin-extras/recommended-plugins.json` is the one source of the add-on recommendations, with its own entry fields (name, kind, source, installs_code, why, setup_fit, detect, triggers) and a generator that writes the offer text from it; its comment says the advisor's skill packs and third-party skills will add entries there, not text. The setup text holds a reserved hook for the starter set.
- Declined list: per project, outside git (under `.git/`, never committed).
- Skill procedure: `ops/skills.md`; command `/laneconductor:skills`.

## Acceptance criteria

None is verified: no catalog beyond the add-on entries, no `ops/skills.md`, no `/laneconductor:skills` and no declined list exist yet (nothing found in the plugin folders or tests). The only part of Phase 1 delivered is the platform check recorded in plan.md.

- [ ] A catalog exists with the agreed fields and a checker that fails on a missing field, an unknown lane, an unresolvable source or a private-looking name (REQ-1). Not verified.
- [ ] Only missing skills are recommended, and a declined one is not offered again for the project (REQ-2). Not verified.
- [ ] Offers appear at lane start, on a matching situation, by stack, and on request (REQ-3). Not verified.
- [ ] The install is proposed with exact commands and never run without a yes; failure is reported and not retried (REQ-4). Not verified.
- [ ] Offers are plain text, never block the work, and are quiet (REQ-8). Not verified.
- [ ] Setup ends with a starter set of at most four, none already installed (REQ-9). Not verified.
- [ ] The base skill offers to update, create or skip a track for real work with no track, stays silent for small things, and never creates a track without a yes (REQ-12). Not verified.
- [ ] The add-ons are ordinary catalog entries (REQ-10). Not verified.
- [ ] Every lane is covered (REQ-11). Not verified.
- [ ] The README says plainly that nothing is installed without a yes, from which sources, and what it runs (REQ-7). Not verified.
- [ ] The real-use checks in test.md TC-15 to TC-17 pass (HUMAN). Not done.

## Risks and limits

- The platform already offers plugin discovery and a suggest-install card; the advisor must stay a lane-aware map and not become a second installer.
- A catalog goes stale; every source must be checked to exist and carry a date.
- Third-party skills and finders (for example `find-skills`) are unvetted; vet before naming one, and name no fallback if the vetting fails.
- Nagging: offers must stay quiet or people will ignore them.
- A plugin that can run an install is read by the directory's security scan, so the disclosure must be plain.
- The advisor shows only plugins from the person's own marketplaces and public sources; it cannot see skills that are not installed except through the catalog and the platform's own search.

## Open questions

- Catalog format (JSON or Markdown).
- Where the per-project declined list lives (never in git without the person's yes).
- Whether installs should be offered through the platform's own suggest-install card where the client has one.
- Whether to bundle any skills inside the plugin (see REQ-5 and track 10129).

## Out of scope

- Our own installer or skill registry.
- Wrapping or replacing a skill.
- Installing anything without an explicit yes each time, and silent edits to settings or permissions.
- Private marketplace or project names in the shipped catalog.
