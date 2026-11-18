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
- At the end of setup and new-project: a starter set of at most four (see below).
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

**The current track** is, in this order: the track the person named in the prompt (a number or a title); the track a branch is named after (`git branch --show-current`, for example `track-NNN` or a name holding a track number, matched to its folder under `conductor/tracks/`); the track this session has running (its `index.md` says `**Lane Status**: running`, and with the connector `**Run By**` names this client). When none of these gives one, no track is in play. With one in play, the work follows its lane, `**Type**`, stack and skill offers; with none, skill offers go by the project's stack only, and there is no KPI block to write (that belongs to a marketing or sales track).

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
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

At the end of setup and new-project, offer three or four from the catalog that fit the project's stack and Type, none already
installed: the core process skills, a design skill when the project has a UI, the stack's pack. Offer them once, with the commands in
their own bash blocks and a one-line reason each. The person installs them now or says later; on "later" nothing is recorded and each
one is offered again at its own moment (when a screen is planned, a deploy is asked for, and so on). The text is in `setup/setup.md`.

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

#### `laneconductor-parallel`

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. LaneConductor add-on, licence Elastic-2.0, from `meller/laneconductor`. Fits `implement`, `review` (lanes), Type `dev`, any stack. Level: `helps`. Mention it only when: the person mentions several sessions, people or sub-agents writing the same tracks, or worries about overwrites; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report.
It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

#### `laneconductor-board`

The board, one private page of every track by lane, which Claude publishes as an artifact. LaneConductor add-on, licence Elastic-2.0, from `meller/laneconductor`. Fits `setup` (lanes), Type `dev`, `marketing`, `sales`, `support`, any stack. Level: `helps`. Mention it only when: the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`).
It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

#### `frontend-design`

Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `plan`, `implement` (lanes), Type `dev`, only when the project has `ui`. Level: `prerequisite`.
Skills: `frontend-design`.
It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install frontend-design@claude-plugins-official
```

#### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills: `content-strategy`, `launch` (older installs list it as `launch-strategy`), `copywriting`, `social` (older installs list it as `social-content`), `sales-enablement`, `cold-email`, `prospecting`, `revops`, `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

#### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills: `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `finishing-a-development-branch`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

#### `pr-review-toolkit`

Review agents for a change: comments, tests, error handling, type design and simplification. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `review` (lanes), Type `dev`, any stack. Level: `helps`.
Skills: `review-pr`.
It counts as installed when the command `/pr-review-toolkit:review-pr` exists, or `claude plugin list` shows `pr-review-toolkit@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install pr-review-toolkit@claude-plugins-official
```

#### `security-guidance`

Security warnings on edits and a diff review when a turn ends, for injection, XSS, hardcoded secrets and other vulnerability classes. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `quality-gate` (lanes), Type `dev`, any stack. Level: `helps`.
It counts as installed when `claude plugin list` shows `security-guidance@claude-plugins-official`. It installs a Python hook script that runs before file edits and when a turn ends, to warn about security problems on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install security-guidance@claude-plugins-official
```

#### `playwright`

Drives a real browser to check a UI flow, click through it and take screenshots, for the quality gate of a UI track. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `quality-gate` (lanes), Type `dev`, only when the project has `ui`. Level: `helps`.
It counts as installed when its browser tools are among your tools (they start with `mcp__plugin_playwright_playwright__`), or `claude plugin list` shows `playwright@claude-plugins-official`. It installs an MCP server (the Playwright MCP Node.js program from Microsoft, fetched with npx) that drives a real browser on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install playwright@claude-plugins-official
```

#### `firebase`

Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `firebase`. Level: `helps`.
It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install firebase@claude-plugins-official
```

#### `cloudflare`

Cloudflare platform skills and its hosted MCP server for edge functions, Durable Objects and deployments. Third-party, licence Apache-2.0, from `cloudflare/skills`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `cloudflare`. Level: `helps`.
Skills: `cloudflare`.
It counts as installed when a skill named `cloudflare` is in the session's skills list, or `claude plugin list` shows `cloudflare@cloudflare`. It installs a connection to Cloudflare's hosted MCP server (no local program; you sign in to use it), plus Markdown skills on your computer, from `cloudflare/skills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add cloudflare/skills
```

```bash
claude plugin install cloudflare@cloudflare
```

#### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills: `ticket-triage`, `draft-response`, `kb-article`, `customer-escalation`, `customer-research`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

#### `data`

Data skills for a dashboard or chart: build a dashboard, create a visualization, explore and validate the data. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `dev`, only when the project has `dashboard`. Level: `helps`.
Skills: `build-dashboard`, `create-viz`, `data-visualization`.
It counts as installed when a skill from it (for example `build-dashboard`) is in the session's skills list, or `claude plugin list` shows `data@knowledge-work-plugins`. It installs connection settings for hosted data services (BigQuery, Amplitude, Hex and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install data@knowledge-work-plugins
```

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
