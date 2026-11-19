# implement lane: `/laneconductor implement N`

Execute the track's `plan.md`, phase by phase, communicating through files. A runner
normally has already started you in `.worktrees/NNN`; that is where the
commits go.

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
   - Look for the skills this Type works best with (marketing: `content-strategy`, `launch`, `copywriting`, `social`, `analytics`,
     `ab-testing`; sales: `sales-enablement`, `cold-email`, `prospecting`, `revops`; support: `ticket-triage`, `draft-response`,
     `kb-article`). A skill is installed when it is in the session's skills list, in `claude plugin list`, or in `.claude/skills/` or
     `~/.claude/skills/` (an older name counts: `social-content`, `launch-strategy`, `analytics-tracking`, `ab-test-setup`). For each one
     installed, say "you have `<skill>` installed, use it before writing the content". Offer the missing ones as "Offer a missing skill" says.
   - Read `## Draft` from `spec.md`; output the publish-ready content and the
     `### Publish Instructions` to the user. Nothing is posted, sent or spent for the owner: they do it.
   - Write `**Owner Action**` (one line, up to 200 characters: exactly what the owner must do) and
     `**Owner Action Due**` (`YYYY-MM-DD`) to `index.md`, taking the day from the plan; when the plan has
     none, ask the owner for one, never invent it. Then set `**Waiting for reply**: yes`. That marker is
     itself the Inbox signal, so no completion comment is needed.
   - Stop. Do not transition the lane yourself.
   - **The owner's reply** ("posted", "done", or a move): nothing moves the track by itself, so you do it.
     Clear `Owner Action`, `Owner Action Due` and `Waiting for reply`; set `**KPI Check After**` to now plus
     the KPI `Window` (a UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`); park the track in the quality-gate lane as
     `waiting`, with a `**Waiting Reason**` naming that date. With the connector, one `update_track` makes
     this change and checks for conflicts; lane and status names are the ones in `conductor/workflow.json`.
     With no KPI block there is no window: ask the owner where the track goes next.
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
   - Write the closing message of a lane and stop.
Boundaries: `workflow.json` is the only authority for target lanes; read it through `valid.next` or
`outcome`, or with the grammar in [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md), never by feel. On exit, `**Lane Status**`
should end as `success` or `queue` according to the outcome.

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one on the declined list (`skill-advisor-declined.txt` in the directory `git rev-parse --git-common-dir` prints).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": after a yes, add the entry name to the declined file.

Candidates for the `implement` lane (stack tags: ui, firebase, cloudflare, dashboard):

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official`
- `marketing-skills` (prerequisite; Type marketing/sales): skills copywriting, social (was social-content), sales-enablement, cold-email. Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `superpowers`: skills test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official`
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare`
- `customer-support` (Type support): skills ticket-triage, draft-response, kb-article, customer-escalation. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`
- `data` (stack dashboard): skills build-dashboard, create-viz, data-visualization. Installs connections to hosted data services, plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install data@knowledge-work-plugins`

## Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `test-driven-development` fits the test-first order `test.md` is written for; `systematic-debugging` helps when a test fails and the cause is not obvious; `subagent-driven-development` helps when the plan has independent tasks that can be handed to subagents; `using-git-worktrees` helps when you need an isolated checkout for the track.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"implement"` (`{ "skills": { "implement": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.
