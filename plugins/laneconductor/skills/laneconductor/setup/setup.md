# setup: add LaneConductor to this project

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. The result is a
`conductor/` folder of plain files in git. Nothing is committed without a yes, and nothing is ever pushed.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow [../ops/new-project.md](../ops/new-project.md), its existing-repository path (the folder has a `.git`, or files other than
`conductor/`), and when the folder is empty its new-project path. In short:

1. **Read the project, confirm it in ONE message.** The name, the stack, the commands that exist, what will be created and the one
   decision (tracks committed or private), as "Existing repository" in [../ops/new-project.md](../ops/new-project.md) says: about
   twelve lines, ending "Reply ok, or tell me what differs". Write nothing until that reply. Say nothing about what does not
   exist or does not apply, and do not ask what the files already answer.
2. **An existing `conductor/`** (an older LaneConductor) is one more line in the message: how many tracks, in which naming form,
   which lanes. Import nothing and change none of them.
3. **Write after the reply.** The reply is the yes: create only the missing files. An existing README, `package.json` or any
   other file of the project is never touched, and `.gitignore` only gets the lines it lacks.
4. **A stale project-level skill** is one more line in the message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L` for a link, `git ls-files` for git): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
5. **Say what else fits**, in the closing summary, not in the message above: say which optional plugins would help this project, as a starter set of three or four at most (see "What else fits this
   project" below), say nothing when none fits. Do not wait for an answer: step 6 follows in the same message.
6. **Close with the first track.** Say in about three lines what you created (counts and folders) and what the person must do
   themselves, if anything. End with the first-track card ([next.md](../ops/next.md), "The first-track card": written once, shared with
   `next`; it holds the board line), then the line "Say commit when you want the conductor files committed." The track choice is
   the one question: no "Next: run `/laneconductor:next`" line and no second question. On "commit": `git add` the files you
   created, by name (never `git add -A`), make one commit and never push.

## What else fits this project

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say in a sentence why each fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with: "Install them now, or I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes. Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and `claude plugin list`; if you cannot tell, take the person's word.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor` It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor` It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.
- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official` It fits when the project has a front end (React, Vue, Vite, HTML pages) or tracks that plan screens.
- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), copywriting, social (was social-content), sales-enablement, cold-email, prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills` It fits when the project's tracks are marketing or sales work (copy, launch, outreach), or it is a product that needs a website and a launch.
- `superpowers`: skills brainstorming, writing-plans, test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees, requesting-code-review, receiving-code-review, verification-before-completion, finishing-a-development-branch. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official` It fits when the project writes code: it adds the brainstorm, plan, test-first, debugging and review skills the lanes use.
- `playwright` (stack ui): drives a real browser to check a UI flow and take screenshots. Installs an MCP server (Node.js, via npx) that drives a browser. `claude plugin install playwright@claude-plugins-official` It fits when the project has a web UI that a person checks in a browser.
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official` It fits when the project has `firebase.json` or `.firebaserc`, or Firebase in its tech stack.
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare` It fits when the project has `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare in its tech stack.

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing.

Both add-ons in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow
[scaffold.md](scaffold.md) (templates in [templates.md](templates.md)) and skip the interview.
