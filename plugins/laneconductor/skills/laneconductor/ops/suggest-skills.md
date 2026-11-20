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
  nothing (no declined entry). Use it to see what would be offered.
- a lane name (`plan`, `implement`, `review`, `quality-gate`, `merge`, `deploy`): what fits that lane.

## How it works

1. **Detect what is installed.** See rule 1 below. One look, not a hunt.
2. **Read the stack.** Read `conductor/tech-stack.md` (when it exists) and look for the marker files named under "Stack tags"
   (`firebase.json`, a Vite config, `wrangler.toml` and the like). Read the track's `index.md` for its `**Type**` (`dev` when it has
   none) and its lane, and for a UI track also the plan (screens or pages).
3. **Compare with the catalog** for the lane, the Type and the stack: keep the entries that fit and whose skills are not all
   installed. Read the declined list first (`skills.declined` in `.laneconductor.json` and the
   older `.git/skill-advisor-declined.txt`, each with the Read tool, if present): leave out those entries and any you already offered in this session.
4. **Offer at most two**, with the reason and the source, as the rules say. When nothing is missing, say nothing (for the command
   itself: say in one line that nothing is missing).

### The current track

**The current track** is, in this order: the track named in the prompt (a number or a title); the track a branch is named after (`git branch --show-current`, matched to its folder under `conductor/tracks/`); the track this session has running (`**Lane Status**: running`, and with the connector `**Run By**` names this client). With one in play, its lane, `**Type**` and stack apply; with none, no track is in play and skill offers go by the stack only (a KPI block belongs to a marketing or sales track, so there is none to write).

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, only when the list is not enough, as a command of its own and never chained with other commands, which makes the client ask for permission) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry named in `skills.declined` of `.laneconductor.json` (the older `.git/skill-advisor-declined.txt`, one name per line, is read too). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the exact change (`.laneconductor.json` and the new `skills.declined` list) and write it only after the yes: create the file with only that key if it is missing, keep every other key and valid JSON; first see that `.gitignore` lists `.laneconductor.json`, adding the line only after asking, as the board procedure does. On a failed write, skip it this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

## After the person says yes

Show the commands (they may already be on screen), say plainly that nothing has been installed yet, and tell the person to run them
and then `/reload-plugins`. When they come back, check that it loaded (the skill is in the skills list, or `claude plugin list`
shows the plugin) and say so; if it did not load, say that and show the output of the failed command if they paste it, never
retry on your own. Then start the step again from the top, now with the skill present.

An install is shown with the default scope. To keep a plugin to this repository only, the person adds `--scope local` to the
install command; for everyone who works in the repository, `--scope project` (then each person runs the install once per clone).
`claude plugin details <name>` shows what an installed plugin adds to every session, after it is installed.

Where the client has its own plugin browser or install card, you may point at it instead of the commands for
a plugin in the catalog: the person clicks, and nothing is installed without that click.

## The starter set

At the end of new-project, offer three or four from the catalog that fit the project's stack and Type, none already
installed: the core process skills, a design skill when the project has a UI, the stack's pack. Offer them once, with the commands in
their own bash blocks and a one-line reason each. The person installs them now or says later; on "later" nothing is recorded and each
one is offered again at its own moment. The text is in `ops/new-project.md`.

## The add-ons are entries like any other

`laneconductor-parallel` and `laneconductor-board` are in the catalog with the same fields and the same offer pattern as the
rest: when the person asks for parallel work, worktrees or a board, offer the add-on the way any entry is offered.

## The catalog

Entries are public sources only; each was checked to exist and to hold the skills it names on the date shown. A skill listed under an
older name still counts as installed. A catalog goes stale, so when an install fails because a source has moved, say so and show the
fallback below rather than guessing another source.

### Stack tags

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.
- `dashboard`: the track or its plan is about a dashboard, charts or a data page.
- `firebase`: `firebase.json` or `.firebaserc`, or Firebase named in conductor/tech-stack.md.
- `cloudflare`: `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare named in conductor/tech-stack.md.
- `postgres`: a Postgres database: `pg`, `postgres`, `prisma` or `@prisma/client` in package.json, a `docker-compose` file with a postgres image, or Postgres named in conductor/tech-stack.md.
- `gemini`: Gemini or Vertex AI: `@google/genai`, `@google/generative-ai` or `@google-cloud/vertexai` in package.json, or Gemini or Vertex AI named in conductor/tech-stack.md.

### The entries (checked 2026-11-20)

One line each: the entry, when it applies, its licence, what it installs and the commands (show each command alone in its own bash block when you offer it).

- `laneconductor-parallel` (Elastic-2.0): parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `laneconductor-board` (Type dev/marketing/sales/support; Elastic-2.0): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It counts as installed when Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor`
- `laneconductor-nodejs-frontend` (stack ui; Elastic-2.0): Node.js front-end skills: an installable Vite PWA with Workbox, and browser speech that is actually audible. Skills: pwa-vite-workbox, browser-tts-unlock-voice-binding. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-nodejs-frontend@laneconductor`
- `laneconductor-firebase` (stack firebase; Elastic-2.0): Firebase skills: a Hosting site and Functions codebase per product in one shared GCP project, cache busting after deploys, Google-only sign-in. Skills: shared-gcp-firebase-site, cache-buster, firebase-google-sign-in. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-firebase@laneconductor`
- `laneconductor-node-postgres` (stack postgres; Elastic-2.0): Postgres skills for Node.js: local Postgres, Neon in production with the connection string in Secret Manager, Prisma in Cloud Functions, an isolated test database. Skills: postgres-local-neon-prod-secret-manager, prisma-in-cloud-functions, isolated-test-database, makefile-local-run. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-node-postgres@laneconductor`
- `laneconductor-gemini` (stack gemini; Elastic-2.0): Gemini skills for Node.js: every LLM call through TokenTalos, Gemini on Vertex AI with Application Default Credentials, image generation with retry. Skills: llm-through-tokentalos, vertex-gemini-adc, vertex-imagen-retry-gcs-fallback. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-gemini@laneconductor`
- `laneconductor-skill-from-code` (Elastic-2.0): authoring skills: turn a pattern or a verified incident, shown by working code, into a new skill, and package your skills as Claude plugins. Skills: plugin-from-skills, skill-from-code. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-skill-from-code@laneconductor`
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

Say so in one line. If the problem is then solved by working code, you may offer once, in one line, the `laneconductor-skill-from-code` pack from the catalog above to turn it into a skill (its commands in their own blocks, as everywhere). Then you may name one generic finder, `find-skills` (`vercel-labs/skills`, licence MIT): third-party and not vetted by LaneConductor: it runs the `skills` command-line program from npm with npx, searches an outside directory (skills.sh) for community skills, and its own text says it may install them with the prompts skipped (-y); never install what it finds without reading it. Show its command alone in its own bash block, never run it, and say it is third-party:

```bash
npx skills add vercel-labs/skills --skill find-skills -a claude-code
```

## Rules

- A second opinion, never an order: every offer says why, and the work goes on whatever the answer.
- Never run an install command. Show it; the person runs it.
- Nothing private in an offer: only the catalog's public sources.
