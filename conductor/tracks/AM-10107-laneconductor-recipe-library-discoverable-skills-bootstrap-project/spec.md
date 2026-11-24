# Spec: LaneConductor recipe library (discoverable skills + bootstrap_project)

## Problem Statement

Claude has general knowledge but not **this user's conventions**. During the Dual Reader build
(2026-09-20/21) nearly every hard step had already been solved in a sibling repo, and it was only
found because the user remembered where to look: the shared `laneconductor-site` GCP project with
one Firebase Hosting site and one Functions codebase per product, Gemini through ADC with no API key,
the browser TTS audio unlock, Imagen retry/backoff, the Makefile local-run targets.

A **recipe** is a solved problem in this user's stack: a noun ("shared-GCP Firebase deploy"). A
**skill** is a verb (plan, review). Skills are few and listed in context on every turn; recipes are
many, so they are **searched** through the connector (track 10106) and never all loaded. A recipe
points at working reference code, says when it was last verified, and can be applied by
`bootstrap_project`.

Three rules shape everything below:

1. **Second opinion, never a controller.** A recipe is a recommendation with its reason ("this
   worked for you because..."). Claude may decide against it, and says why through
   `report_outcome`; that is how a bad recipe gets found.
2. **Credentials are firm.** A recipe may give the exact commands the user runs (ADC login, Secret
   Manager setup). Claude never handles, enters, echoes or stores a key or secret value.
3. **Only what Claude cannot derive.** A recipe records a choice of this user (a project id, a
   naming rule, a pitfall that cost a day). Generic Prisma/OAuth/Firebase knowledge stays out.

## Verified facts (checked 2026-11-15)

| # | Fact | Source |
|---|------|--------|
| V1 | Documented SKILL.md frontmatter includes `name` (defaults to the directory name), `description`, `when_to_use` (appended to `description`; the two together are cut at **1,536 characters** in the skill listing), `paths` (globs that limit automatic activation) and `metadata`: "Free-form YAML map for your own key-value data ... read by your own tooling from `SKILL.md`. Claude Code doesn't act on its contents, and drops a value that isn't a map. Don't reuse frontmatter field names such as `paths` as keys." | https://code.claude.com/docs/en/skills (fetched this session) |
| V2 | "Every skill in the skill listing adds to your context on every turn, whether or not Claude ever uses it." Skills live at `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md` or in a plugin. | same page |
| V3 | `<repo>-meta` has **no git remote** (`git remote -v` is empty), one commit (`1bed62e`), and **tracks** `conductor/.worker.tokens.json`, `conductor/.sync.pid` and worker logs (`git ls-files`). Pushing it to GitHub as is would publish a token file in history. | local `git` (values not read or echoed) |
| V4 | `.gitignore:58` in this repo ignores `conductor/tracks/**/conversation.md` (10106 decision D5). | local file |
| V5 | Five sibling repos target `laneconductor-site` in `.firebaserc`: dual-reader, livingwork, humanities-explorer, the_hero_journey, chesstrainer. otralingo (`otralingo`) and macrodash (`makrodash`) do **not**, although `dual-reader/conductor/deployment-stack.md:7` says they do. | the repos' `.firebaserc` files |
| V6 | `humanities-explorer`'s origin is `github.com/meller/humanities-exploror` (typo), so a folder name does not reliably equal the GitHub repo name. | `git remote get-url origin` |

## Seed recipes: reference implementations

Each path was confirmed with `ls`/`grep` on 2026-11-15. Commits are each repo's `HEAD` that day.
Every path is relative to `<code>/`.

| # | Recipe (name) | Status | Reference (path, commit) | What it proves |
|---|---|---|---|---|
| 1 | `shared-gcp-firebase-site` | FOUND | `dual-reader/.firebaserc` + `dual-reader/firebase.json` (f55fd89) | Hosting target `dual-reader` -> site `dual-reader-laneconductor` in project `laneconductor-site`; Functions `codebase: "dual-reader"`, `nodejs22`, `/api/**` rewrite to `dualreaderapi`. |
| 1 | | FOUND | `livingwork/.firebaserc` + `livingwork/firebase.json` + `livingwork/package.json:27-28` (e3f8fef) | The same pattern in a second product, with scoped deploys `--only functions:livingwork:livingworkapi` / `--only hosting:livingwork`. |
| 1 | | FOUND | `dual-reader/scripts/deploy.sh:223-229` + `dual-reader/conductor/deployment-stack.md` ("Shared-Project Safety", healthz note) | Every deploy is scoped `--only hosting:<p>,functions:<p>:<fn>` so sibling apps in the shared project are never touched; a bare `/healthz` is reserved by Google's frontend, so use `/api/healthz`. |
| 1 | | NOT FOUND | (no repo doc) | The "a GCP project per product hit quota" lesson exists only in this track's index.md. It goes into the recipe as an unverified pitfall. |
| 2 | `vertex-gemini-adc` | FOUND | `dual-reader/src/ingestion/llm/geminiGenerator.ts:95-121` (f55fd89) | `new GoogleGenAI({ vertexai: true, project, location })` from `GCP_PROJECT`/`GCP_REGION`, with ADC (`gcloud auth application-default login`) and no `GEMINI_API_KEY`; the comment says why. |
| 2 | | FOUND | `tokentalos/lib/engine/llm_clients.js:14,58-105` (da18ba9) | `GoogleAuth` ADC, auto-detection of the project id from ADC, and a client cache per `project:location`. |
| 3 | `browser-tts-unlock-voice-binding` | FOUND | `otralingo/frontend/src/components/common/AudioUnlocker.tsx` (mounted in `otralingo/frontend/src/App.tsx:109`) (4b4ecd55) | A silent zero-volume utterance plus a WebAudio resume on the first click/touchstart/keydown fixes a silent first `speechSynthesis.speak()`. |
| 3 | | FOUND | `dual-reader/client/src/playback/audioUnlocker.ts:1-30` (installed at `client/src/main.tsx:37`) and `dual-reader/client/src/playback/speechSynthesisClock.ts:34-50,121` (f55fd89) | The port of the unlock to a second app, and the **explicit voice binding**: setting only `utterance.lang` gave no audio in Chrome; resolving a `SpeechSynthesisVoice` and assigning `utterance.voice` fixed it. |
| 4 | `vertex-imagen-retry-gcs-fallback` | FOUND | `the_hero_journey/functions/src/services/image-generation.ts:56-62,111-122,127-161,179-192` (04f1b95) | Imagen 4 predict through ADC (`GoogleAuth`), retry on 429/`RESOURCE_EXHAUSTED` with `2^n * 5000 + rand(0..2000)` ms up to 5 times, GCS upload, and a local `generated-images/` fallback when `LOCAL_DEV=true` or the upload fails. |
| 4 | | FOUND | `dual-reader/src/illustration/vertexImagenGenerator.ts:31-39,56-62,91-116` (f55fd89) | The same backoff ported with a test seam that skips the delay. |
| 5 | `makefile-local-run` | FOUND | `dual-reader/Makefile` (`help`, `install-all`, `env-file`, `db-local:75`, `db-seed`, `db-reset`, `dev:162`, `test-all`, `stop-all:181`, `deploy`) (f55fd89) | `make dev` takes a fresh clone to a running app (install, create and migrate the DB, seed, run); `.env` is created from `.env.example` and never overwritten; `stop-all` kills the dev ports. |
| 5 | | FOUND | `otralingo/Makefile` (`help:10`, `dev:47`, `db-local:97`, `db-seed:104`, `stop-all:146`, `install-all`, `test-all`) (4b4ecd55) | The same target names in an older product, so the names are a convention, not a one-off. |
| 6 | `postgres-local-neon-prod-secret-manager` | FOUND | `dual-reader/functions/index.mjs:2,19,26,40` + `dual-reader/scripts/deploy.sh:71-74` + `dual-reader/.env.example:12-20` + `dual-reader/Makefile:111` (f55fd89) | Dev uses local `postgresql://postgres:postgres@localhost:5432/<name>`; prod `DATABASE_URL` is the Secret Manager secret `DUAL_READER_DATABASE_URL` in `laneconductor-site`, bound with `defineSecret` and bridged to `process.env.DATABASE_URL`; schema pushes strip `-pooler` to use Neon's direct endpoint; prod scripts read the secret inline (`$(gcloud secrets versions access ...)`), never into a file. |
| 6 | | FOUND | `livingwork/functions/src/index.ts:22` (e3f8fef) | A second product binds its DB secret (`livingwork-database-url`). The secret names differ in style, so the recipe states a naming rule instead of claiming one exists. |
| 7 | `isolated-test-database` | FOUND (lesson) | `dual-reader/vitest.config.ts` (`env: { DATABASE_URL: ...dual_reader_test }`, comment "wiped the shared `dual_reader` DB mid-session, twice"), commit `27666b1` "fix: isolate test suite from the shared interactive dev database", `dual-reader/conductor/tech-stack.md:176`; also `livingwork/vitest.config.ts:17-19` (`livingwork_test`) | Tests that truncate tables must never point at the interactive dev DB; a forced test-DB override wins even when the shell sourced `.env`. |
| 7 | | NOT FOUND | (no code) | A **per-worktree** database (one DB per worktree or preview) is not implemented in any sibling repo. `dual_reader_test` is still shared by every worktree. The recipe states that part as unproven advice with no reference. |

## Requirements

### Format
- REQ-1: A recipe is a folder `recipes/<name>/` holding a `SKILL.md` and, optionally, `files/`
  (templates that `bootstrap_project` renders). `<name>` is kebab-case and equals the folder name and
  the `name` field. The folder is a valid skill folder, so copying it into `~/.claude/skills/` works
  with no conversion (reuse of skill tooling, V1/V2), although that is not how recipes are meant to
  be used.
- REQ-2: Top-level frontmatter uses only documented fields: `name`, `description`, `when_to_use`,
  `paths`, `metadata` (V1). `description` + `when_to_use` stay at or under 1,536 characters.
  `paths` keeps its documented meaning (file globs that signal relevance); `find_recipe` uses it
  against the target project's files.
- REQ-3: Recipe-specific fields live under `metadata` (a map), and none reuse a frontmatter field
  name (V1):
  - `kind`: `recipe` (a solved problem) or `process` (a how-to sequence, for example `new-project`,
    `extract-recipe`, or a lane file from track 10109).
  - `stack`: list of short lowercase tags (`gcp`, `firebase-hosting`, `vertex-ai`, `postgres`...).
  - `prerequisites`: list of plain sentences of what must be true first, credential steps included
    ("the user has run `gcloud auth application-default login`").
  - `reference`: list of `{ repo: owner/name, path, commit, proves }`. A pointer to real, tested code
    beats prose that rots.
  - `verified`: ISO date of the last check that every reference exists at its commit and the recipe
    still matches it, or `null` for a draft.
  - optional `smoke_check`: one read-only command the **user** may run to confirm the setup
    (never one that prints a secret).
- REQ-4: The body has these sections, in this order: `## Why this works for you` (the reasoning,
  phrased as advice), `## Recommendation` (what to do), `## Claude does` (file edits Claude may make),
  `## You run` (commands for the user, credential steps always here), `## Pitfalls`, and optionally
  `## Unproven` (advice with no reference). The body stays under 8,000 characters; anything longer is
  a sign the recipe holds generic knowledge.

### Library home
- REQ-5: The library is one git repo (decision D1; recommended: a dedicated repo at
  `<code>/lc-recipes`, private GitHub remote `meller/lc-recipes` created and pushed by the
  human). Layout: `recipes/<name>/...`, `conductor/advice-log/YYYY-MM.jsonl`, `README.md`. The
  connector reads it through 10106's `StateStore` (`LocalGitStore` locally, `GitHubStore` remotely),
  configured as `--recipes <path|owner/name>`.
- REQ-6: The library holds no secrets and no `.env` with values. `files/` may contain
  `.env.example` with variable names and empty or obviously fake values only.

### Tools (added to the 10106 connector; same envelope, error codes, annotations rules)
- REQ-7: `find_recipe`, `get_recipe`, `bootstrap_project` and `save_recipe` follow 10106's
  conventions: snake_case names, the common response envelope with `provenance` (describing the
  **library** repo's commit), `isError` results with the 10106 error codes plus one new code
  `RECIPE_NOT_FOUND` (not a connector error for KC-2), `readOnlyHint`/`destructiveHint` declared,
  responses under 40,000 characters. Contracts are in API Contracts below.
- REQ-8: `report_outcome` and `health_report` are reused unchanged in shape; `health_report` gains a
  per-recipe section when called with `project` = the library (REQ-15).

### Staleness
- REQ-9: Each served recipe carries `freshness` (`fresh` | `possibly_stale` | `stale`) and
  `stale_reasons`, reusing 10106's labels. The fixed reason list is extended with recipe reasons:
  - `stale` if `reference_missing` (a cited path does not exist at the reference repo's head) or
    `verified_missing` (`verified: null`).
  - `possibly_stale` if `verified_older_than_90d`, `reference_changed_since_verified` (the path's
    blob at head differs from its blob at the cited commit), or `reference_unresolvable` (the repo
    is not reachable from this surface).
  - The library repo's own 10106 reasons (`unpushed_local_commits`, ...) stay in `provenance`.
- REQ-10: Reference resolution. Locally, `owner/name` maps to a directory under the configured roots
  (default `~/Code/*`) whose `origin` URL matches after normalizing `https`/`ssh` and `.git`
  (folder names are not trusted, V6). Remotely, it is read through the GitHub App installation if the
  repo is covered, otherwise `reference_unresolvable`. Resolution never runs `git fetch`.
- REQ-11: Re-verification is on request, never scheduled by the connector: `health_report` lists
  stale recipes; Claude re-checks the references, the user runs `smoke_check` if any, and
  `save_recipe` bumps `verified`.

### Credentials (firm)
- REQ-12: No recipe content, template, `vars` value, tool response or log line may contain a secret
  value. A scanner runs in the format checker, in `save_recipe` (rejects with `VALIDATION_FAILED`)
  and over rendered `bootstrap_project` output (rejects). Patterns, at least: Google API keys
  (`AIza[0-9A-Za-z_-]{35}`), private-key blocks (`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
  `"private_key":` in JSON, GitHub tokens (`gh[pousr]_[0-9A-Za-z]{36,}`, `github_pat_`), `sk-` style
  keys (`sk-[A-Za-z0-9_-]{20,}`), AWS key ids (`AKIA[0-9A-Z]{16}`), and connection URLs with a
  password on a non-localhost host (`postgres(ql)?://[^:/\s]+:[^@\s]+@(?!localhost|127\.0\.0\.1)`).
- REQ-13: Every checklist step that creates, reads, rotates or stores a credential, signs in, or
  deploys is `who: "user"`. Claude presents those commands and never runs them, never asks the user
  to paste their output into the chat, and never writes a value into `.env`. A command that pipes a
  secret into a subprocess (for example `DATABASE_URL="$(gcloud secrets versions access ...)" ...`)
  is packaged as a Makefile target the user runs.

### Accountability
- REQ-14: Recipe events go into the library repo's advice log (decision D2), in 10106's line format
  (`v: 1`), with `item: "recipe:<name>"`, `source: "repo:<library>/recipes/<name>/SKILL.md@<blob>"`
  and one added optional field `project` (where the advice was used; `owner/name` or a folder name,
  never a full local path). Lines without `project` stay valid. The recipe file never stores its
  history (no churn).
- REQ-15: `health_report` with `project` = the library returns, per recipe: served, followed,
  deviated, failed, unreported, override rate, top 3 deviation reasons, freshness, and flags:
  `rewrite_or_delete` when overridden at least 50% with at least 5 outcomes (10106's REQ-20 rule),
  and `reverify` when `failed` >= 2 in the window or `freshness` is `stale`. `find_recipe` results
  carry the same `health` summary so Claude sees a flagged recipe before choosing it.

### Extract and retire
- REQ-16: "Extract a recipe" is a process recipe (`extract-recipe`, `kind: process`) plus a two-line
  pointer in the done lane (`lanes/merge.md`): after a track lands, Claude asks the human whether it
  solved a problem a future project would hit again. Criteria: (1) a choice or convention of this
  user, not derivable from public docs; (2) a working reference exists at a commit; (3) it cost real
  time to find. Claude runs `find_recipe` first and prefers updating an existing recipe over adding a
  near-duplicate.
- REQ-17: Claude drafts, runs the format checker, shows the draft, and calls `save_recipe` only after
  the human agrees (decision D3). Retiring a recipe (flagged `rewrite_or_delete`, or a reference
  gone with no replacement) is `save_recipe` with `retire: { reason }`: the folder is deleted in one
  commit whose message carries the reason and the health numbers; git history keeps the text.
  Retired recipes no longer appear in `find_recipe`.

### Glue
- REQ-18: One paragraph is added to 10106's server instructions (keeping the total under 4,096
  characters): "Before setting up a new project, hosting or deploys, a database, auth, or an AI/LLM
  API, call find_recipe: recipes are this user's proven conventions from past projects. They are
  advice; if you go another way, say why with report_outcome. Recipes never contain secrets;
  credential steps are commands for the user to run." Fallback if 10106's U1 fails on claude.ai: the
  same one-line pointer in claude.ai project instructions, and in Claude Code a tiny personal skill
  whose `when_to_use` names these triggers and says "call find_recipe".

## Acceptance Criteria (observable outcomes)

- [ ] AC-1: In an empty scratch directory, with the connector configured and no other prompting,
  "create a new project for me called <x>: a Vite web app with an Express API and Postgres" leads
  Claude to call `find_recipe` and `bootstrap_project`, and the directory then contains a
  `.firebaserc` targeting `laneconductor-site` with a hosting target `<x>`, a `firebase.json` with
  `codebase: "<x>"` and an `/api/**` rewrite, a Makefile whose `make help` lists `dev`, `db-local`,
  `db-seed`, `db-reset`, `test-all`, `stop-all`, `deploy`, and a `.env.example` with `GCP_PROJECT`,
  `GCP_REGION` and an empty prod DB slot; Claude's reply lists the user-run checklist. After the user
  runs that checklist, `make db-local` creates the local database and `make deploy` (run by the user)
  publishes a page at `https://<x>-laneconductor.web.app`.
- [ ] AC-2: Each of the 7 seed recipes passes the format checker, cites at least one reference that
  exists at its cited commit, and has a `verified` date; recipe 7 lists its per-worktree part under
  `## Unproven`.
- [ ] AC-3: Copying any recipe folder into `~/.claude/skills/` makes it appear in Claude Code's skill
  listing with no frontmatter error (the format is a real skill format); the copy is then removed.
- [ ] AC-4: For recipe 1, the paired baseline (test.md Phase 1) shows the recipe run scoring at least
  2 rubric points above plain Claude, with zero credential violations, or the result is recorded and
  the format is rethought before Phase 2.
- [ ] AC-5: After at least 5 recorded outcomes on a recipe with at least half `deviated`,
  `health_report` on the library flags it `rewrite_or_delete` and shows its top reasons, and
  `find_recipe` shows the flag.
- [ ] AC-6: A planted fake key in a recipe draft is rejected by `save_recipe` and the checker; no
  tool response or advice-log line in the acceptance run contains a secret; every credential step in
  the AC-1 checklist is marked for the user.
- [ ] AC-7: At the end of a real track, the extract step produces a new or updated recipe after the
  human agrees; a retired recipe disappears from `find_recipe` and its retire commit names the reason.

## API Contracts / Data Models

### Example recipe (complete): `recipes/shared-gcp-firebase-site/SKILL.md`

```markdown
---
name: shared-gcp-firebase-site
description: Host a new product as its own Firebase Hosting site plus its own Functions codebase inside the shared laneconductor-site GCP project, with deploys scoped to that product only. Not a new GCP project per product.
when_to_use: Use when a new web app needs hosting, an API on Cloud Functions, or a deploy target; when about to run "gcloud projects create" or "firebase projects:create"; or when writing firebase.json or .firebaserc.
paths: firebase.json, .firebaserc
metadata:
  kind: recipe
  stack: [gcp, firebase-hosting, firebase-functions-v2, nodejs22, vite]
  prerequisites:
    - The user is signed in to the firebase and gcloud CLIs with access to laneconductor-site (the user runs the sign-in).
    - The product has a short kebab-case id, used for the site, the hosting target and the codebase.
  reference:
    - repo: meller/dual-reader
      path: .firebaserc
      commit: f55fd89
      proves: hosting target dual-reader -> site dual-reader-laneconductor in laneconductor-site
    - repo: meller/dual-reader
      path: firebase.json
      commit: f55fd89
      proves: codebase dual-reader, nodejs22, /api/** rewrite to the product's function
    - repo: meller/dual-reader
      path: scripts/deploy.sh
      commit: f55fd89
      proves: every deploy is scoped with --only hosting:<p>,functions:<p>:<fn>
    - repo: meller/livingwork
      path: firebase.json
      commit: e3f8fef
      proves: the same pattern in a second product
  verified: 2026-11-15
  smoke_check: firebase hosting:sites:list --project laneconductor-site
---

## Why this works for you
All of your recent products (dual-reader, livingwork, humanities-explorer, the_hero_journey,
chesstrainer) share one GCP project, `laneconductor-site`. Each gets its own Hosting site and, in
the newer ones, its own Functions codebase, so one project holds billing, Secret Manager and ADC
for everything. On Dual Reader, trying a new GCP project per product ran into a project quota
(unverified; see Pitfalls).

## Recommendation
- Site id `<product>-laneconductor`, hosting target `<product>`, Functions `codebase: "<product>"`,
  runtime `nodejs22`, one HTTPS function named `<product-without-dashes>api`.
- Rewrites: `/api/**` to the function, `**` to `/index.html`.
- Deploy only this product: `firebase deploy --only hosting:<product>,functions:<product>:<fn>`,
  wrapped in `make deploy` (see the makefile-local-run recipe).

## Claude does
- Write `.firebaserc` and `firebase.json` from `files/` (bootstrap_project renders them).
- Add `GCP_PROJECT=laneconductor-site` and `GCP_REGION=us-central1` to `.env.example`.

## You run
1. `firebase hosting:sites:create <product>-laneconductor --project laneconductor-site`
2. `firebase target:apply hosting <product> <product>-laneconductor --project laneconductor-site`
3. `make deploy` once the app builds (it deploys only this product).

## Pitfalls
- Never `firebase deploy` without `--only`: in a shared project it can touch sibling products.
- humanities-explorer and the_hero_journey still use `codebase: "default"`; do not copy that. A
  product-named codebase keeps one product's deploy from treating another's functions as removed.
- Use `/api/**`, not `/api**`: Hosting's `/prefix**` glob stays within one path segment
  (laneconductor track 10052).
- A bare `/healthz` is reserved by Google's frontend on Functions v2 and Cloud Run; use `/api/healthz`.
- Unverified: a new GCP project per product hit a project quota during the Dual Reader build.
```

`files/.firebaserc.tmpl` and `files/firebase.json.tmpl` hold the two files with `{{product}}` and
`{{function}}` placeholders. Phase 1 confirms the codebase pitfall against the Firebase docs and
removes it if it does not hold.

### Template rendering
`{{var}}` placeholders only, no logic. Built-in vars: `product` (the `name` input), `function`
(`product` with dashes removed, plus `api`), `gcp_project` (`laneconductor-site`), `gcp_region`
(`us-central1`). Other vars come from `vars`. An unresolved placeholder is reported in
`missing_vars` and the file is still returned with the placeholder left in place.

### Tools

| Tool | readOnlyHint | destructiveHint | idempotentHint |
|------|---|---|---|
| `find_recipe` | true | false | true |
| `get_recipe` | true | false | true |
| `bootstrap_project` | true (it returns files; Claude writes them, decision D4) | false | true |
| `save_recipe` | false | **true** (replaces or deletes a recipe) | false |

All take the optional `project` from 10106 (the project the work is for, recorded as the log's
`project` field). The library is the server's `--recipes` setting.

1. **`find_recipe`** — input `{ query?: string, stack?: string[], paths_hint?: string[] (file names present in the target project), kind?: "recipe"|"process", limit? = 10 (max 25) }`; at least one of `query`, `stack`, `paths_hint`.
   Ranking is deterministic: token overlap of `query` with `name`, `description` and `when_to_use`;
   `stack` tag overlap; `paths` globs that match `paths_hint`. No embeddings.
   data `{ recipes: [{ name, kind, description (<= 300 chars), stack, verified, freshness, stale_reasons, health: { served, followed, deviated, failed, override_rate, flags: [] }, score }], total }`.
   Logs `empty_result` when nothing matches. Does not log a `serve` (descriptions only).
2. **`get_recipe`** — input `{ name, include_files? = false }`.
   data `{ recipe: { name, frontmatter, body, files: [{ path, bytes, sha, content? }], source }, freshness, stale_reasons, health, framing, serve_id, base }`.
   `framing` is fixed text: "Advice from this user's past projects, not an order. If you go another
   way, do it and call report_outcome with serve_id and a one-line reason." `base` follows 10106's
   REQ-4 shape (`{ commit, files: { "<path>": blobSha } }`) for a later `save_recipe`.
   Logs one `serve`. Errors: `RECIPE_NOT_FOUND`.
3. **`bootstrap_project`** — input `{ name (kebab-case, 1..40), recipes: string[] (1..10, names), vars?: { [key]: string } }`.
   data `{ files: [{ path, content, recipe, on_exists: "skip"|"merge_by_hand" }], checklist: [{ recipe, step, command, why, who: "user"|"claude" }], recommendations: [{ recipe, text }], conflicts: [{ path, recipes }], missing_vars: [], serve_ids: { "<recipe>": "s_..." } }`.
   It renders and returns; it writes nothing (D4). Claude writes the files with its own tools, never
   overwriting an existing file without asking. Every credential, sign-in and deploy step is
   `who: "user"` (REQ-13). Logs one `serve` per recipe with `tool: "bootstrap_project"`. Errors:
   `RECIPE_NOT_FOUND`, `VALIDATION_FAILED` (bad name, a `vars` value or rendered file that trips the
   secret scanner, more than 10 recipes).
4. **`save_recipe`** — input `{ name, content?: string (full SKILL.md), files?: { "<relpath>": string | null }, base?: (from get_recipe; required when the recipe exists), retire?: { reason (<= 500 chars) } }`; `content` or `retire`, not both.
   Validates with the format checker and the secret scanner, checks `base` per 10106 REQ-4, then
   commits `chore(recipes): save <name> via lc-connector` or
   `chore(recipes): retire <name>: <reason>` (body: the recipe's health numbers). Push follows 10106
   decision D4. data `{ written: [...], commit, base }`. Errors: `CONFLICT`, `VALIDATION_FAILED`,
   `RECIPE_NOT_FOUND` (retire of a missing recipe), `WRITE_FAILED`. The tool description says to
   call it only after the human approved the text (D3).

### Advice log lines (library repo, `conductor/advice-log/YYYY-MM.jsonl`)
```jsonc
{"v":1,"ts":"2026-12-01T09:00:00Z","kind":"serve","id":"s_01K…","session":"c_…","surface":"claude-code",
 "tool":"get_recipe","item":"recipe:shared-gcp-firebase-site",
 "source":"repo:meller/lc-recipes/recipes/shared-gcp-firebase-site/SKILL.md@3b1c…",
 "project":"meller/pinecone","chars":3920,"latency_ms":21,"commit":"9e8d7c6"}
{"v":1,"ts":"…","kind":"outcome","serve_id":"s_01K…","outcome":"deviated",
 "reason":"user wants billing isolated for a client project; created a separate GCP project",
 "project":"meller/pinecone","surface":"claude-code"}
{"v":1,"ts":"…","kind":"empty_result","tool":"find_recipe","surface":"claude-code","project":"meller/pinecone"}
```
No prompts, file contents or secrets are logged, as in 10106.

## Out of scope
- The connector server itself, its storage backends, auth and hosting (track 10106).
- A web UI for the library.
- Semantic or embedding search (deterministic ranking is enough at tens of recipes).
- Scheduled re-verification (the connector never schedules work).
- The later recipes (OAuth, cache buster, PWA, Prisma, onboarding, the tokentalos LLM pattern):
  plan.md Phase 9, unchecked.
