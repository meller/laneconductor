# Spec: New-project flow: guided interview, recipe recommendations, scaffold, and add-a-recipe

## Problem Statement

A person starting a new project today gets only the legacy `setup` command; the old CLI wizard (a brainstorm interview, then scaffold generation) is gone from the plugin, and the recipe library (things already solved in this person's stack) is not connected to it.

Wanted: `/laneconductor:new-project` takes someone through the questions (what it is for, who uses it, key features, language and stack, data, auth, hosting, AI use, testing, constraints), recommends the recipes that fit (known, verified solutions from their own library, for example a GCP/Firebase site layout, Gemini via Google login, local Postgres with a secret-managed production URL), lets them choose, scaffolds the project (the conductor context files, `.laneconductor.json`, `.gitignore`, git init if needed, the first tracks in the plan lane, one per chosen recipe plus a walking skeleton) and applies the chosen recipes, never handling credentials. `/laneconductor:add-recipe` extracts a new recipe from something just solved, checks it (format, secrets, references), and saves it to the library after the human agrees.

Principles: recipes are recommendations with reasons, never orders (second opinion); the library is private knowledge and is never shipped in the public plugin, only the mechanism is; the flow works with no recipes at all; nothing is committed or pushed without asking. The native-discovery test of the recipe plugin (track 10107 Phase 3c) is answered by running this flow on a scratch project.

Related: track 10105 (new-project flow gaps), track 10107 (recipe library, its process recipes new-project and extract-recipe), track 10116 (command catalog).

## Requirements

(To be written in the plan lane.)
