# implement lane: `/laneconductor implement N`

Execute the track's `plan.md`, phase by phase, communicating through files. A runner
normally has already started you in `.worktrees/NNN`; that is where the
commits go.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: implement` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: a human may run this right after planning, and
   this project's `workflow.json` keeps `plan.on_success: plan:success`, so the track does not
   land in the implement lane by itself. Without it the board shows the track running in the
   wrong column.
1. **Locate the track.** With the parallel add-on, `get_track` finds it. Otherwise Glob
   `conductor/tracks/*-<N>-*/` and `conductor/tracks/<N>-*/` (both naming conventions). Never
   scaffold a second folder for an existing number.
2. **Workspace.** If you were not started inside `.worktrees/NNN` and the track is branch-mode,
   make the worktree yourself: `git worktree add .worktrees/NNN -b track-NNN` (or reuse it if it
   exists), and work there; with the parallel add-on, the `track-runner` sub-agent does this for
   you. If another session is already working in that worktree, stop and report instead of
   working in the primary checkout.
3. **Read context.** On `FRESH_SESSION: false` skip what you already read this session, except
   `conversation.md` (create it if missing) and `last_run.log`, which you always check for anything new.
   - `plan.md` (phases), `spec.md` (details and `**Type**`), `test.md` (drives the order of work).
   - `conductor/deployment-stack.md`, `product-guidelines.md`, `design-language.md`,
     `tech-stack.md`, each if present.
   - `conversation.md`: human comments override the plan.
   - `last_run.log` if present: why the previous run failed.
   - **test.md self-healing:** if `test.md` is missing, empty or still the
     `(Test cases to be added)` stub, write concrete test cases and commands for each phase
     before any implementation code. Template:
     ```markdown
     # Tests: Track NNN - [Title]

     ## Test Commands
     (exact commands)

     ## Test Cases
     ### Phase 1: [Name]
     - [ ] TC-1: [Description] - expected: [outcome]

     ## Acceptance Criteria
     - [ ] All unit tests pass
     - [ ] No regressions in related features
     ```
   - TDD is recommended because `test.md` is written for it: per phase, write the test, watch it
     fail, write the minimal code, watch it pass.
4. **Non-dev tracks (`**Type**` is not `dev`): supervised implement.** Do not write code.
   - Look for the skills this Type works best with (marketing: `content-strategy`, `launch`,
     `copywriting`, `social`, `analytics`, `ab-testing`; sales: `sales-enablement`, `cold-email`,
     `prospecting`, `revops`; support: `ticket-triage`, `draft-response`, `kb-article`). A skill
     counts as installed when it is in the skills list this session shows you (that covers project,
     user and plugin skills), when `claude plugin list` shows its plugin, or when it is in
     `.claude/skills/` or `~/.claude/skills/`; an older name counts too (`social-content`,
     `launch-strategy`, `analytics-tracking`, `ab-test-setup`). For each one that is installed say
     "you have `<skill>` installed, use it before writing the content" and use it. Offer only the
     ones that are missing, as "Offer a missing skill" below says (at most two, plain text, never
     blocking, and not again if the person declined them).
   - Read `## Draft` from `spec.md`; output the publish-ready content and the
     `### Publish Instructions` to the user.
   - Set `**Waiting for reply**: yes` in `index.md`. That marker is itself the Inbox signal, so no
     completion comment is needed. The human's "done" reply moves the track on to the quality
     gate.
   - Stop. Do not transition the lane yourself.
4b. **Fundamentals conflict (dev tracks).** If what you must build conflicts with, or implies a
   change to, `product-guidelines.md`, `design-language.md`, `tech-stack.md` or `workflow.md`,
   do not write code that contradicts them and do not rewrite them silently. Append to
   `conversation.md`: `> **system**: ⚠️ FUNDAMENTALS CONFLICT - this track's [requirement] appears to
   require changing conductor/[doc].md ([specific conflict]). Continuing as specified; doc not
   modified - please review whether conductor/[doc].md should be updated.` (one comment, prefix
   each continuation line with `> `). It is non-blocking unless proceeding would be actively wrong; then treat it like
   any blocker and stop for human input instead of guessing.
5. **Dev tracks: per phase.**
   - Implement the tasks.
   - **Run the verification before you tick anything.** Do not mark a task `[x]` or write
     "Phase N complete" until you have executed whatever verifies it and read the real output.
     This holds even when `test.md` has no case for the phase: if there is a CLI flag, endpoint,
     UI flow or dispatch to exercise, exercise it. A written-but-unrun test file or a plausible
     diff is not verification. One run shipped a "complete" phase with two new test
     files that were never run (one had an import error) and a hardcoded `null` that broke the
     one path that mattered.
   - **Never end a turn on a command you just backgrounded.** The harness kills background
     children when the session exits, so the work is silently lost and the run exits 0
     mid-work (the run's exit handler now reports `ended_mid_work`, which is recovery,
     not prevention). Run long commands in the foreground and wait, or hand off explicitly with a
     note in `conversation.md` naming what is still running and what the next turn should check.
   - Update `plan.md` (tick the task) and the `**Progress**` marker in `index.md`.
   - Commit: `feat(track-NNN): Phase X - description`.
