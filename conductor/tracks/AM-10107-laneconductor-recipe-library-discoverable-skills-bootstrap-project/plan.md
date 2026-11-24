# Track 10107: LaneConductor recipe library (discoverable skills + bootstrap_project)

Spec: `spec.md` (format, example recipe, tool contracts, seed reference table with FOUND/NOT FOUND).
Tests: `test.md`.

**Where things go.** Recipes live in the library repo (D1, assumed `<code>/lc-recipes`).
Code goes in 10106's `connector/` folder: `connector/src/recipes/` (format checker, secret scanner,
reference resolver, ranking, rendering) and `connector/src/tools/` (the four tools). Tests use
`node:test` under `connector/test/`, each fixture repo with its own `git init` (track 10082 hazard).
Sibling repos are only ever **read**.

**Dependencies.** Phases 1-3 need nothing from 10106 (files and a checker). Phases 4-7 need 10106
Phases 2-4 (`StateStore`, the response envelope, the advice log, `report_outcome`, `health_report`).
Phase 8 needs 10106 Phase 3 (the stdio server). `**Depends On**: 10106` stays; do not start Phase 4
before 10106's Phase 4 is merged.

**Minimalism check for every phase.** A recipe holds only what Claude cannot derive. If a phase
adds code that Claude could do itself in the session (searching, choosing, writing files), cut it.

## Decisions needed before implement

The plan assumes the recommended option for each. The human can override any of them before
implement starts.

### D1: Where the library lives
| Option | Tradeoff |
|---|---|
| a. **Dedicated repo `<code>/lc-recipes`**, private GitHub remote `meller/lc-recipes` created and pushed by the human (recommended) | Clean history with nothing but recipes and their log; the 10106 GitHub App can be installed on it alone; a recipe commit never mixes with project state. Cost: one more repo to create. |
| b. `laneconductor-meta/recipes/` | Exists already, but it has no remote, one commit, and tracks `conductor/.worker.tokens.json` and worker logs (spec V3). Publishing it needs a history scrub first, and it mixes recipes with legacy worker state that is being retired. |
| c. `laneconductor/recipes/` in this repo | Ships with the connector, nothing to create. But it puts one user's project ids, bucket and secret names into the product repo that anyone using LaneConductor clones, and recipe churn lands in product history. |

**Recommendation: a.** If the human prefers b, the token file and logs must be untracked and the
history scrubbed (by the human) before any remote is added.

### D2: Where recipe outcomes are logged
| Option | Tradeoff |
|---|---|
| a. **The library repo's own `conductor/advice-log/`**, lines carrying a `project` field (recommended) | One place per recipe; `health_report` on the library works unchanged (10106 code, same line format). Cost: a session working in project X also commits log lines to the library (local, cheap; remote is batched per 10106 D3). |
| b. Each target project's own advice log | No writes outside the project being worked on, but a recipe's history is scattered over N repos, and `health_report` needs a project list and N reads (a remote surface cannot do that cheaply). |

**Recommendation: a.**

### D3: Who approves a new, changed or retired recipe
| Option | Tradeoff |
|---|---|
| a. **Claude drafts and validates; the human says yes before `save_recipe`** (recommended) | A wrong convention would be served to every future project, so a human look is cheap insurance. Cost: one question at the end of a track. |
| b. Claude saves autonomously with `verified: null` (draft); `find_recipe` ranks drafts lower | No friction, but drafts accumulate and unreviewed advice still gets served. |
| c. Extraction only in a periodic, human-started review session | Least noise, but knowledge is captured long after the context that produced it is gone. |

**Recommendation: a.**

### D4: Does `bootstrap_project` write files or return them?
| Option | Tradeoff |
|---|---|
| a. **Return rendered files plus the checklist; Claude writes them with its own tools** (recommended) | Matches 10106's principle that the connector stores and advises and Claude executes; identical on every surface; Claude asks before overwriting. Cost: on claude.ai there is no local folder, so bootstrap is a preview there. |
| b. The connector writes a local target directory and makes the first commit | One call does everything, but the connector starts executing work, and only locally. |
| c. The connector creates a GitHub repo remotely | Creating repos is the human's call; rejected. |

**Recommendation: a.**

## Phase 1: Extract ONE recipe by hand and prove it beats plain Claude (gate; no tooling)

**Problem**: The format has not been tried on a real case, and nobody has shown that a recipe changes
what Claude does.
**Solution**: Write `shared-gcp-firebase-site` by hand from the references in spec.md, then run the
paired baseline in test.md. If the recipe does not beat plain Claude, stop and rethink before
building anything.

