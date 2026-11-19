# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. It runs when the person names it, or says `go` to the card of `next` that named it:
the card names the command and `go` is the consent. The result is a `conductor/` folder of plain files in git. Nothing is committed without a yes, and nothing is ever pushed.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Setup writes first: new files are additive and one line undoes them, so there is no confirmation before the files. A folder with no code and no plan document (empty, or only a README or licence) is a new project: say in one line that `/laneconductor:new-project` is the command for it (a brainstorm, the scaffold, first tracks, suggested skills) and stop. Otherwise:

1. **Read the project** and ask nothing the files already answer:
   - The name and purpose (`package.json`, `pyproject.toml`, the README; else the folder name), the stack (dependencies and config files) and the commands that really exist (scripts in `package.json`, the Makefile, the CI files). The npm placeholder `echo "Error: no test specified"` is not a test command, and a lint config without a lint script is not a lint command.
   - The plan documents ("The first-track card" in [next.md](../ops/next.md) says which): their items, counted for "Found your plan in `docs/plan.md`: 6 items"; nothing when there is none.
   - The tracks choice, declared and never asked: private when something says the project is public (the README says public, public demo or open source; an open-source LICENSE file; a `package.json` `license` other than UNLICENSED or proprietary) or `git remote` is empty (nothing to share); committed when there is a remote and no such sign. Private tracks are git-ignored (step 3).
2. **Stop and ask first, one line each, only for something unusual**: a `conductor/` folder with content (an older LaneConductor: how many tracks, in which naming form, which lanes; offer to finish the scaffold: write only what is missing, import nothing, change no track); no git repository (offer `git init` first); uncommitted changes in `.gitignore`, the one existing file setup edits (offer to go on, or to wait while they commit it). Anything else: write.
3. **Write** the files that are missing ([../ops/new-project.md](../ops/new-project.md), step 3 "Scaffold"; the files and templates are in [scaffold.md](scaffold.md) and [templates.md](templates.md)). No existing file of the project is touched, and `.gitignore` only gets the lines it lacks. Add no walking-skeleton track.
4. **File the plan items.** With a plan document, file its first four items as tracks, in the plan's order and the plan lane, as "The answer" of the first-track card says (the `new` procedure: search first, then `create_track` when that tool is present, else by hand as `newTrack` writes the files: next free number, unpadded, heading `# Track AM-1: <Title>`, id only; the plan item as the problem, its source file named). No question. The plan's open questions are not filed: list them. With no plan document nothing is filed.
5. **A stale project-level skill** is one more line in the closing message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L`, `git ls-files`): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
6. **Close with ONE message**, after the files and the tracks, filled in from what you did and nothing else:

> **my-app**: a command-line tool that sorts notes (Node.js).
> Created `conductor/` (context files, an empty `tracks/`) and the `.gitignore` lines.
> Tracks are private (git-ignored) because the README says this is a public demo. Say 'commit my tracks' to share them.
> Found your plan in `docs/plan.md`: 6 items. Filed the first four as tracks in the plan lane: 1 A publish checklist, 2 An /openapi.json door, 3 A /prompt paste pack, 4 Plugin packaging. Open question, not filed: browse-only dry-run variants.
> Undo: `rm -r conductor`, then `git checkout .gitignore`.
> The conductor files are not committed; say commit when you want them committed.
> **See it on the board:** the board line of the first-track card ([next.md](../ops/next.md)).
> **Plan the first track:** `/laneconductor:plan 1` ("A publish checklist").
> Board, or plan the first track?

   Exactly two offers and one question, nothing after them: no add-ons paragraph, no starter set (`/laneconductor:suggest-skills` has it), no "Next: run `/laneconductor:next`". Committed tracks say "Tracks are committed with the code. Say 'make tracks private' to keep them out of git." A count you state comes from a command run for that purpose (`git rev-list --count HEAD`), never from a truncated listing. Say nothing about what does not exist or does not apply. With no plan document nothing was filed: end with the first-track card instead of the two offers. On "commit": `git add` the files you created, by name (never `git add -A`), make one commit and never push.

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview.