6. **Complete (dev tracks).** Apply the same verification bar to the track as a whole before
   writing `## ✅ COMPLETE`.
   - Set `**Progress**` to 100%.
   - **Transition.** Re-read `index.md`'s `**Lane**` first. If it is no longer `implement` (a
     human moved the card), leave `**Lane**` and `**Lane Status**` alone and say so in the
     completion comment. Otherwise apply the workflow's success move for this lane (this project:
     `review:queue`; only the quality gate moves a track to done): with the connector, call
     `update_track` with `outcome: "success"` (the target is `valid.next.success` in `get_track`);
     without it, read `lanes.implement.on_success` in `conductor/workflow.json` with the grammar in
     [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md): set both `**Lane**` and
     `**Lane Status**` from it, a bare target is `queue`. If a deploy or post-deploy check is still
     to run, that is `quality-gate:running`, not `implement:running`.
   - Append `## ✅ COMPLETE` to `plan.md`.
   - Add the completion line to `history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <text>`; status, commit hashes and
     incidents of this run go there as dated lines, never into `plan.md` or `spec.md`):
     `✅ Implementation complete - moved to <lane>.`
   - Final commit: `feat(track-NNN): Implementation complete`.
Boundaries: `workflow.json` is the only authority for target lanes; read it through `valid.next` or
`outcome`, or with the grammar in [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md), never by feel. On exit, `**Lane Status**`
should end as `success` or `queue` according to the outcome.

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; `/laneconductor:suggest-skills` is the whole procedure. Usually this is silent: nothing missing means no message, and an offer never blocks the work.

The track is the one this command names, so its lane, `**Type**` and stack are known. At the start of this lane, and again when the track's situation changes (a failing test, a review comment to answer, a UI, a deploy), look at what fits and offer what is missing. Usually this is silent. The full command is `/laneconductor:suggest-skills`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for the `implement` lane:

#### `laneconductor-parallel`

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. LaneConductor add-on, licence Elastic-2.0, from `meller/laneconductor`. Fits `implement`, `review` (lanes), Type `dev`, any stack. Level: `helps`. Mention it only when: the person mentions several sessions, people or sub-agents writing the same tracks, or worries about overwrites; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report.
It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

#### `frontend-design`

Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `plan`, `implement` (lanes), Type `dev`, only when the project has `ui`. Level: `prerequisite`.
Skills for this part: `frontend-design`.
It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install frontend-design@claude-plugins-official
```

#### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `copywriting`, `social` (older installs list it as `social-content`), `sales-enablement`, `cold-email`.
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

#### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `test-driven-development`, `systematic-debugging`, `subagent-driven-development`, `using-git-worktrees`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

#### `firebase`

Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `firebase`. Level: `helps`.
It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install firebase@claude-plugins-official
```

#### `cloudflare`

Cloudflare platform skills and its hosted MCP server for edge functions, Durable Objects and deployments. Third-party, licence Apache-2.0, from `cloudflare/skills`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `cloudflare`. Level: `helps`.
Skills for this part: `cloudflare`.
It counts as installed when a skill named `cloudflare` is in the session's skills list, or `claude plugin list` shows `cloudflare@cloudflare`. It installs a connection to Cloudflare's hosted MCP server (no local program; you sign in to use it), plus Markdown skills on your computer, from `cloudflare/skills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add cloudflare/skills
```

```bash
claude plugin install cloudflare@cloudflare
```

#### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills for this part: `ticket-triage`, `draft-response`, `kb-article`, `customer-escalation`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

#### `data`

Data skills for a dashboard or chart: build a dashboard, create a visualization, explore and validate the data. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `dev`, only when the project has `dashboard`. Level: `helps`.
Skills for this part: `build-dashboard`, `create-viz`, `data-visualization`.
It counts as installed when a skill from it (for example `build-dashboard`) is in the session's skills list, or `claude plugin list` shows `data@knowledge-work-plugins`. It installs connection settings for hosted data services (BigQuery, Amplitude, Hex and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install data@knowledge-work-plugins
```

Stack tags used above:

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.
- `firebase`: `firebase.json` or `.firebaserc`, or Firebase named in conductor/tech-stack.md.
- `cloudflare`: `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare named in conductor/tech-stack.md.
- `dashboard`: the track or its plan is about a dashboard, charts or a data page.

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `test-driven-development` fits the test-first order `test.md` is written for; `systematic-debugging` helps when a test fails and the cause is not obvious; `subagent-driven-development` helps when the plan has independent tasks that can be handed to subagents; `using-git-worktrees` helps when you need an isolated checkout for the track.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"implement"`, such as
`{ "skills": { "implement": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
