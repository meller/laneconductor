# Track 10123: Cut recipes from the plugin and add a lane-to-skill map (plugin 0.6.0)

## Phase 1: Cut the recipes

- [x] Task 1: Remove recipe scripts, `connector/src/recipes/`, recipe tests and the test helper
- [x] Task 2: Remove `ops/recipes.md`, `ops/apply-recipe.md`, `ops/add-recipe.md`, the skill `recipes/` folder and their routing rows
- [x] Task 3: Remove the `recipes` and `add-recipe` commands, update the command tests, coverage.json and build-plugin.mjs
- [x] Task 4: Drop the recipe parts of `ops/new-project.md` and the scaffold (chosen recipes, deviations, `recipes.path`, deny-list .gitignore line)
- [x] Task 5: Drop the `yaml` dependency if only the recipe code used it
- [x] Task 6: Rewrite recipe wording in README, plugin README, ARCHITECTURE and connector README

## Phase 2: Lane-to-skill map

- [x] Task 1: "Skills that help here" section in the six lane guides (suggestions, second-opinion style)
- [x] Task 2: Optional `skills` object in workflow.json: document in `setup/templates.md`, lane guides read it
- [x] Task 3: Test that workflow.json with and without `skills` is read by the connector and the legacy parsers
- [x] Task 4: Test for the lane-guide sections

## Phase 3: Version 0.6.0 and verify

- [x] Task 1: Bump connector/package.json, both lock lines, plugin-build.test.mjs (two places)
- [x] Task 2: `node scripts/build-plugin.mjs`, then `--check`
- [x] Task 3: `cd connector && npm test`, both `claude plugin validate --strict`, grep for leftover recipe wording
