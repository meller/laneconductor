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
- An existing repository (a `.git`, or files other than `conductor/`): offer only the `conductor/` scaffold (`/laneconductor:setup`
  takes this path). Read what is there first ("Existing repository" below) and ask less. Never overwrite an existing file; the
  scaffold skips what exists.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes) and import nothing. Offer only the missing `conductor/` context files and leave every track as it is;
  importing older tracks is a separate yes ([../setup/scaffold.md](../setup/scaffold.md), "Older tracks"). `new` creates tracks.

### Existing repository

Keep the interview short. Instead of the nine questions of step 2, read the project and ask only to confirm:

- The name and purpose (`package.json`, `pyproject.toml`, the README; else the folder name), the stack (dependencies and config
  files) and the commands that really exist (scripts in `package.json`, the Makefile, the CI files). The npm placeholder
  `echo "Error: no test specified"` is not a test command, and a lint config without a lint script is not a lint command.
- If the scaffold script is present, `node <path> --detect --dir .` does this reading and prints `answers` (what to
  confirm), `evidence` (where each fact came from) and `existing` (what an older LaneConductor left). Otherwise read the files
  yourself the same way.

Show the result as ONE message in this form, at most twelve lines, everything filled in (for a public-looking repository):

> **my-app**: a command-line tool that sorts notes.
> Stack: Node.js, no dependencies.
> Commands: `npm start`, `npm test`.
> I will create `conductor/` (context files, an empty `tracks/`) and three `.gitignore` lines.
> Tracks: committed with the code, or private (out of git, not shared)? I recommend private: the README says this is a public demo.
> Reply ok, or tell me what differs.

One line each; only the commands that exist. Recommend private for a repository that looks public (a README that says public demo, no licence yet), committed otherwise. Add a line only for something unusual or that needs a decision (an existing `conductor/` folder, a stale project-level skill, a conflict). Say nothing about what does not exist or does not apply: no list of commands left out, no "nothing to clean up", no "no optional plugins", no "I will not touch your README", no repository facts (a count you do state comes from a command run for that purpose, `git rev-list --count HEAD`, never from a truncated listing). Write nothing until that reply; it is the yes.
Do not add the walking-skeleton track to an existing project: pass `--no-first-track` to the scaffold script, or skip it by hand,
and suggest planning the first real track instead.

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
the scaffold script reads: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
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
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. Do not create skill symlinks, `.claude/MEMORY.md` or a deploy
  stub, and do not touch a database.

## 4. First tracks

New project: one "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. The scaffold script writes it.
Existing repository: none, because the project has its own history; offer to plan its first real track instead.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say for each, in one short paragraph, why it fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with: "Install them now, or I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run). Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and `claude plugin list`; if you still cannot tell and the person says it is installed, take their word.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor` It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor` It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.
- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official` It fits when the project has a front end (React, Vue, Vite, HTML pages) or tracks that plan screens.
- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), copywriting, social (was social-content), sales-enablement, cold-email, prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills` It fits when the project's tracks are marketing or sales work (copy, launch, outreach), or it is a product that needs a website and a launch.
- `superpowers`: skills brainstorming, writing-plans, test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees, requesting-code-review, receiving-code-review, verification-before-completion, finishing-a-development-branch. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official` It fits when the project writes code: it adds the brainstorm, plan, test-first, debugging and review skills the lanes use.
- `playwright` (stack ui): drives a real browser to check a UI flow and take screenshots. Installs an MCP server (Node.js, via npx) that drives a browser. `claude plugin install playwright@claude-plugins-official` It fits when the project has a web UI that a person checks in a browser.
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official` It fits when the project has `firebase.json` or `.firebaserc`, or Firebase in its tech stack.
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare` It fits when the project has `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare in its tech stack.

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing. You only show it, never run an install command yourself, and install nothing unless the person says yes. It is for use inside this session, where the base is already installed.

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
