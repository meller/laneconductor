# new-project: `/laneconductor:new-project [name or idea]`

Start a project from a short conversation: interview, scaffold, first tracks. Run it only when the person asks for it by
name. Nothing is committed without their yes, and nothing is ever pushed. It needs no installer and no database.

The scaffold script named below, `lc-scaffold.mjs`, belongs to the optional laneconductor-parallel add-on. Find it with Glob
`**/laneconductor-parallel/**/server/bin/lc-scaffold.mjs` under `~/.claude/plugins/cache`, or in the LaneConductor repository under `connector/bin/`.
If it does not exist, do that step by hand exactly as described; the result is the same, only slower. Do not recommend the
add-on for this.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## 1. Detect the situation

- Empty or new folder: a new project. Ask for a name if the argument gave none.
- An existing repository (it has a `.git`, or files other than `conductor/`): say so and offer to add only the
  `conductor/` scaffold. `/laneconductor:setup` takes this path. Read what is there first (see "Existing repository" below) and
  use it as answers, so you ask less. Never overwrite an existing file; the scaffold skips what exists.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes) and import nothing. Offer to add only the missing `conductor/` context files and leave every track
  as it is; importing older tracks is a separate yes the person gives ([../setup/scaffold.md](../setup/scaffold.md), "Older
  tracks"). Point to `new` for creating tracks.

### Existing repository

Keep the interview short. Instead of the nine questions of step 2, read the project and ask only to confirm:

- The name, from `package.json`, `pyproject.toml` or the README title (else the folder name).
- What it is for, from the package description or the first README paragraph (else ask one question).
- The stack, from the dependencies and config files; hosting hints from `Dockerfile`, `vercel.json` and the like.
- The test, lint, typecheck, build and e2e commands from the scripts in `package.json`, the Makefile and the CI files. A
  command is proposed only if it really exists: the npm placeholder `echo "Error: no test specified"` is not a test command, and
  a lint config without a lint script is not a lint command. Say so when you leave one out.
- If the scaffold script is present, `node <path> --detect --dir .` does this reading and prints `answers` (what to
  confirm), `evidence` (where each fact came from) and `existing` (what an older LaneConductor left). Otherwise read the files
  yourself the same way.

Show the result as ONE message with everything filled in, so the person only has to approve it: the name, what it is for, the
stack, the test, lint, typecheck and build commands that really exist (one line for each one you left out, with the reason),
where each fact came from, and the tracks folder: `conductor/tracks/`, committed with the code (the default), or private, for a
public repository whose plans should not be public (the folder is then kept out of git with one `.gitignore` line; private tracks
are not shared with other machines or people). End with "Reply ok, or tell me what differs." Write nothing until that reply. Ask a
further question only about what could not be read (usually KPIs and constraints, and only if the person wants them now).
Do not add the walking-skeleton track to an existing project: pass `--no-first-track` to the scaffold script, or skip it by hand,
and suggest planning the first real track instead.

## 2. Interview

For an existing repository use the short version under "Existing repository" in step 1 instead of the questions below.

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
the scaffold script reads: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
testing, other), `constraints`, `commands` (typecheck, lint, test, build, coverage, audit, e2e: ONLY commands that
exist), `kpis`, `journeys`, `initials`.

## 3. Scaffold

Run `node <path to the scaffold script> --answers <answers.json> --dir . --dry-run` (add `--no-first-track` for an existing repository), show what it would create and skip, and ask
for a yes; after the yes run it again without `--dry-run`. By hand, the same result: the files and templates are in [../setup/scaffold.md](../setup/scaffold.md) and
[../setup/templates.md](../setup/templates.md); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. Do not create skill symlinks, `.claude/MEMORY.md` or a deploy
  stub, and do not touch a database.

## 4. First tracks

