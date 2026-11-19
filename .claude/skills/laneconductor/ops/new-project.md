# new-project: `/laneconductor:new-project [name or idea]`

Start a project from a short conversation: interview, scaffold, first tracks. Run it only when the person asks for it by
name. Nothing is committed without their yes, and nothing is ever pushed.

The scaffold script named below, `lc-scaffold.mjs`, belongs to the optional laneconductor-parallel add-on. Find it with Glob
`**/laneconductor-parallel/**/server/bin/lc-scaffold.mjs` under `~/.claude/plugins/cache`, or in the LaneConductor repository under `connector/bin/`.
If it does not exist, do that step by hand exactly as described; the result is the same, only slower. Do not recommend the
add-on for this.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## 1. Detect the situation

- Empty or nearly empty folder (no code and no plan document; a README, licence or `.gitignore` alone does not count): a new project: `/laneconductor:new-project` is the command for it, not `setup`. Ask for a name if the argument gave none.
- An existing repository (a `.git`, or files other than `conductor/`): offer only the `conductor/` scaffold (`/laneconductor:setup`
  takes this path). Read what is there first ("Existing repository" below) and ask less. Never overwrite a file.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes), import nothing, offer only the missing `conductor/` context files and leave every track as it is;
  importing them is a separate yes ([../setup/scaffold.md](../setup/scaffold.md), "Older tracks"). `new` creates tracks.

### Existing repository

Keep the interview short. Instead of the nine questions of step 2, read the project and ask only to confirm:

- The name and purpose (`package.json`, `pyproject.toml`, the README; else the folder name), the stack (dependencies and config
  files) and the commands that really exist (scripts in `package.json`, the Makefile, the CI files). The npm placeholder
  `echo "Error: no test specified"` is not a test command, and a lint config without a lint script is not a lint command.
- The plan documents ("The first-track card" in [next.md](next.md) says which): one line, "Found your plan in `docs/plan.md`: 6 items", the count from the items you read; nothing when there is none.
- If the scaffold script is present, `node <path> --detect --dir .` does this reading and prints `answers` (what to
  confirm), `evidence` (where each fact came from) and `existing` (what an older LaneConductor left). Otherwise read the files
  yourself the same way.

Show the result as ONE message in this form, at most twelve lines, everything filled in (for a public-looking repository):

> **my-app**: a command-line tool that sorts notes.
> Stack: Node.js, no dependencies.
> Commands: `npm start`, `npm test`.
> Found your plan in `docs/plan.md`: 6 items.
> I will create `conductor/` (context files, an empty `tracks/`) and the `.gitignore` lines.
> Tracks are private (git-ignored) because the README says this is a public demo. Say 'commit my tracks' to share them.
> Reply ok, or tell me what differs.

Never ask whether tracks are committed or private: decide from facts and declare it in that one line. Private when something says the project is public (the README says public, public demo or open source; an open-source LICENSE file; a `package.json` `license` other than UNLICENSED or proprietary) or `git remote` is empty (nothing to share); committed when there is a remote and no such sign, declared as "Tracks are committed with the code. Say 'make tracks private' to keep them out of git." Private adds the missing ones of `conductor/tracks/`, `conductor/tracks-summary.md` and `conductor/advice-log/` to `.gitignore`. Add a line only for something unusual (an existing `conductor/` folder, a stale project-level skill, a conflict). Say nothing about what does not exist or does not apply: no list of commands left out, no "nothing to clean up", no "no optional plugins", no "I will not touch your README", no repository facts (a count you do state comes from a command run for that purpose, `git rev-list --count HEAD`, never from a truncated listing). Write nothing until that reply; it is the yes.
Do not add the walking-skeleton track to an existing project: pass `--no-first-track` to the scaffold script, or skip it by hand,
and suggest planning the first real track instead.

## 2. Interview

This is a brainstorm, in the style of [../lanes/brainstorm.md](../lanes/brainstorm.md): ONE question per message, adaptive, short, in chat (there
is no track yet, so no `conversation.md`). Explore before you decide: for a choice that shapes the project (the stack, the data, hosting, authentication) give two or three options with the trade-off in a line and a recommendation, and let the person choose. Write no file until the interview is done and they say to scaffold. Cover, in
this order, and skip what the person told you or the repository shows:

1. What is it for, and who uses it
2. The three key features
3. Language and stack
4. Data (what is stored, how much)
5. Authentication
6. Hosting and the deploy target
7. AI use (none is a fine answer)
8. Testing (which commands really exist, or will exist in the walking skeleton)
9. Constraints (budget, deadline, compliance, things to avoid)

Stop early when the answers are enough to scaffold; say "That is enough to start". Ask for 2 to 4 letter initials for track
ids last, only if the folder has none to reuse. Record the answers as you go, as the JSON that the scaffold script reads: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
testing, other), `constraints`, `commands` (typecheck, lint, test, build, coverage, audit, e2e: ONLY commands that
exist), `kpis`, `journeys`, `initials`.

## 3. Scaffold

For an existing repository the step 1 reply is that yes.

Run `node <path to the scaffold script> --answers <answers.json> --dir . --dry-run` (add `--no-first-track` for an existing repository), show what it would create and skip, and ask
for a yes; after the yes run it again without `--dry-run`. By hand, the same result: the files and templates are in [../setup/scaffold.md](../setup/scaffold.md) and
[../setup/templates.md](../setup/templates.md); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`, and when tracks are private the three lines above (a new project: decided the same way, declared when you show what you create).
- `git init` only when the folder is not a repository. No skill symlinks, `.claude/MEMORY.md`, deploy stub or database.

## 4. First tracks

New project: one "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. The scaffold script writes it.
Existing repository: none, because the project has its own history; offer to plan its first real track instead.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project

<!-- generated: recommended plugins -->

## 6. Summarize and close

Print what was created (counts and folders, the track numbers and titles) and what the person has to do themselves (listed,
never done by you). Then end with the first-track card ([next.md](next.md), "The first-track card": written once, shared with `next` and `setup`), with no "Next: run `/laneconductor:next`" line. For an existing repository it is led by the project's plan; for a new project the plan is the interview: item 1 is planning its walking skeleton (`/laneconductor:plan` with its number), then the key features the person named, in their words, from `conductor/product.md`. Then the line
"Say commit when you want the conductor files committed." and no other question: the track choice is the one question. On "commit", `git add` the created paths by name (never `git add -A`) and make one commit
`chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and
ask again.

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.
