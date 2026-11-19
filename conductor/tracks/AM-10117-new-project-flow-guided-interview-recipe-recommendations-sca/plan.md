# Track 10117: New-project flow: guided interview, recipe recommendations, scaffold, and add-a-recipe

## Phase 1: The procedure and the command (works with no recipes)

- [x] Task 1: `ops/new-project.md` in the skill source: situation detection, the interview (reuse `lanes/brainstorm.md`; the question list of REQ-1; stop rules), the scaffold step pointing at `setup/scaffold.md` and `setup/templates.md`, first tracks, the commit question
- [x] Task 2: Catalog entries `new-project` and `add-recipe` (and `recipes`: list what is available) in track 10116's catalog so the commands and MCP prompts are generated; the skill routing table gets the rows; the coverage test passes
- [x] Task 3: Scaffold templates reviewed so every file is tailored from interview answers and `quality-gate.md` names only commands that exist; no daemon or database content
- [x] Task 4: Fixture test: a scripted interview in a temp repo produces the files and the tracks (the procedure is Markdown, so the test checks the templates render and the first-track writer output; the conversation itself is HUMAN-checked)

## Phase 2: Recipes inside the skill

- [x] Task 1: Library layout `skills/laneconductor/recipes/<name>/` (nested, not separately registered), generator copies it; zero always-on token cost verified with the token estimate
- [x] Task 2: Discovery order and matching rule (REQ-2): shipped library then `recipes.path` / `LC_RECIPES`; the matching on stack and prerequisites is written as a procedure Claude follows plus a small deterministic helper (`lc-recipe-match`) that ranks by stack overlap so ranking is not left to chance
- [x] Task 3: Merge track 10107 Phase 2 (the checker, secret scanner, reference resolver) into main and ship `lc-recipe-check` in the plugin
- [x] Task 4: The privacy gate: a script that refuses a recipe with a secret, email, phone, or a name from a deny list (private project ids, site names, private repo names read from a local file, never committed); tests with fixtures
- [ ] Task 5: The first shipped recipes: review each of the nine library recipes with the human, publish only those that pass the gate (human approval recorded here); the rest stay personal

## Phase 3: Apply and add

- [x] Task 1: Apply-a-recipe procedure (REQ-5): render files, show You-run steps, conflict report
- [x] Task 2: `add-recipe` procedure (REQ-6) using the checker, saving to the personal library as a commit
- [ ] Task 3: Skill text, README and the landing page mention the flow (coordinate with track 10114)

## Phase 4: Real use

- [ ] Task 1 (HUMAN): run `/laneconductor:new-project` on a scratch project with the personal library present; record which recipes were recommended and whether any was wrong or missing; this is the 10107 discovery evidence
- [ ] Task 2 (HUMAN): run `/laneconductor:add-recipe` once on something real
- [ ] Task 3: Record the decision on `find_recipe` and `bootstrap_project` in track 10107

**Impact**: A new project starts from a short conversation, reuses what is already known, and teaches the library what it learns.

## Phase 5: Make the new-project workflow the start for a new or empty project (owner direction, 2026-11-19)

For a new project the right start is the brainstorm and the new-project workflow with suggested skills, not the existing-project setup.

- [x] Task 5.1: Check, with a headless run on an empty folder, that `next` names `/laneconductor:new-project`, that the workflow's interview is a brainstorm (options and decisions explored before any file is written), and that it ends with the first-track card and the starter set of suggested skills; fix any gap
- [x] Task 5.2: Keep the closing of new-project consistent with the closing of setup (the same first-track card, one question at the end)

## Phase 6: A brand-new project starts from the card (owner direction, 2026-11-19; release 1.9.5)

- [ ] Task 6.1: `next` on an empty or brand-new folder offers `go` to start the brainstorm (the new-project interview); `go` starts it; the interview explores options and decisions before any file is written
- [ ] Task 6.2: The workflow ends with the same two-item closing as setup (see it on the board, plan the first track) and the suggested skills, one question

