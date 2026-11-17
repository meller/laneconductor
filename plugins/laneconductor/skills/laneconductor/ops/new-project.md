# new-project: `/laneconductor:new-project [name or idea]`

Start a project from a short conversation: interview, recommend recipes, scaffold, first tracks. Run it only when the
person asks for it by name. Nothing is committed without their yes, and nothing is ever pushed. It works with no recipe
at all (step 3 says so) and needs no daemon and no database.

Scripts named below live in the plugin under `server/bin/` (find them with Glob `**/laneconductor/**/server/bin/<name>`
under `~/.claude/plugins`; `${CLAUDE_PLUGIN_ROOT}` may not be substituted in command text) or in the LaneConductor
repository under `connector/bin/`. If a script does not exist (the Markdown-only variant has none), do that step by hand
exactly as described; the result is the same, only slower.

## 1. Detect the situation

- Empty or new folder: a new project. Ask for a name if the argument gave none.
- An existing repository (it has a `.git`, or files other than `conductor/`): say so and offer to add only the
  `conductor/` scaffold. Read what is there first (`README`, `package.json` or equivalent, CI config) and use it as
  answers, so you ask less. Never overwrite an existing file; the scaffold skips what exists.
- `conductor/` already holds tracks: stop and say so. New-project is for a project that has none; point to `new`.

## 2. Interview

Follow the style of [../lanes/brainstorm.md](../lanes/brainstorm.md): ONE question per message, adaptive, short, in chat
(not through `conversation.md`; there is no track yet). Offer a likely default with each question so a one-word answer
is enough. Cover, in this order, and skip what the person already told you or the repository shows:

1. What is it for, and who uses it
2. The three key features
3. Language and stack
4. Data (what is stored, how much)
5. Authentication
6. Hosting and the deploy target
7. AI use (none is a fine answer)
8. Testing (which commands really exist, or will exist in the walking skeleton)
9. Constraints (budget, deadline, compliance, things to avoid)

Stop early when the answers are enough to scaffold; say "That is enough to start" and move on. Ask for 2 to 4 letter
initials for track ids last, only if the folder has none to reuse. Record the answers as you go, as the JSON that
`lc-scaffold` reads: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
testing, other), `constraints`, `commands` (typecheck, lint, test, build, coverage, audit, e2e: ONLY commands that
exist), `kpis`, `journeys`, `initials`, then in step 3 `recipes` and `deviations`.

## 3. Recommend recipes (recommend, never order)

Follow [recipes.md](recipes.md) ("Find and rank"): it reads the shipped library and the person's own library and ranks
them against the stack tags you derived from the answers. Show at most five. For each: its name, one line on why it fits,
its `verified` date, and any freshness warning (a cited reference changed since it was verified). Then ask which to use,
if any. The person picks; a recipe they decline, or a different way of doing what it covers, is a deviation: write the
reason in their own words into `deviations`. Nothing is applied silently and nothing is applied in this step.

If no recipe library exists, or none matches, say exactly that ("No recipes were available for this stack; continuing
without") and go on. That is a normal outcome, not a failure.

## 4. Scaffold

Run `node <path>/lc-scaffold.mjs --answers <answers.json> --dir . --dry-run`, show what it would create and skip, and ask
for a yes; after the yes run it again without `--dry-run`. By hand, the same result: the files and templates are in [../setup/scaffold.md](../setup/scaffold.md) and
[../setup/templates.md](../setup/templates.md); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md`, `tracks/`, and `.laneconductor.json` with a
  state branch only (no `mode`, no database, no sync-service or worker settings).
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. Do not create the skill symlinks, `.claude/MEMORY.md`, a deploy
  stub or anything for the sync worker. Do not start a daemon or touch a database.

## 5. First tracks

One plan-lane track per recipe the person chose ("Apply recipe X", with the recipe's "You run" steps as the human's tasks,
marked `(HUMAN)`), then one "Walking skeleton" track: the thinnest end-to-end slice of the product. `lc-scaffold` writes
them. When the connector is present and the project already has its `conductor/` files, create further tracks with
`create_track`; otherwise write the files as `ops/tracks.md` describes. Put each deviation from step 3 into the
conversation of the first track (`> **human**: ...`, see "conversation.md format" in SKILL.md).

Applying a recipe is NOT part of this command: the recipe track is where it happens, through
[apply-recipe.md](apply-recipe.md), when the person starts it.

## 6. Summarize and ask before any commit

Print what was created (counts and folders, the track numbers and titles), what the person has to do themselves (the
"You run" steps, listed, never done by you), and the next step in one line (plan the first track). Ask: "Commit this
scaffold?". On yes, `git add` the created paths by name (never `git add -A`) and make one commit
`chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and
ask again.

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.
- Recommendations come with reasons and dates; the person decides, and the decision is recorded.
