# suggest-skills: recommend the right skill at the right moment

`suggest-skills` is the second opinion about skills. A skill is a set of instructions Claude loads when the work calls for it, and Claude
only sees the skills that are installed, so it cannot tell you about one that is missing. LaneConductor knows the lanes, so it
can: it names a skill that fits this lane, this kind of track and this stack, says why and where it comes from, and shows how to
install it. It is not an installer and not a registry: the catalog below is small, dated and checked, and the commands are the
platform's own. Nothing is installed without the person's yes, and this plugin never runs an install itself; it shows the
commands and the person runs them.

## When to use it

- The person types `/laneconductor:suggest-skills`, or asks "which skills would help here", "is there a skill for this", "what should I
  install".
- At the start of a lane (plan, brainstorm, implement, review, quality gate, merge) and before a deploy: each lane guide carries
  the entries that fit it ("Offer a missing skill").
- When the situation matches: a failing test or a bug track (a debugging skill), a review comment to answer, a plan that is
  stuck, a UI, a track that needs an isolated checkout, a request to deploy.
- When a track whose `**Type**` is `marketing`, `sales` or `support` is created, planned or implemented.
- At the end of new-project: a starter set of at most four (see below).
- In `next`: one line, as a tip.

The arguments (all optional):

- nothing: what fits the work in front of you now (the lane and Type of the track in focus, or the project's stack when there is
  none), only what is missing.
- `all`: the whole catalog, grouped by lane, with what is installed marked.
- `dry-run`: the same as nothing, but a rehearsal: print the offer with its commands and change nothing, ask nothing and write
  nothing (no declined list entry, no settings). Use it to see what would be offered.
- a lane name (`plan`, `implement`, `review`, `quality-gate`, `merge`, `deploy`): what fits that lane.

## How it works

1. **Detect what is installed.** See rule 1 below. One look, not a hunt.
2. **Read the stack.** Read `conductor/tech-stack.md` (when it exists) and look for the marker files named under "Stack tags"
   (`firebase.json`, a Vite config, `wrangler.toml` and the like). Read the track's `index.md` for its `**Type**` (`dev` when it has
   none) and its lane, and for a UI track also the plan (screens or pages).
3. **Compare with the catalog** for the lane, the Type and the stack: keep the entries that fit and whose skills are not all
   installed. Leave out any entry the person declined for this project and any you already offered in this session.
4. **Offer at most two**, with the reason and the source, as the rules say. When nothing is missing, say nothing (for the command
   itself: say in one line that nothing is missing).

### The current track

**The current track** is, in this order: the track named in the prompt (a number or a title); the track a branch is named after (`git branch --show-current`, matched to its folder under `conductor/tracks/`); the track this session has running (`**Lane Status**: running`, and with the connector `**Run By**` names this client). With one in play, its lane, `**Type**` and stack apply; with none, no track is in play and skill offers go by the stack only (a KPI block belongs to a marketing or sales track, so there is none to write).

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, only when the list is not enough, as a command of its own and never chained with other commands, which makes the client ask for permission) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

## After the person says yes

Show the commands (they may already be on screen), say plainly that nothing has been installed yet, and tell the person to run them
and then `/reload-plugins`. When they come back, check that it loaded (the skill is in the skills list, or `claude plugin list`
shows the plugin) and say so; if it did not load, say that and show the output of the failed command if they paste it, never
retry on your own. Then start the step again from the top, now with the skill present.

An install is shown with the default scope. To keep a plugin to this repository only, the person adds `--scope local` to the
install command; for everyone who works in the repository, `--scope project` (then each person runs the install once per clone).
`claude plugin details <name>` shows what an installed plugin adds to every session, after it is installed.

Where the client has its own plugin browser or install card (the desktop app does), you may point at it instead of the commands for
a plugin in the catalog: the person clicks, and nothing is installed without that click.

## The starter set

At the end of new-project, offer three or four from the catalog that fit the project's stack and Type, none already
installed: the core process skills, a design skill when the project has a UI, the stack's pack. Offer them once, with the commands in
their own bash blocks and a one-line reason each. The person installs them now or says later; on "later" nothing is recorded and each
one is offered again at its own moment (when a screen is planned, a deploy is asked for, and so on). The text is in `ops/new-project.md`.

