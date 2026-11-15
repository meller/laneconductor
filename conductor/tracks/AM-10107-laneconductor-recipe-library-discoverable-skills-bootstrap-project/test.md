# Tests: Track 10107 - LaneConductor recipe library (discoverable skills + bootstrap_project)

## Test Commands
```bash
# Format, secret and reference checks over the library (Phase 2+)
node connector/bin/lc-recipe-check.mjs /home/meller/Code/lc-recipes

# Unit and tool-contract tests (node:test, zero network; every fixture repo is a temp dir with its own `git init -b main`)
cd connector && node --test test/recipes-*.test.mjs

# One file
cd connector && node --test test/recipes-format.test.mjs

# A reference exists at its cited commit (by hand, Phase 1)
git -C /home/meller/Code/dual-reader cat-file -e f55fd89:.firebaserc && echo ok

# Afterwards (memory: leaked-process incidents on tracks 10073/10080): no stray processes
ps aux | grep -E "lc-connector|lc-recipe-check" | grep -v grep   # expected: empty
```
Tests never write to a sibling repo or to the real library: reference-resolution tests build their
own fixture repos with known commits. They never run inside a track worktree against the primary
checkout (track 10082 hazard).

## Test Cases

### Phase 1: One recipe by hand, and the baseline (manual, observable)
- [ ] TC-1.1: Every `reference` in `shared-gcp-firebase-site` passes `git -C <repo> cat-file -e <commit>:<path>` - expected: all 4 exist
- [ ] TC-1.2: `description` + `when_to_use` length <= 1,536 (`wc -c` on the two values); `metadata` is a YAML map; no key under `metadata` equals a frontmatter field name - expected: all true
- [ ] TC-1.3: `grep -nE` with every REQ-12 pattern over the recipe folder - expected: no match
- [ ] TC-1.4: AC-3: the folder copied to `~/.claude/skills/shared-gcp-firebase-site/` shows in a fresh Claude Code session's skill list with no frontmatter warning; the copy is then removed - expected: listed, then gone
- [ ] TC-1.5: Baseline setup: a scratch dir `/home/meller/Code/lc-recipe-baseline` with its own `git init`, no CLAUDE.md, no connector, no sibling repos mentioned. Prompt, identical in every run: "Set up hosting and an API deploy config for a new web app called pinecone (a Vite SPA plus an Express API on Cloud Functions, Postgres in prod). Don't deploy; write the config files and tell me exactly which commands I need to run." - expected: setup recorded in `baseline.md`
- [ ] TC-1.6: Run A (plain Claude): 3 fresh sessions with the prompt only - expected: the produced files and reply saved per run
- [ ] TC-1.7: Run B (recipe): 3 fresh sessions with the prompt plus "Use this recipe:" followed by the recipe's SKILL.md text - expected: the produced files and reply saved per run
- [ ] TC-1.8: Score every run on the 7-point rubric (one point each, judged from files and reply): R1 uses project `laneconductor-site`, no new GCP project; R2 hosting target `pinecone` mapped to site `pinecone-laneconductor`; R3 Functions `codebase: "pinecone"`; R4 every deploy command scoped with `--only hosting:pinecone,functions:pinecone:<fn>`; R5 rewrite written `/api/**`, not `/api**`; R6 health check under `/api/...`, not a bare `/healthz`; R7 no credential handled by Claude (sign-in, secret creation and deploy are listed for the user, no value in any file) - expected: **recipe beats plain Claude** when the median of B is at least the median of A + 2 and every B run scores R7. Otherwise the gate in plan.md Phase 1 Task 7 applies.
- [ ] TC-1.9 (optional, second baseline): the same A/B procedure for `vertex-gemini-adc` with the prompt "Add Gemini text generation to this Node API" - rubric: uses Vertex mode (`vertexai: true`), no API key in code or `.env`, `GCP_PROJECT`/`GCP_REGION` from env, `gcloud auth application-default login` given as a user step - expected: recorded either way