- [ ] Task 1: Create the library repo per D1 (`git init -b main` in `<code>/lc-recipes`, `README.md` stating the format rules from spec REQ-1..6). No remote; the human adds it.
- [ ] Task 2: Write `recipes/shared-gcp-firebase-site/SKILL.md` and `files/.firebaserc.tmpl`, `files/firebase.json.tmpl` from the spec example; re-check every reference path at its cited commit with `git -C <repo> cat-file -e <commit>:<path>`
- [ ] Task 3: Check the codebase pitfall ("a shared `default` codebase across repos treats the other repo's functions as removed") against the Firebase Functions docs on codebases; keep, correct or delete it, and note the source
- [ ] Task 4: Check the format by hand: `description` + `when_to_use` <= 1,536 characters, `metadata` is a map, no reused field names, no secret patterns (spec REQ-12), body sections in order
- [ ] Task 5: AC-3 check: copy the folder into `~/.claude/skills/`, confirm it is listed in a fresh Claude Code session with no frontmatter error, then delete the copy
- [ ] Task 6: Run the paired baseline (test.md TC-1.5 to TC-1.8): 3 plain runs, 3 recipe runs, scored on the rubric
- [ ] Task 7: Record the scores in `baseline.md` in this track folder and a one-paragraph verdict in `conversation.md`. If the recipe does not beat the baseline by at least 2 points, set `**Lane Status**: waiting` with a question to the human instead of continuing.

**Impact**: The format is validated on a real case, and there is evidence (not opinion) that recipes
change Claude's output.

## Phase 2: Format checker and secret scanner

**Problem**: By-hand checks do not scale to the other recipes or catch secrets reliably.
**Solution**: Pure modules plus a CLI, no MCP code.

- [ ] Task 1: `connector/src/recipes/format.mjs`: parse frontmatter (YAML), enforce REQ-1..4 (folder name = `name`, allowed top-level fields, `metadata` keys and types, `kind` values, 1,536-character cap, body sections and their order, 8,000-character body cap), return `{ ok, errors: [{ field, message }] }`
- [ ] Task 2: `connector/src/recipes/secrets.mjs`: the REQ-12 patterns; returns matches with file and line only, never the matched text
- [ ] Task 3: `connector/src/recipes/references.mjs`: resolve `owner/name` to a local repo by `origin` URL under the roots (REQ-10), then check `cat-file -e <commit>:<path>` and compare the blob at the commit with the blob at `HEAD`; produce `freshness` and `stale_reasons` (REQ-9)
- [ ] Task 4: `connector/bin/lc-recipe-check.mjs <library dir>`: runs all three on every recipe, prints one line per finding, exits 1 on any error
- [ ] Task 5: Run it on the Phase 1 recipe; it must pass with zero findings

**Impact**: Every later recipe and every `save_recipe` call goes through the same checks.

## Phase 3: Extract the other six seed recipes and the two process recipes

**Problem**: The library is useful only once the conventions that hurt during Dual Reader are in it.
**Solution**: Write each from the FOUND references in spec.md; keep only what Claude cannot derive.

- [ ] Task 1: `vertex-gemini-adc` (references: dual-reader `geminiGenerator.ts`, tokentalos `llm_clients.js`); `## You run` holds `gcloud auth application-default login` and the role grant command
- [ ] Task 2: `browser-tts-unlock-voice-binding` (otralingo `AudioUnlocker.tsx`, dual-reader `audioUnlocker.ts` and `speechSynthesisClock.ts`); `files/audioUnlocker.ts` template from the dual-reader version
- [ ] Task 3: `vertex-imagen-retry-gcs-fallback` (the_hero_journey `image-generation.ts`, dual-reader `vertexImagenGenerator.ts`)
- [ ] Task 4: `makefile-local-run` (dual-reader and otralingo Makefiles); `files/Makefile.tmpl` with `help`, `install-all`, `env-file`, `db-local`, `db-seed`, `db-reset`, `dev`, `test-all`, `stop-all`, `deploy`
- [ ] Task 5: `postgres-local-neon-prod-secret-manager` (dual-reader `functions/index.mjs`, `scripts/deploy.sh`, `.env.example`; livingwork `functions/src/index.ts`); state a secret naming rule (`<PRODUCT>_DATABASE_URL`) as a recommendation, since the two references differ
- [ ] Task 6: `isolated-test-database` (dual-reader `vitest.config.ts` and commit `27666b1`, livingwork `vitest.config.ts`); the per-worktree DB part goes under `## Unproven` because no reference exists (spec seed table: NOT FOUND)
- [ ] Task 7: Process recipe `new-project` (`kind: process`): ask the name and stack, `find_recipe`, show the chosen recipes and why, `bootstrap_project`, write files, hand the user the checklist, verify with `make help` and `make db-local`
- [ ] Task 8: Process recipe `extract-recipe` (`kind: process`): REQ-16 criteria, find-before-add, draft, check, human OK, `save_recipe`; and the retire path (REQ-17)
- [ ] Task 9: `lc-recipe-check` passes on all nine; every seed recipe has `verified` set

**Impact**: All seven seed conventions are written down, each pointing at working code.

## Phase 4: `find_recipe` and `get_recipe`

**Problem**: Claude needs to search the library and read one recipe on demand.
**Solution**: Two read tools on the 10106 server, reading the library through a second `StateStore`.