New project: one "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. The scaffold script writes it.
Existing repository: none, because the project has its own history; offer to plan its first real track instead.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once, so the person does not have to find them in
the README. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, how big the project is,
what the person told you and the Type of the tracks), pick only the entries below that fit and are not installed, and say for each, in one short paragraph, why it fits this project.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with: "Install them now, or I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer one:

- Show its install commands exactly as written below, each alone in its own bash block (one command per block, no leading `$`), then the reload step. You only show them:
  never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run).
- Say plainly what it installs, from the note under its name.
- Mention each plugin once in this session. If the person declines, do not bring it up again.
- Detect what is installed as `/laneconductor:suggest-skills` says (the skills list, `claude plugin list`); if you still cannot tell and the person says it is installed, take their word and say no more about it.

**`laneconductor-parallel`**: Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

**`laneconductor-board`**: The board, one private page of every track by lane, which Claude publishes as an artifact. It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

**`frontend-design`**: Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. It fits when the project has a front end (React, Vue, Vite, HTML pages) or tracks that plan screens. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace. It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`.

```bash
claude plugin install frontend-design@claude-plugins-official
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin install frontend-design@claude-plugins-official` instead (that opens the plugin's details for review).

**`marketing-skills`**: Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). It fits when the project's tracks are marketing or sales work (copy, launch, outreach), or it is a product that needs a website and a launch. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor. It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add coreyhaines31/marketingskills` and `/plugin install marketing-skills@marketingskills` instead (that opens the plugin's details for review).

**`superpowers`**: Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. It fits when the project writes code: it adds the brainstorm, plan, test-first, debugging and review skills the lanes use. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace. It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`.

```bash
claude plugin install superpowers@claude-plugins-official
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin install superpowers@claude-plugins-official` instead (that opens the plugin's details for review).

**`playwright`**: Drives a real browser to check a UI flow, click through it and take screenshots, for the quality gate of a UI track. It fits when the project has a web UI that a person checks in a browser. It installs an MCP server (the Playwright MCP Node.js program from Microsoft, fetched with npx) that drives a real browser on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace. It counts as installed when its browser tools are among your tools (they start with `mcp__plugin_playwright_playwright__`), or `claude plugin list` shows `playwright@claude-plugins-official`.

```bash
claude plugin install playwright@claude-plugins-official
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin install playwright@claude-plugins-official` instead (that opens the plugin's details for review).

**`firebase`**: Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. It fits when the project has `firebase.json` or `.firebaserc`, or Firebase in its tech stack. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace. It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`.

```bash
claude plugin install firebase@claude-plugins-official
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin install firebase@claude-plugins-official` instead (that opens the plugin's details for review).

**`cloudflare`**: Cloudflare platform skills and its hosted MCP server for edge functions, Durable Objects and deployments. It fits when the project has `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare in its tech stack. It installs a connection to Cloudflare's hosted MCP server (no local program; you sign in to use it), plus Markdown skills on your computer, from `cloudflare/skills`, a third-party source, not LaneConductor. It counts as installed when a skill named `cloudflare` is in the session's skills list, or `claude plugin list` shows `cloudflare@cloudflare`.

```bash
claude plugin marketplace add cloudflare/skills
```

```bash
claude plugin install cloudflare@cloudflare
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add cloudflare/skills` and `/plugin install cloudflare@cloudflare` instead (that opens the plugin's details for review).

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, after the offers above also say "Both add-ons in one line:" and show this one more block, alone in its own bash block, then the reload step. When only one of them is missing, keep its offer above and add nothing. The same rules hold: you only show it, never run an install command yourself, and install nothing unless the person says yes (and then still show the line for them to run). It is for use inside this session, where the base is already installed.

Both add-ons in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## 6. Summarize and ask before any commit

Print what was created (counts and folders, the track numbers and titles), what the person has to do themselves (listed,
never done by you), and the line "Next: run `/laneconductor:next`" (it names the one next step; do not name the step yourself). Ask: "Commit this
scaffold?". On yes, `git add` the created paths by name (never `git add -A`) and make one commit
`chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and
ask again.

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.