### Phase 2: Format checker and secret scanner
- [ ] TC-2.1: A valid recipe fixture - expected: `{ ok: true, errors: [] }`
- [ ] TC-2.2: Folder `foo-bar`, `name: foo` - expected: error on `name`
- [ ] TC-2.3: An undocumented top-level field (`stack:` at top level) - expected: error naming the field and saying it belongs under `metadata`
- [ ] TC-2.4: `metadata: "x"` (not a map) and `metadata.paths` (reused field name) - expected: one error each
- [ ] TC-2.5: `metadata.kind: skill` - expected: error (only `recipe` or `process`)
- [ ] TC-2.6: `description` + `when_to_use` of 1,537 characters - expected: error; 1,536 - expected: ok
- [ ] TC-2.7: Body sections out of order, or `## You run` missing on a `kind: recipe` - expected: error; a `kind: process` recipe needs neither `## You run` nor `reference`
- [ ] TC-2.8: Body over 8,000 characters - expected: error
- [ ] TC-2.9: Secret scanner: one fixture line per REQ-12 pattern (fake values built at test time, never committed as literals) - expected: each detected with file and line, and the output never contains the matched text
- [ ] TC-2.10: Scanner negatives: `postgresql://postgres:postgres@localhost:5432/x`, `DATABASE_URL=` (empty), `GCP_PROJECT=laneconductor-site` - expected: no match
- [ ] TC-2.11: Reference resolver over fixture repos: `origin` `git@github.com:o/r.git` and `https://github.com/o/r` both resolve `o/r`; a folder named `r` whose origin is `o/other` does not (V6) - expected: as stated
- [ ] TC-2.12: Freshness: path present and unchanged since the commit -> `fresh`; path changed at HEAD -> `possibly_stale` + `reference_changed_since_verified`; path deleted -> `stale` + `reference_missing`; repo not found -> `possibly_stale` + `reference_unresolvable`; `verified` 91 days old -> `verified_older_than_90d`; `verified: null` -> `stale` + `verified_missing`
- [ ] TC-2.13: `lc-recipe-check` exits 0 on the Phase 1 recipe and 1 on a fixture with any error

### Phase 3: Seed recipes
- [ ] TC-3.1: `lc-recipe-check /home/meller/Code/lc-recipes` - expected: exit 0, 9 recipes (7 seed + `new-project` + `extract-recipe`)
- [ ] TC-3.2: Every seed recipe has `verified` set and at least one reference whose freshness is `fresh` - expected: true
- [ ] TC-3.3: `isolated-test-database` has a `## Unproven` section covering the per-worktree DB - expected: present
- [ ] TC-3.4: Review checklist by the human: no recipe explains generic library usage that public docs cover; each states at least one choice specific to this user - expected: human ticks it in `conversation.md`

### Phase 4: `find_recipe` and `get_recipe`
- [ ] TC-4.1: `find_recipe({ query: "deploy hosting firebase" })` over the fixture library - expected: `shared-gcp-firebase-site` ranked first
- [ ] TC-4.2: `find_recipe({ paths_hint: ["firebase.json"] })` - expected: recipes whose `paths` match come first
- [ ] TC-4.3: Same input twice - expected: identical order (deterministic)
- [ ] TC-4.4: A query matching nothing - expected: `recipes: []`, one `empty_result` log line, `ok: true`
- [ ] TC-4.5: `get_recipe({ name })` - expected: body, frontmatter, `framing`, `serve_id`, `base`, freshness; exactly one `serve` line with `item: "recipe:<name>"` and the `source` blob sha
- [ ] TC-4.6: `get_recipe({ name: "nope" })` - expected: `isError`, `RECIPE_NOT_FOUND`, not counted as a connector error
- [ ] TC-4.7: Every response carries 10106 `provenance` for the library repo, and the tool list declares the annotations in the spec table
- [ ] TC-4.8: Response size stays under 40,000 characters with `include_files: true` on the largest recipe - expected: true, or files truncated with flags

