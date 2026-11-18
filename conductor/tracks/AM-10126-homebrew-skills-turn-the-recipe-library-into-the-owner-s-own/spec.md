# Spec: Homebrew skills: turn the recipe library into the owner's own skills marketplace

## Problem Statement

Decision (human, 2026-11-18): recipes were cut from the LaneConductor plugin (track 10123) because a recipe is a skill. The conventions the owner wanted recipes for must still exist, as ordinary skills in the owner's own plugin and marketplace ("homebrew skills"). The library lives in its own private repository outside this one (`~/Code/lc-recipes`, a git repo with no remote, already packaged as a plugin and marketplace with nine skills that pass `claude plugin validate --strict`). This track changes that library; it ships nothing in the public LaneConductor repo, and the library's content (project names, paths) must never be copied into this repository.

Work happens in the library repository, on a branch, one commit per step.

## Requirements

- REQ-1 Rename the plugin and marketplace to `homebrew-skills` (plugin.json, marketplace.json, README), version 0.2.0. The name is easy to change later; the README notes how to install and update it (`claude plugin marketplace add <path or owner/repo>`, `claude plugin install homebrew-skills@homebrew-skills`).
- REQ-2 Make every skill a clean standalone skill: keep `name`, `description`, `when_to_use` (together at most 1,536 characters) and the useful sections (why this works for you, you run, Claude does, pitfalls, unproven); remove references to LaneConductor connector tools (`find_recipe`, `get_recipe`, `bootstrap_project`, `save_recipe`) and to the word "recipe" where it is only LaneConductor jargon. The skills are: the shared GCP and Firebase site layout, Gemini through ADC, browser voice unlock, Imagen retry with a GCS fallback, the Makefile for local runs, local Postgres with a production secret, the isolated test database.
- REQ-3 The two process recipes: `new-project` is superseded by the plugin's own `new-project` command, so drop it from the library; `extract-recipe` becomes a general skill `capture-solved-problem` (turn something just solved and verified into a skill: criteria, find-before-add, draft, check, ask the human, save as a commit, never pushed).
- REQ-4 Add skills for the other conventions the owner remembers, from the old list: the LLM client pattern from the owner's AI projects, and then, only where a working reference exists in a sibling repository under `~/Code` (read only, never modified): OAuth sign-in, cache buster, PWA, Prisma, onboarding. Each new skill cites the working reference (repository and commit) and carries a verified date. Anything with no reference is left out and listed in the report, not invented.
- REQ-5 The checker and the privacy gate were removed from the plugin with the recipes. Put a copy in the library as `tools/` (a small Node tool with its own package.json: format check for the 1,536-character rule and sections, the secret scan, the reference resolver, the deny-list privacy check). Source: the files under `connector/src/recipes/` and `connector/bin/lc-recipe-check.mjs`, `lc-recipe-gate.mjs` in the LaneConductor repository at commit 7f60cf81 (use `git -C ~/Code/laneconductor show 7f60cf81:<path>`). The deny list stays in a local, never-committed file.
- REQ-6 A README section "Use with LaneConductor": how to list these skills per lane in a project's `conductor/workflow.json` `skills` object (the lane-to-skill map from track 10123), with a small example.
- REQ-7 Verify: `claude plugin validate . --strict`; the checker passes on every skill with no findings; no secret, email or private token in any file; no remote added and nothing pushed. Report what was added, renamed and dropped.

## Decisions

- 2026-11-18: Recipes were cut from the plugin because a recipe is a skill; the conventions live on as ordinary skills in the owner's own plugin and marketplace.
- 2026-11-18: The library stays in its own private repository outside this one; nothing from it is copied into the public LaneConductor repository.
- 2026-11-18: The owner decides the repository name and visibility for pushing the library (a private GitHub repository); until then it stays local. Never make it public.
- 2026-11-18: Onboarding is left out: no shared convention exists, each product's flow is different (listed in the report, not invented).

## Acceptance criteria

Ticked where re-checked in the library repository `~/Code/lc-recipes` for this tidy (files, git, the checker, the library tests and `claude plugin validate --strict`).

- [x] Plugin and marketplace are named `homebrew-skills`, plugin version 0.2.0, and the README gives the install steps (REQ-1).
- [x] No skill refers to the connector tools `find_recipe`, `get_recipe`, `bootstrap_project` or `save_recipe` (REQ-2).
- [x] `new-project` is gone and `capture-solved-problem` exists (REQ-3).
- [x] `llm-client-pattern`, `firebase-google-sign-in`, `cache-buster`, `pwa-vite-workbox` and `prisma-in-cloud-functions` exist, each with a reference and a verified date of 2026-11-18 (REQ-4).
- [x] `tools/` holds the checker, the privacy gate, the secret scan and the reference resolver with their own package.json; its 5 tests pass; the deny list file is git-ignored (REQ-5).
- [x] The README has a "Use with LaneConductor" section (REQ-6; the example's content was not re-read).
- [x] `claude plugin validate . --strict` passes; the checker reports 13 skills and 0 errors; the repository has no remote and a clean working tree (REQ-7).
- [ ] The checker reports no findings at all (REQ-7). Not met when re-checked: it gives 1 warning on `browser-tts-unlock-voice-binding` (possibly_stale: reference_changed_since_verified).
- [ ] The privacy gate was run against the owner's deny list with no hits (REQ-5, REQ-7). Not verified: the deny list is local and was not run here; a pattern grep for keys and addresses found nothing outside the secret scanner's own patterns and test.
- [ ] The owner has named a private GitHub repository, pushed the library, installed it and tried one skill in a real session. Not done.

## Risks and limits

- A skill's reference can drift: the checker already warns that the reference of one skill changed since it was verified.
- The library has no remote, so it exists only on this computer until the owner pushes it.
- The library's content (project names, paths) must not leak into this public repository, and the deny list that guards that is local and uncommitted.
- A skill that cites a working reference is only as good as that reference; onboarding has none and stays out.

## Out of scope

- Shipping anything in the public LaneConductor repository.
- Pushing the library or making it public (the owner decides).
- Modifying the sibling repositories used as references (read only).
- An onboarding skill.