## The add-ons are entries like any other

`laneconductor-parallel` and `laneconductor-board` are in the catalog with the same fields and the same offer pattern as the
rest: when the person asks for parallel work, worktrees or a board, offer the add-on the way any entry is offered. There is no special
wording or special case for them.

## The catalog

Entries are public sources only; each was checked to exist and to hold the skills it names on the date shown. A skill listed under an
older name still counts as installed. A catalog goes stale, so when an install fails because a source has moved, say so and show the
fallback below rather than guessing another source.

### Stack tags

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.
- `dashboard`: the track or its plan is about a dashboard, charts or a data page.
- `firebase`: `firebase.json` or `.firebaserc`, or Firebase named in conductor/tech-stack.md.
- `cloudflare`: `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare named in conductor/tech-stack.md.

### The entries (checked 2026-11-18)

One line each: the entry, when it applies, its licence, what it installs and the commands (show each command alone in its own bash block when you offer it).

- `laneconductor-parallel` (Elastic-2.0): parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `laneconductor-board` (Type dev/marketing/sales/support; Elastic-2.0): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor`
- `frontend-design` (prerequisite; stack ui; Apache-2.0): design direction for UI: typography, layout, no templated defaults. Skills: frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official`
- `marketing-skills` (prerequisite; Type marketing/sales; MIT): marketing and sales skills: strategy, launch, copy, social, cold email, analytics. Skills: content-strategy, launch (was launch-strategy), copywriting, social (was social-content), sales-enablement, cold-email, prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `superpowers` (MIT): process skills: plans, test-first, debugging, sub-agents, worktrees, review, verification. Skills: brainstorming, writing-plans, test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees, requesting-code-review, receiving-code-review, verification-before-completion, finishing-a-development-branch. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `pr-review-toolkit` (Apache-2.0): review agents: comments, tests, error handling, types, simplification. Skills: review-pr. Markdown only. `claude plugin install pr-review-toolkit@claude-plugins-official`
- `security-guidance` (Apache-2.0): security warnings on edits and a diff review when a turn ends. Installs a Python hook script that checks edits. It counts as installed when `claude plugin list` shows `security-guidance`. `claude plugin install security-guidance@claude-plugins-official`
- `playwright` (stack ui; Apache-2.0): drives a real browser to check a UI flow and take screenshots. Installs an MCP server (Node.js, via npx) that drives a browser. It counts as installed when its tools start with `mcp__plugin_playwright_playwright__`, or `claude plugin list` shows it. `claude plugin install playwright@claude-plugins-official`
- `firebase` (stack firebase; Apache-2.0): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. It counts as installed when its tools start with `mcp__plugin_firebase_firebase__`, or `claude plugin list` shows it. `claude plugin install firebase@claude-plugins-official`
- `cloudflare` (stack cloudflare; Apache-2.0): Cloudflare skills and hosted MCP server for edge functions and deploys. Skills: cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare`
- `customer-support` (Type support; Apache-2.0): support skills: ticket triage, draft replies, knowledge-base articles, escalations. Skills: ticket-triage, draft-response, kb-article, customer-escalation, customer-research. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`
- `data` (stack dashboard; Apache-2.0): data skills: dashboards, charts, exploring and validating data. Skills: build-dashboard, create-viz, data-visualization. Installs connections to hosted data services, plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install data@knowledge-work-plugins`

### If nothing in the catalog fits

Say so in one line. Then you may name one generic finder, `find-skills` (`vercel-labs/skills`, licence MIT): third-party and not vetted by LaneConductor: it runs the `skills` command-line program from npm with npx, searches an outside directory (skills.sh) for community skills, and its own text says it may install them with the prompts skipped (-y); never install what it finds without reading it. Show its command alone in its own bash block, never run it, and say it is third-party:

```bash
npx skills add vercel-labs/skills --skill find-skills -a claude-code
```

## Rules

- A second opinion, never an order: every offer says why, and the work goes on whatever the answer.
- Never run an install command. Show it; the person runs it.
- Never edit settings or permissions to make an install work, and never retry a failed install silently.
- Nothing private in an offer: only the catalog's public sources.