### Phase 5: `bootstrap_project`
- [ ] TC-5.1: `bootstrap_project({ name: "pinecone", recipes: ["shared-gcp-firebase-site", "makefile-local-run", "postgres-local-neon-prod-secret-manager"] })` - expected: `.firebaserc` with target `pinecone` -> `pinecone-laneconductor`, `firebase.json` with `codebase: "pinecone"` and function `pineconeapi`, a Makefile, one merged `.env.example`
- [ ] TC-5.2: Nothing is written to disk by the call (the fixture dir is unchanged) - expected: true
- [ ] TC-5.3: Every checklist step from a `## You run` section has `who: "user"`; none of them was executed - expected: true
- [ ] TC-5.4: Two fixture recipes that both emit `Makefile` - expected: one `conflicts` entry naming both, no silent overwrite
- [ ] TC-5.5: A template with `{{bucket}}` and no `vars.bucket` - expected: `missing_vars: ["bucket"]`, placeholder left in the file
- [ ] TC-5.6: `vars: { key: <fake Google API key built at test time> }` - expected: `VALIDATION_FAILED`, the value not echoed in the error
- [ ] TC-5.7: `name: "Pine Cone"` - expected: `VALIDATION_FAILED`
- [ ] TC-5.8: One `serve` line per recipe with `tool: "bootstrap_project"` and `project` set - expected: 3 lines

### Phase 6: Accountability
- [ ] TC-6.1: Serve a recipe, then `report_outcome({ serve_id, outcome: "deviated", reason })` - expected: the outcome line lands in the library's log, linked by `serve_id`
- [ ] TC-6.2: A fixture log with 5 outcomes for one recipe, 3 deviated - expected: `health_report` row shows override rate 60% and flag `rewrite_or_delete`, top reasons listed
- [ ] TC-6.3: 4 outcomes, all deviated - expected: no flag (fewer than 5)
- [ ] TC-6.4: 2 `failed` outcomes in the window - expected: flag `reverify`
- [ ] TC-6.5: A recipe with `reference_missing` - expected: listed as stale with flag `reverify`
- [ ] TC-6.6: `find_recipe` result for the flagged recipe carries the same flags - expected: true
- [ ] TC-6.7: Log lines without `project` (10106 lines) still parse - expected: true

### Phase 7: Extract, retire, glue
- [ ] TC-7.1: `save_recipe` of a new valid recipe - expected: one commit `chore(recipes): save <name> via lc-connector` touching only that folder; `find_recipe` finds it
- [ ] TC-7.2: `save_recipe` with a stale `base` - expected: `CONFLICT`, file unchanged
- [ ] TC-7.3: `save_recipe` of content with a planted fake key - expected: `VALIDATION_FAILED`, nothing written, no key in the error text
- [ ] TC-7.4: `save_recipe({ name, retire: { reason } })` - expected: folder deleted in one commit whose message names the reason and whose body has the health numbers; `find_recipe` no longer returns it; `git log` still shows the text
- [ ] TC-7.5: Server instructions with the REQ-18 paragraph stay under 4,096 characters - expected: true
- [ ] TC-7.6: `lanes/merge.md` contains the extract pointer and the skill still loads (SKILL.md routing unchanged) - expected: true

## Acceptance (Phase 8, human-assisted)
- [ ] TC-8.1 (AC-1): In `/home/meller/Code/lc-bootstrap-check` with only the stdio connector, a fresh session given "create a new project for me called pinecone: a Vite web app with an Express API and Postgres" - expected: Claude calls `find_recipe` then `bootstrap_project` with no further prompting; the files in AC-1 exist; the reply lists the user-run checklist
- [ ] TC-8.2 (AC-1): After the human runs the checklist, `make help` lists the targets, `make db-local` creates the local `pinecone` DB, and `make deploy` (run by the human) serves a page at `https://pinecone-laneconductor.web.app`
- [ ] TC-8.3 (AC-6): `grep -rnE` with the REQ-12 patterns over the scratch dir, the session's tool outputs and the library's advice log - expected: no match
- [ ] TC-8.4 (AC-5): the scratch-library flag check from Phase 8 Task 3 - expected: flag visible in both tools
- [ ] TC-8.5 (AC-7): the extract step at the end of a real track - expected: a saved recipe after the human's yes, or a recorded "not recipe material" with the reason
- [ ] TC-8.6: Processes and scratch resources cleaned up (`ps` empty; the human removed the scratch site) - expected: true

## Acceptance Criteria
- [ ] All `node --test test/recipes-*.test.mjs` tests pass, and 10106's own suite still passes
- [ ] `lc-recipe-check` passes on the real library
- [ ] The Phase 1 baseline verdict is recorded (recipe beats plain Claude, or the gate fired)
- [ ] No regressions in the connector's existing tools
