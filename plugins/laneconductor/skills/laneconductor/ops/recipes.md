# recipes: find, rank and list

A recipe is something already solved in a person's stack, written so Claude can do it again: a folder
`recipes/<name>/` holding `SKILL.md` (why it works, what Claude does, what the person runs, pitfalls) and
`files/` (the files it writes, mirroring the project paths). Recipes are resources of this skill, read when needed
and never registered as skills of their own, so they cost nothing until one is read. `/laneconductor:recipes` lists
them; `new-project` ([new-project.md](new-project.md)) recommends from them; applying one is
[apply-recipe.md](apply-recipe.md); adding one is [add-recipe.md](add-recipe.md).

Recommend, never order: a recipe is advice with a date. The person picks, may deviate, and the reason is written down.

## Two libraries, read in this order

1. The **shipped** library: `recipes/` in this skill folder. Generic recipes only, each one cleared by the privacy gate
   (see [add-recipe.md](add-recipe.md), "Publishing a recipe in the shipped library").
2. The person's **own** library: a local git repository named by `recipes.path` in `.laneconductor.json`, else the
   `LC_RECIPES` environment variable. Same layout (`recipes/<name>/`). Read it, never write to it except through
   `add-recipe` with the person's yes. Personal recipes (project ids, site names, private repositories) live only there.

A recipe with the same name in both is shown once, from the person's own library (the more specific one wins).
Neither library has to exist: with none, say "No recipes were available" and carry on. A library that is named but
missing is worth one line ("recipes.path points to X, which is not there"), not an error.

## Find and rank

1. Turn the answers into **stack tags**: short lowercase words the way recipes write them (`nodejs22`, `gcp`,
   `firebase-hosting`). To see which tags the libraries actually use, run
   `node <path>/lc-recipe-match.mjs --vocabulary`; pick from those, and add nothing the person did not say.
2. Run `node <path>/lc-recipe-match.mjs --tag <tag> --tag <tag> --repo .` (scripts: see "Scripts" below). It reads both
   libraries in the order above and prints JSON: the libraries read, the matches (at most five), a `note`, and for each
   match its `why`, `verified` date, `warnings` and `prerequisites`.
3. Rank is deterministic: more shared tags first, then how much of the recipe's own stack is covered, then the newer
   `verified` date, then the name. A recipe sharing no tag is not a match. Do not reorder by taste; if you think the
   order is wrong, say so and why, and show the script's order too.
4. Show at most five, one line each: name, why it fits, `verified` date, any warning. A **warning** is
   `reference_changed_since_verified` (a cited file changed since the recipe was checked: "may be out of date"),
   `reference_missing`, `verified_older_than_90d` or `verified_missing`. `references_not_checked: true` only means this
   machine has no checkout of the cited repository; say "not re-checked here", not "stale".
5. The `prerequisites` are sentences, not scored: read them to the person and let them confirm each applies.
6. `note` set (no library, or nothing matched): say it and move on.

Without the script (the Markdown-only variant): read `recipes/*/SKILL.md` frontmatter in both libraries and rank by hand
with the same rule, say that you did, and skip the freshness check.

## List (`/laneconductor:recipes [stack words]`)

Same script with `--all` (everything, no limit) or with tags from the words given. Read only: change nothing, apply
nothing. For each recipe show name, library, one line of description, `verified`, warnings.

## Scripts

The scripts (`lc-recipe-match`, `lc-recipe-check`, `lc-recipe-gate`, `lc-recipe-apply`, `lc-recipe-save`, `lc-scaffold`)
are `*.mjs` files under `server/bin/` in the plugin: find them with Glob `**/laneconductor/**/server/bin/<name>.mjs`
under `~/.claude/plugins` (`${CLAUDE_PLUGIN_ROOT}` may not be substituted in command text); in the LaneConductor
repository they are in `connector/bin/`. Run them with `node`. None of them pushes; `lc-scaffold` and `lc-recipe-apply` never overwrite an
existing file; `lc-recipe-apply` writes only with `--write`, `lc-recipe-save` only with `--approved`, and `lc-scaffold` has `--dry-run`.
If a script is missing, do its step by hand as described and say that you did.
