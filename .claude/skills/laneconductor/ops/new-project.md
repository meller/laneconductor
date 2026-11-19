# new-project: `/laneconductor:new-project [name or idea]`

Start a project from a short conversation: a brainstorm, the scaffold, first tracks. Run it when the person names it, or says
`go` to the card of `next` that named it. Nothing is committed without their yes, and nothing is ever pushed.

The scaffold script named below, `lc-scaffold.mjs`, belongs to the optional laneconductor-parallel add-on. Find it with Glob
`**/laneconductor-parallel/**/server/bin/lc-scaffold.mjs` under `~/.claude/plugins/cache`, or in the LaneConductor repository under `connector/bin/`.
If it does not exist, do that step by hand exactly as described; the result is the same, only slower. Do not recommend the
add-on for this.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## 1. Detect the situation

- Empty or nearly empty folder (no code and no plan document; a README, licence or `.gitignore` alone does not count): a new project: `/laneconductor:new-project` is the command for it, not `setup`; the reply `go` to the card of `next` starts it. Ask for no name first: the first question is what it is for.
- An existing repository (a `.git`, or files other than `conductor/`): `/laneconductor:setup` is the command for it, which reads the project, writes the files and files its plan as tracks. Say so in one line and stop.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes), import nothing, offer only the missing `conductor/` context files and leave every track as it is;
  importing them is a separate yes ([../setup/scaffold.md](../setup/scaffold.md), "Older tracks"). `new` creates tracks.

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

Run `node <path to the scaffold script> --answers <answers.json> --dir . --dry-run`, show what it would create and skip, and ask
for a yes; after the yes run it again without `--dry-run`. By hand, the same result: the files and templates are in [../setup/scaffold.md](../setup/scaffold.md) and
[../setup/templates.md](../setup/templates.md); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`, and, when tracks are private (decided from facts and declared in the closing message, never asked: the project looks public, or has no remote to share with), `conductor/tracks/`, `conductor/tracks-summary.md` and `conductor/advice-log/`.
- `git init` only when the folder is not a repository. No skill symlinks, `.claude/MEMORY.md`, deploy stub or database.

## 4. First tracks

One "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. The scaffold script writes it.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project (a new project)

<!-- generated: recommended plugins -->

## 6. Summarize and close

End with ONE message, filled in from what you did and nothing else:

> **Habit tracker**: a small web app for daily habits (TypeScript, SQLite).
> Created `conductor/` (context files, `tracks/`), a git repository and the `.gitignore` lines. First track in the plan lane: 1 Walking skeleton.
> Tracks are private (git-ignored): there is no remote to share them with. Say 'commit my tracks' to share them.
> The conductor files are not committed; say commit when you want them committed.
> **See it on the board:** the board line of the first-track card ([next.md](next.md)).
> **Plan the first track:** `/laneconductor:plan 1` ("Walking skeleton").
> Board, or plan the first track?

Exactly two offers and one question, nothing after them (the starter set of step 5 comes before the message): no add-ons paragraph, no "Next: run `/laneconductor:next`". On "commit", `git add` the created paths by name (never `git add -A`) and make one commit `chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and ask again.

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.
