# Track AM-10107: LaneConductor recipe library: discoverable skills + bootstrap_project

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planned
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Depends On**: 10106
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: Build the LaneConductor recipe library: a knowledge base of already-solved technical problems in this user's stack, discoverable on demand through the connector (track 10106) - effectively "discoverable skills" that nobody has to install. Goal: tell Claude "create a new project for me" and have it apply the user's own proven conventions instead of rediscovering them.

WHY: the Dual Reader build (2026-09-20/21) showed that almost every hard moment was a problem already solved in a sibling repo, found only because the user remembered where to look: the shared laneconductor-site GCP project with one Firebase Hosting site + Functions codebase per product (reverse-engineered from four projects' .firebaserc/firebase.json after wrongly trying a GCP project per product and hitting quota), Vertex AI/Gemini through ADC with no API key (tokentalos), the browser TTS audio-unlock (otralingo AudioUnlocker) that fixed silent speechSynthesis, the Imagen retry/backoff + GCS upload with local fallback (the_hero_journey), the Makefile local-run convention. Claude does not lack general knowledge; it lacks THIS user's conventions.

RECIPE vs SKILL: a skill is a verb (how Claude works: plan, review, debug); a recipe is a noun (a solved problem: "shared-GCP Firebase deploy"). Skills are few and always listed in context; recipes are many and must be SEARCHED via a tool, never all loaded. A recipe also carries reference code and a verification, and can be applied by bootstrap. The "new project" skill is the process; recipes are the library it draws from.

DESIGN DECISIONS:
1. Reuse the skill frontmatter (name, description) and add: stack, prerequisites, reference (path/repo of a working implementation), verified (date), files (artifacts to apply), pitfalls, optional smoke_check. Prefer a pointer to real tested code over prose that rots.
2. Only record what Claude cannot derive: this user's conventions and choices (e.g. local Postgres dev + Neon prod via GCP Secret Manager), not generic Prisma/OAuth knowledge.
3. CREDENTIALS RULE: recipes may give the exact commands the user must run (gcloud ADC login, Secret Manager setup) but Claude never handles, enters, or echoes keys or secrets.
4. Home: a cross-project location read by the connector through git - laneconductor-meta already exists; alternatively a dedicated recipes repo. Decide during planning.
5. Connector tools: find_recipe (query/stack), get_recipe(id), bootstrap_project(name, recipes[]) which applies chosen recipes (scaffold files + a user checklist), and an "extract a recipe" step in the done lane/skill so knowledge compounds as tracks solve new problems.
6. Staleness: each recipe has a last-verified date and ideally a smoke check; periodic re-verification.
7. Needs the always-on glue from track 10106 (server instructions saying "check LaneConductor for a recipe before building X"); on-demand discovery only helps if Claude actually searches.

SEED RECIPES (extract first): (1) shared GCP project + per-product Firebase site/Functions codebase; (2) Gemini/Vertex via ADC, no API key; (3) browser TTS audio unlock + explicit voice binding; (4) Vertex Imagen with retry/backoff + GCS upload with local-dev fallback; (5) Makefile local-run convention (make dev/db-local/db-seed/stop-all); (6) local Postgres dev + Neon prod via GCP Secret Manager; (7) per-worktree DB isolation lesson (tests that reset a shared dev DB wipe other previews). Later: OAuth, cache buster, PWA, Prisma, onboarding, tokentalos LLM pattern.

ACCEPTANCE: "create a new project for me" through the connector selects and applies relevant recipes and reproduces the GCP/ADC/Makefile setup without manual guidance; each seed recipe points at a working reference and carries a verified date; the format passes review for reuse of skill tooling.

OUT OF SCOPE: the connector server itself (track 10106); the web UI.
**Summary**: Build the LaneConductor recipe library: a knowledge base of already-solved technical problems in this user's stack, discoverable on demand through the connector (track 10106) - effectively "discoverable skills" that nobody has to install. Goal: tell Claude "create a new project for me" and have it apply the user's own proven conventions instead of rediscovering them.

## Direction update (2026-11-15)

- Use the skill frontmatter's documented `metadata:` field (a free-form YAML map for your own key-value data) for recipe-specific fields (stack, prerequisites, reference, verified) instead of inventing undocumented top-level keys. Documented fields to reuse: name, description, when_to_use, paths, metadata.
- Description plus `when_to_use` is truncated at 1,536 characters in the listing - another reason recipes must be searched on demand through the connector rather than listed in context.
- Lane files produced by the skill restructure (track 10109) are natural recipe-style content for the connector to serve on demand.

## PRINCIPLE (2026-11-15): LaneConductor is a second opinion, never a controller

LaneConductor advises; Claude may always decide against it. Recipes, lane order, conventions and tool results are phrased as recommendations with their reasoning ("this worked for you because..."), never as orders. Only two things are firm, and neither is LaneConductor outranking Claude: (a) mechanical integrity - file formats and the base-commit check that prevents silent overwrites; (b) the human's authority - ask before merge/push, never handle secrets (Claude may disagree, but says so and asks). When Claude deviates from advice it says why, and that deviation is recorded so the recipe can be improved or pruned; a recipe Claude keeps overriding is a bad recipe.

## REQUIREMENT (2026-11-15): recipes are accountable

Each recipe's served/followed/overridden history lives in the advice log (track 10106), not in the recipe file (no churn). A recipe overridden most of the time is flagged for rewrite or deletion; the "extract a recipe" step also covers retiring one. The user must be able to see which recipes are failing.

## Correction (verified 2026-11-15): the "shared GCP project" is not universal

Earlier text in this track/session said every sibling product (humanities-explorer, otralingo, macrodash, livingwork) deploys into the one shared `laneconductor-site` project. Checked against each repo's `.firebaserc`: livingwork, humanities-explorer and dual-reader default to `laneconductor-site`; otralingo defaults to `otralingo` and macrodash to `makrodash` (their own projects). The shared-project layout is a real convention for SOME products, not all - treat it as a recipe to apply deliberately, not "the" convention. Decide which layout is intended for new products.
