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

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview. Use it when the person already
knows what they want, or another tool has already scanned the project.
