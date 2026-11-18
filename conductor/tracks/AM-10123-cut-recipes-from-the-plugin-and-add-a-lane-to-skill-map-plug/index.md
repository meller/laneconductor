# Track AM-10123: Cut recipes from the plugin and add a lane-to-skill map (plugin 0.6.0)

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10117
**Problem**: Decision (human, 2026-11-18): a recipe is a skill, and a plugin is already a bundle of skills, so a recipe library inside the LaneConductor plugin is a skill library wrapped in a skill library. Anthropic already provides discovery, sharing, updates and organization rollout for skills, and the person's own plugin marketplace does the same. LaneConductor should be an orchestrator that KNOWS which skills help at each lane, and never wraps them.

Cut (recipes as a LaneConductor concept): the `recipes` and `add-recipe` commands and their catalog entries; the skill procedures `ops/recipes.md`, `ops/apply-recipe.md`, `ops/add-recipe.md` and their routing rows; the recipe scripts (`lc-recipe-match`, `lc-recipe-apply`, `lc-recipe-save`, `lc-recipe-gate`, `lc-recipe-check`) and `connector/src/recipes/`; the `recipes/` folder inside the skill (the synthetic `example-hello`); the `yaml` runtime dependency (check it is used only by the recipe code); the recipe-matching step in the `new-project` procedure and the `recipes.path` config key; recipe tests; recipe wording in the README, the plugin README, ARCHITECTURE and the connector README (the README section "Recipe library" becomes a short note that solved problems belong in ordinary skills in the person's own plugin or marketplace).

Keep: `new-project` (interview, scaffold of the context files, workflow.json, quality-gate commands, first tracks), the scaffold script and its tests, everything else.

Add: a lane-to-skill map. Each lane guide (plan, brainstorm, implement, review, quality-gate, merge) gets a short section "Skills that help here", written as suggestions in the second-opinion style (use them if installed, say so if one is missing, never an order). Starting set, by name, from Superpowers: brainstorming and writing-plans for plan and brainstorm; test-driven-development, systematic-debugging, subagent-driven-development and using-git-worktrees for implement; requesting-code-review and receiving-code-review for review; verification-before-completion for quality-gate; finishing-a-development-branch for merge. `conductor/workflow.json` takes an OPTIONAL `skills` object (`{ "implement": ["my-firebase-deploy"] }`) that the lane guides tell Claude to read and use in addition; the key is optional and must not break any existing reader of workflow.json (check the connector and the legacy parsers). The default workflow.json template stays valid.

Version 0.6.0: bump `connector/package.json`, both version lines in its lock file, `connector/test/plugin-build.test.mjs` (two places) and regenerate the plugin with `node scripts/build-plugin.mjs`. The command count in tests and docs changes from 24 to 22; do not hard-code a count in public text.

Acceptance: `cd connector && npm test` passes with the recipe tests removed and new tests for the lane-guide skill sections and the optional workflow.json `skills` key; `node scripts/build-plugin.mjs --check` is clean; `claude plugin validate ./plugins/laneconductor --strict` and `claude plugin validate . --strict` pass; no reference to the recipe commands or scripts remains in the plugin or its docs (grep); the old code stays in git history. Do not touch landing/index.html or landing/wiki.html (list the recipe wording found there in the report instead).
**Summary**: Decision (human, 2026-11-18): a recipe is a skill, and a plugin is already a bundle of skills, so a recipe library inside the LaneConductor plugin is a skill library wrapped in a skill library. Anthro
