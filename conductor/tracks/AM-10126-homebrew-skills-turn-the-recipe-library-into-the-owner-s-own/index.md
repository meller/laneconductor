# Track AM-10126: Homebrew skills: turn the recipe library into the owner's own skills marketplace

**Lane**: implement
**Lane Status**: running
**Progress**: 10%
**Phase**: Implement started 2026-11-18 by a sub-agent in the library repository (branch homebrew-skills); the lead reviews and merges the branch. Nothing is pushed: the library stays local until the owner names a private repository.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10123
**Problem**: Decision (human, 2026-11-18): recipes were cut from the LaneConductor plugin (track 10123) because a recipe is a skill. The conventions the owner wanted recipes for must still exist, as ordinary skills in the owner's own plugin and marketplace ("homebrew skills"). The library lives in its own private repository outside this one (`~/Code/lc-recipes`, a git repo with no remote, already packaged as a plugin and marketplace with nine skills that pass `claude plugin validate --strict`). This track changes that library; it ships nothing in the public LaneConductor repo, and the library's content (project names, paths) must never be copied into this repository.

Work, in the library repository, on a branch, one commit per step:
1. Rename the plugin and marketplace to `homebrew-skills` (plugin.json, marketplace.json, README), version 0.2.0. The name is easy to change later; note in the README how to install and update it (`claude plugin marketplace add <path or owner/repo>`, `claude plugin install homebrew-skills@homebrew-skills`).
2. Make every skill a clean standalone skill: keep `name`, `description`, `when_to_use` (together at most 1,536 characters) and the useful sections (why this works for you, you run, Claude does, pitfalls, unproven); remove references to LaneConductor connector tools (`find_recipe`, `get_recipe`, `bootstrap_project`, `save_recipe`) and to the word "recipe" where it is only LaneConductor jargon. The skills are: the shared GCP and Firebase site layout, Gemini through ADC, browser voice unlock, Imagen retry with a GCS fallback, the Makefile for local runs, local Postgres with a production secret, the isolated test database.
3. The two process recipes: `new-project` is superseded by the plugin's own `new-project` command, so drop it from the library; `extract-recipe` becomes a general skill `capture-solved-problem` (turn something just solved and verified into a skill: criteria, find-before-add, draft, check, ask the human, save as a commit, never pushed).
4. Add skills for the other conventions the owner remembers, from the old list: the LLM client pattern from the owner's AI projects, and then, only where a working reference exists in a sibling repository under `~/Code` (read only, never modified): OAuth sign-in, cache buster, PWA, Prisma, onboarding. Each new skill cites the working reference (repository and commit) and carries a verified date. Anything with no reference is left out and listed in the report, not invented.
5. The checker and the privacy gate were removed from the plugin with the recipes. Put a copy in the library as `tools/` (a small Node tool with its own package.json: format check for the 1,536-character rule and sections, the secret scan, the reference resolver, the deny-list privacy check). Source: the files under `connector/src/recipes/` and `connector/bin/lc-recipe-check.mjs`, `lc-recipe-gate.mjs` in the LaneConductor repository at commit 7f60cf81 (use `git -C ~/Code/laneconductor show 7f60cf81:<path>`). The deny list stays in a local, never-committed file.
6. A README section "Use with LaneConductor": how to list these skills per lane in a project's `conductor/workflow.json` `skills` object (the lane-to-skill map from track 10123), with a small example.
7. Verify: `claude plugin validate . --strict`; the checker passes on every skill with no findings; no secret, email or private token in any file; no remote added and nothing pushed. Report what was added, renamed and dropped.

The owner decides the repository name and visibility for pushing the library (a private GitHub repository); until then it stays local. Never make it public.
**Summary**: Decision (human, 2026-11-18): recipes were cut from the LaneConductor plugin (track 10123) because a recipe is a skill. The conventions the owner wanted recipes for must still exist, as ordinary skill
