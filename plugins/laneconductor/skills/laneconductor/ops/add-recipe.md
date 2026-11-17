# add-recipe: `/laneconductor:add-recipe [what was solved]`

Turn something that was solved and worked into a recipe in the person's OWN library. Run it only when the person asks
by name. Nothing is saved without their yes, the save is a local commit, and nothing is ever pushed.

## 1. Is it a recipe? (criteria)

A recipe must be all four; if one fails, say which and stop, or offer to put it in the project's notes instead:

1. **Reusable**: it will come up again, in a different project of this person's stack.
2. **Verified in real use**: it worked, not "should work". Name where (a repository and commit, a deploy that ran).
3. **Not obvious to a plain Claude**: it would not be done right from general knowledge alone.
4. **Names a real incident or fact**: the thing that went wrong, or the limit that was hit, with the evidence.

## 2. Find before you add

Search both libraries ([recipes.md](recipes.md), `lc-recipe-match --all`, and read the close ones). If a recipe already
covers it, UPDATE that one (same name, new facts, new `verified` date) instead of adding a near-duplicate. If it covers
part, say so and ask whether to extend it. If the existing recipe is in the shipped library, make the update as a
personal copy with the same name; the shipped one is not edited from here.

## 3. Draft

Write the draft in a scratch folder named for the recipe: `<scratch>/<name>/SKILL.md` and `<scratch>/<name>/files/...`
(outside any library). The format, which the checker enforces:

- Frontmatter: `name` (kebab-case, equal to the folder name), `description` and `when_to_use` (together under 1,536
  characters; say what it does and when to use it), optional `paths`, and `metadata` as a map with `kind`
  (`recipe` or `process`), `stack` (short lowercase tags), `prerequisites` (plain sentences), `reference` (a list of
  `repo` as owner/name, `path`, `commit` as a quoted hex string, `proves`: a pointer to working code beats prose),
  `verified` (an ISO date, or null for a draft) and optionally `smoke_check` (one command on one line).
- Body sections, in this order: `## Why this works for you`, `## Recommendation`, `## Claude does`, `## You run`,
  `## Pitfalls`, then optional `## Unproven` (what was not checked). Body under 8,000 characters.
- `files/` mirrors the project paths the recipe writes. A file that needs the project's own values ends in `.tmpl`
  and uses `{{var}}`; use `.env.example.tmpl` with empty values, never a `.env`.
- Nothing secret, no email or phone number, and no private name that belongs only to this project: use `{{vars}}`.

## 4. Check and show the result

Run `node <path>/lc-recipe-save.mjs --lib <personal library> --draft <scratch>/<name>` WITHOUT `--approved`. It runs the
checker (format, secrets, references resolve) on the draft and prints one line per finding, then says "needs approval".
Show the person that result as it is, plus the draft. Fix errors and run it again; warnings (for example a reference
repository that has no local checkout) are shown, not hidden. By hand: run `lc-recipe-check` on a folder that holds the
draft as `recipes/<name>/`, or check each rule above yourself and say it was by hand. The scripts are located as in
[recipes.md](recipes.md) ("Scripts").

## 5. Ask, then save

Ask: "Save this recipe to your library at <path>?". Only on a clear yes run the same command with `--approved`. It
writes `recipes/<name>/` into the library and makes ONE local commit (`recipe: add <name>` or `recipe: update <name>`)
that touches only that folder. The library must be its own git repository. Report the commit and say it is not pushed;
pushing is the person's decision, and if they want it, say what would be pushed and ask again.

## 6. Retire or update later

- **Update**: run steps 2 to 5 again with the same name; the old files are replaced and history keeps the old version.
- **Retire**: when a recipe is wrong or obsolete, run `lc-recipe-save --lib <library> --retire <name>` (with
  `--approved` only after the person's yes): one local commit that removes the folder; history keeps it. Tell the
  person why it was retired, and note it in the track that prompted it.

## Publishing a recipe in the shipped library

A recipe goes into this skill's own `recipes/` (and so into the public plugin) only after ALL of these:

1. `lc-recipe-check` is clean on it.
2. `lc-recipe-gate <recipe folder>` passes: no secret, email or phone number, and no name from the person's local deny
   list (`conductor/recipe-deny.local.txt`, one private project id, site or repository name per line, never committed).
3. It names no private project, site, repository or person, or those are replaced by `{{vars}}` (read it once yourself).
4. The person approved THAT recipe for publication, recorded in the track that adds it.

Without all four it stays in the personal library. Do not read the deny list aloud or copy its entries into any file.
