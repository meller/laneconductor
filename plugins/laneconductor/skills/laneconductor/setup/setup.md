# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. It needs
no installer and no database: the result is a `conductor/` folder, plain files
in git. Nothing is committed without a yes, and nothing is ever pushed.

Before you write anything, tell the person what you are about to create or change, and wait for a yes.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow [../ops/new-project.md](../ops/new-project.md), its existing-repository path (the folder has a `.git`, or files other than
`conductor/`), and when the folder is empty its new-project path. In short:

1. **Read the project first.** Infer the name, the stack, the test and lint commands and the CI setup from `package.json` (or the
   equivalent), the README, the CI files and the lint config. Show it all in ONE message, already filled in (name, stack, the
   test and lint commands, where each fact came from, and the tracks folder with its "private" option for a public repository, as
   [../ops/new-project.md](../ops/new-project.md) says), end with "Reply ok, or tell me what differs", and write nothing until that
   reply. Do not ask what the files already answer.
2. **Say what is already there.** If `conductor/` or `conductor/tracks` already exists (an older LaneConductor), say what you
   found: how many tracks, in which naming form, which lanes. Import nothing silently and change none of them.
3. **Show the plan, then write.** List the files the scaffold would create and the ones it would skip because they exist.
   After a yes, create only the missing ones. An existing README, `package.json` or any other file of the project is never
   touched, and `.gitignore` only gets the three lines it lacks.
4. **Notice a stale project-level skill.** If `.claude/skills/laneconductor` exists in the project (Glob; `test -L` for a link,
   `git ls-files` to see whether git tracks it; read only), say in one sentence that the plugin supplies the skill itself, so this
   copy or link is stale, and offer its removal: show `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a
   folder; `git rm` for one that git tracks, and removing it then needs a commit, which you ask about first). Never run it and
   touch nothing else.
5. **Say what else fits.** After the project is read, say which optional plugins would help this project, as a starter set of three or four at most (see "What else fits this
   project" below), then wait for the person's answer. When the board add-on is installed, also say once: `/laneconductor:board` opens the whole project as a board, and its What's next button shows the same step as `/laneconductor:next`.
6. **Summarize and ask before any commit** (a single commit of the files you created, by name, never `git add -A`). End with the
   line "Next: run `/laneconductor:next`"; do not name the next step yourself, and do not repeat the add-on offer.

## What else fits this project

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

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview. Use it when the person already
knows what they want, or another tool has already scanned the project.
