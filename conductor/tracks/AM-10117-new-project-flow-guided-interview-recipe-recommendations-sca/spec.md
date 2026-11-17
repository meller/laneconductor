# Spec: New-project flow: guided interview, recipe recommendations, scaffold, and add-a-recipe

## Problem Statement

A person starting a new project gets only the legacy `setup` command today. The old CLI wizard (a brainstorm interview, then scaffold generation) is not in the plugin, and the recipe library (things already solved in this person's stack) is not connected to any flow. The scaffold procedure already lives in the skill (`setup/scaffold.md`, templates in `setup/templates.md`); what is missing is the guided interview, a command entry point, and recipes.

Decision (human, 2026-11-17): the new-project flow is part of the SKILL, and the recipes become part of it too.

## Design

- The flow is a skill procedure `ops/new-project.md` plus the command `/laneconductor:new-project` (a catalog entry in track 10116's catalog) that points at it. It reuses `lanes/brainstorm.md` for the interview style and `setup/scaffold.md` for the generation.
- Recipes live INSIDE the skill as on-demand resources: `skills/laneconductor/recipes/<name>/SKILL.md` plus `files/`. They are nested under the laneconductor skill, so they are NOT registered as separate skills and cost no always-on tokens; the new-project procedure (and `/laneconductor:recipes`) reads them when needed. The recipe FORMAT is the one already proven in `~/Code/lc-recipes` (README format rules; description + when_to_use under 1,536 characters; `metadata` map with stack, prerequisites, references, verified, kind; sections: why this works for you, you run, Claude does, pitfalls, unproven).
- Two libraries, read in this order: (1) the shipped library inside the plugin (generic recipes only), (2) the person's own library, a local git repo named by `recipes.path` in `.laneconductor.json` or the `LC_RECIPES` environment variable (read-only for the flow; `add-recipe` writes to it with the person's agreement). Personal recipes (project ids, site names, private repo references) stay in the personal library and are never shipped.
- PRIVACY GATE: a recipe may be shipped inside the public plugin only after (a) the secret/email/phone scan is clean, (b) it names no private project id, site, repository or person, or those are replaced by `{{vars}}`, and (c) the human approved that recipe for publication in the track. Today's nine library recipes are NOT shipped until each passes this gate; the first candidates are the ones with no private names after review.
- The flow works with no recipe at all and says so.

## Requirements

- REQ-1 (`/laneconductor:new-project [name or idea]`): (a) detect the situation: an empty or new folder, or an existing repository (then offer to add only the `conductor/` scaffold); (b) interview in chat, one question at a time, adaptive, short: what it is for, who uses it, the three key features, language and stack, data, auth, hosting and deploy target, AI use, testing, constraints; stop early when answers are enough; (c) recommend recipes (REQ-2); (d) scaffold (REQ-3); (e) create the first tracks in the plan lane (REQ-4); (f) summarize and ask before any commit; never push.
- REQ-2 (recommend, never order): match the interview answers against each recipe's `metadata.stack` and `prerequisites`; show at most five with one line of why, its `verified` date and any freshness warning (a cited reference changed since verification); the person picks; deviations are allowed and the reason is noted in the new project's first track conversation. Nothing is applied silently.
- REQ-3 (scaffold): create, from the skill templates and tailored to the interview: `conductor/product.md`, `tech-stack.md`, `workflow.md` and `workflow.json`, `product-guidelines.md`, `design-language.md`, `quality-gate.md` (commands that really exist in the chosen stack), `user-stories.md`, `kpis.md`, `tracks/`, `.laneconductor.json` (state branch, no database), `.gitignore` entries (conversation.md ignored), git init when needed. No daemon, no database.
- REQ-4 (first tracks): one plan-lane track per chosen recipe ("Apply recipe X") with the recipe's You-run steps as the human's tasks, plus a walking-skeleton track; created through the connector when present, else by writing the track files.
- REQ-5 (apply a recipe): follow the recipe's Claude-does section; render its `files/` with `{{var}}` from the interview; the recipe's You-run steps (sign-in, secrets, deploy) are shown to the human to run, never done by Claude; two recipes that write the same path are reported as a conflict, never merged silently.
- REQ-6 (`/laneconductor:add-recipe [what was solved]`): extract a recipe: criteria (reusable, verified in real use, not obvious to a plain Claude, names a real incident or fact), find-before-add (search both libraries, update instead of duplicating), draft in the recipe format, run the checker (format, secrets, references resolve) and show the result, ask the human, save to the PERSONAL library as a commit (never pushed), with a retire/update path.
- REQ-7 (checker): the recipe format checker and secret scanner built in track 10107 Phase 2 (`lc-recipe-check`) ship with the plugin; add-recipe and the privacy gate use them.
- REQ-8 (discovery test, answers 10107 Phase 3c): run the flow on a scratch project with the personal library present and record whether the right recipes were recommended without being named; this is the evidence for keeping or dropping `find_recipe` and `bootstrap_project`.

## Out of scope

A remote (chat or mobile) version of the flow; recipes for other agents (the neutral core stays free of Claude-only assumptions); hosting or deploying anything for the person.

## Acceptance Criteria

- [ ] AC-1: In a new empty folder, `/laneconductor:new-project a habit tracker` runs the interview, scaffolds the conductor files and creates the first tracks, and asks before committing.
- [ ] AC-2: With a personal library present, the matching recipes are recommended with reasons and nothing is applied until chosen; without one, the flow completes and says no recipes were available.
- [ ] AC-3: Applying a recipe renders its files and lists its You-run steps; no credential is requested or handled.
- [ ] AC-4: `/laneconductor:add-recipe` produces a recipe that passes the checker, is saved to the personal library as an unpushed commit, and was approved first.
- [ ] AC-5: The privacy gate blocks a recipe containing a private project id, site name or secret from the shipped library (test with a fixture).
- [ ] AC-6: The plugin still passes `claude plugin validate --strict`, the size limits, and the lean-profile test.