- [ ] Task 1: `--recipes <path|owner/name>` server option; a library `StateStore` instance; relax `NOT_A_LANECONDUCTOR_REPO` for read tools on a repo with `recipes/`
- [ ] Task 2: `connector/src/recipes/rank.mjs`: deterministic ranking (spec "Tools" 1)
- [ ] Task 3: `find_recipe` and `get_recipe` per the contracts, with the 10106 envelope, `RECIPE_NOT_FOUND`, annotations, `serve` and `empty_result` logging
- [ ] Task 4: Freshness from Phase 2's resolver; `reference_unresolvable` on surfaces that cannot read the reference repo

**Impact**: Claude can find and read a recipe from any session with the connector.

## Phase 5: `bootstrap_project`

**Problem**: "Create a new project for me" needs the chosen recipes turned into files and a checklist.
**Solution**: Render, merge and return; never write (D4).

- [ ] Task 1: `connector/src/recipes/render.mjs`: `{{var}}` substitution, built-in vars (spec "Template rendering"), `missing_vars`
- [ ] Task 2: Merge across recipes: two recipes producing the same path give a `conflicts` entry (no silent last-wins); `.env.example` lines are unioned
- [ ] Task 3: Checklist from each recipe's `## You run` (always `who: "user"`) and `## Claude does` (`who: "claude"`)
- [ ] Task 4: Run the secret scanner over `vars` and every rendered file; reject on a match
- [ ] Task 5: One `serve` per recipe logged with `tool: "bootstrap_project"` and the `project` field

**Impact**: One call returns everything Claude needs to scaffold a project in the user's conventions.

## Phase 6: Accountability for recipes

**Problem**: The user must be able to see which recipes Claude keeps overriding or that fail.
**Solution**: Reuse 10106's log and report; add only the recipe view.

- [ ] Task 1: Recipe events go to the library's `conductor/advice-log/` (D2), with the `project` field; `report_outcome` resolves a recipe `serve_id` from that log
- [ ] Task 2: `health_report` with `project` = library: per-recipe rows, `rewrite_or_delete` and `reverify` flags (REQ-15), stale recipes listed
- [ ] Task 3: `find_recipe` and `get_recipe` include the `health` summary

**Impact**: A failing recipe is visible in one report and at the moment Claude is about to use it.

## Phase 7: Extract, retire, and the always-on glue

**Problem**: Knowledge must compound, bad recipes must go, and Claude must actually search.
**Solution**: One write tool, two short text changes.

- [ ] Task 1: `save_recipe` per the contract: checker plus scanner, `base` check, commit messages, retire deletes the folder in one commit with the reason and health numbers
- [ ] Task 2: Add the two-line extract pointer to `.claude/skills/laneconductor/lanes/merge.md` (after a track lands: ask the human whether it is recipe material; see `get_recipe extract-recipe`)
- [ ] Task 3: Add the REQ-18 paragraph to the connector's server instructions; check the total stays under 4,096 characters
- [ ] Task 4: The REQ-18 fallback: a small personal skill text in `connector/README.md` that the human may install if 10106's U1 fails

**Impact**: New solutions become recipes, failed ones get rewritten or retired, and recipes get used
without anyone reminding Claude.

## Phase 8: Acceptance run (human-assisted; AC-1, AC-5, AC-6, AC-7)

**Problem**: The track succeeds only if "create a new project for me" really works end to end.
**Solution**: Run the scenarios in test.md "Acceptance" against a scratch directory.

- [ ] Task 1: Scratch dir `<code>/lc-bootstrap-check` (own `git init`), Claude Code with only the stdio connector, fresh session, the AC-1 prompt; check the files
- [ ] Task 2: The human runs the checklist commands; then `make db-local`, then `make deploy` (by the human) publishes the placeholder page
- [ ] Task 3: AC-5: record 5 outcomes on a test recipe in a scratch library (3 deviated) and check the flag in `health_report` and `find_recipe`
- [ ] Task 4: AC-6: grep every response and log line of the run for the REQ-12 patterns (expected: none)
- [ ] Task 5: AC-7: run the extract step at the end of the next real track; record what was saved or why not
- [ ] Task 6: The human deletes the scratch site and directory when done

**Impact**: Evidence that the library does the job in the index.md acceptance.

## Phase 9: Later recipes (FFU; not part of this pass)

**Problem**: More conventions exist than the seven seeds.
**Solution**: Extract them through the Phase 7 step as tracks touch them; the human may split this
into its own track.

- [ ] Task 1: OAuth (Google sign-in) recipe
- [ ] Task 2: Cache buster recipe
- [ ] Task 3: PWA recipe
- [ ] Task 4: Prisma conventions recipe (only what is this user's, not generic Prisma)
- [ ] Task 5: Onboarding recipe
- [ ] Task 6: tokentalos LLM pattern recipe

**Impact**: The library keeps growing from real work instead of a one-off seeding.
