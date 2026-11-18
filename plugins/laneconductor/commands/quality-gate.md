---
description: Run the quality gate on a track (evaluates, never fixes)
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the quality-gate lane. The procedure is the quality-gate lane guide (skill file `lanes/quality-gate.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file. The guide is advice.
2. Work through the guide. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/quality-gate.md`

Run the checks, post the result, and route the track. Passing here queues the track for merge
(`done:queue`); it does not mean shipped, because the merge action sets `done:success` once the
code is on `main`.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: quality-gate` and `**Lane Status**: running` to
   the track's `index.md`. Set `**Lane**` explicitly: when run directly the track may not sit in
   this lane, and the board would show it running in the wrong column. In the same edit, clear
   any existing `**Verdict**` marker, so a run cut short (including the KPI-miss early exit in
   step 1) never leaves a stale value for a later run's exit handler to misread.
0b. **KPI window.** If `**KPI Check After**` in `index.md` is in the future, ask
   "KPI window not reached, Xh remaining. Measuring now may be unreliable. Run anyway? (y/n)" and
   stop on "n". When an automatic run launched you it already checked the time; skip this.
1. **KPI measurement (before any code check).** Read `**Type**`. If it is non-dev (`marketing`,
   `sales`, `support`, `other`) or `spec.md` has a `## KPI` block, read
   the KPI value by hand from the source the `## KPI` block names (`**Source**` and `**Source Config**`)
   or, when it cannot be read from here, ask the person for the number; compare it with `**Target**`
   and `**Threshold**`, and write `**KPI Actual**: N` and `**KPI Snapshot**: {JSON of what you read}`
   to `index.md`. Dev tracks without a `## KPI` block skip this.
   - **KPI failed** (the value does not reach the target or threshold): append to `plan.md`
     ```markdown
     ## ❌ KPI MISS - [ISO timestamp]
     **Target**: T | **Actual**: N | **Delta**: -D | **Window**: W
     **Snapshot**: `{raw JSON}`
     ```
     and to `conversation.md` `> **system**: ❌ KPI miss - actual=N, target=T, threshold=TH.`
     Then transition to `on_failure` (step 5, without a verdict) and skip the code checks.
   - **KPI passed:** append `> **system**: KPI measurement: actual=N, target=T, threshold=TH, passed=true.`
     with no leading emoji (it is not the terminal outcome; step 4's comment is) and continue.
2. **Execute the checks.** Read `conductor/quality-gate.md` and the track's `test.md`, and run
   every command in their "Automated Checks" / "Test Commands" sections with the shell.
   - **The checkboxes in `quality-gate.md` are a checklist to run, not a report.** Older copies
     of that file shipped pre-ticked with a stale `Status: PASS`. Re-run each command and judge
     only by output you saw yourself. If you catch yourself thinking "it's already checked",
     that is the failure this warning exists for.
   - `test.md` commands are the primary check for this track; `quality-gate.md` applies the
     project-wide standards.
   - Scan modified files for hardcoded secrets and check `.gitignore` covers the Zero-Secrets
     patterns.
   - If a command's tool is missing (for example `playwright`), install it or report a failure.
   - Non-dev tracks that passed KPI have no code to check; skip the code checks.

   **2a. Run the product, not just the code.** Unit tests show the code does what its author
   believed; they cannot show a feature is missing. If the track touched UI or a user-facing flow:
   - Run the project's browser/E2E suite if `quality-gate.md` names one (for example
     `npx playwright test`). Run the existing specs; a line saying "if UI changes exist,
     create/run tests" does not license one trivial new passing test.
   - With no E2E suite, drive the flow by hand once: start the app, use what the track added, and
     record what you saw (screenshot, or the real API/DB response). "The code looks correct" is
     not evidence.
   - **Restart long-running processes first.** Servers and long-running tools do not hot-reload, so
     verifying against a process started before your change tests the old code. This has caused
     several false passes in this repo.

   **2b. Stub and deferred-work scan.**
   ```bash
   grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder|stub" \
     --include="*.mjs" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" \
     conductor ui bin 2>/dev/null | grep -v node_modules
   ```
   - A hit inside a code path `plan.md` marks `[x]` is a FAIL, not a note.
   - Also grep `index.md`, `plan.md` and `spec.md` for `FFU`, "deferred", "future", "stub". If a
     capability named in `spec.md`'s Solution is deferred, the track cannot reach `done` (step 5).

   **2c. Judge against the user-facing promise.** Read `spec.md`'s Problem Statement and Solution
   and ask whether a user doing what the track promises would see it work. Acceptance criteria
   that assert a placeholder ("logs the expected 'not yet implemented' message") are not met
   criteria; record them in `conversation.md` as a spec defect instead of passing the track on them.
3. **Self-healing.** If a check fails and you can fix it (a syntax error, a missing command),
   you may. Before the fix: write a failing test that reproduces the bug, then fix, then re-run
   to see it pass. Commit test and fix together as `fix(quality-gate): [description]`, and post a
   comment in `conversation.md` saying what failed and what you changed.
4. **Post the result** as one dated line in `history.md`, emoji first:
   `- <YYYY-MM-DD HH:MMZ> ✅ QUALITY GATE PASSED`, or `- <YYYY-MM-DD HH:MMZ> ❌ QUALITY GATE FAILED` (use `⚠️` when
   it needs human judgment rather than a plain retry). Put the full write-up in one comment in `conversation.md`
   (authored `claude`, `>`-prefixed continuation lines), not a second one; no status goes into `plan.md` or `spec.md`.
5. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `quality-gate` (a human moved the card),
     leave `**Lane**` and `**Lane Status**` alone, keep the step 4 comment, and note there that
     the transition was skipped.
   - Otherwise take the move from the workflow: with the connector, `update_track` with
     `outcome: "success"` (PASS) or `"failure"` (FAIL), the target being `valid.next` in
     `get_track`; without it, read `conductor/workflow.json` with the grammar in
     `ops/lanes-and-statuses.md` (a bare `done` is `done:queue`).
   - **Done-gate.** A track may reach `done` (queued for merge) only if the feature works end to
     end. Confirm all of: (1) the stub scan found nothing in `[x]` code paths; (2) no capability
     named in `spec.md`'s Solution is FFU, deferred or future; (3) step 2a's real-product check
     was performed and an observation recorded. If any fails, do not set `done`: set the lane to
     `review` (or `on_failure`), keep `**Progress**` below 100%, and write what remains in
     `conversation.md`. Documenting a deferral honestly does not make the track complete; a track
     that shipped a stub and was marked `done: 100%` with an honest "SSH deferred (FFU)" note is
     the incident these rules come from.
   - **PASS:** apply the success move (this project: `done:queue`, passed and not yet shipped),
     append `## ✅ QUALITY PASSED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** apply the failure move, explain the failure in
     `conversation.md`, and in the same edit write `**Verdict**: fail`.
   - The move sets `**Lane**` and `**Lane Status**` together (a bare target is `queue`); do not set the
     status separately.
   - While the gate itself is executing (a full suite, a deploy), the track is
     `quality-gate:running`.
   - Write `**Verdict**` on every PASS/FAIL: the harness can tag the turn
     `blocked` although this step already resolved a routable outcome, and the run's exit
     handler reads `**Verdict**` first so a resolved result is routed, not parked. It is not
     written for the KPI-miss exit, which has no code verdict and routes through `on_failure` itself.

#### Offer a missing skill

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

Candidates for the `quality-gate` lane:

###### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `systematic-debugging`, `verification-before-completion`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

###### `security-guidance`

Security warnings on edits and a diff review when a turn ends, for injection, XSS, hardcoded secrets and other vulnerability classes. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `quality-gate` (lanes), Type `dev`, any stack. Level: `helps`.
It counts as installed when `claude plugin list` shows `security-guidance@claude-plugins-official`. It installs a Python hook script that runs before file edits and when a turn ends, to warn about security problems on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install security-guidance@claude-plugins-official
```

###### `playwright`

Drives a real browser to check a UI flow, click through it and take screenshots, for the quality gate of a UI track. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `quality-gate` (lanes), Type `dev`, only when the project has `ui`. Level: `helps`.
It counts as installed when its browser tools are among your tools (they start with `mcp__plugin_playwright_playwright__`), or `claude plugin list` shows `playwright@claude-plugins-official`. It installs an MCP server (the Playwright MCP Node.js program from Microsoft, fetched with npx) that drives a real browser on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install playwright@claude-plugins-official
```

Stack tags used above:

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `verification-before-completion` helps keep the rule this lane already has: run the check this time and read the real output before marking anything done.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"quality-gate"`, such as
`{ "skills": { "quality-gate": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `ops/lanes-and-statuses.md` (The five lane statuses; Transitions; Lane names; Manual moves win)

#### The five lane statuses

| Status | Meaning |
|--------|---------|
| `queue` | Waiting for the lane's action to start (or to be picked up). A track that just moved into a lane is `queue`. |
| `running` | An agent is executing this lane's action **right now**. |
| `success` | The lane's action finished well, and the track rests here (for example `plan:success`: the plan is written and parked). |
| `failure` | The lane's action failed or could not finish; a person or a retry decides next. |
| `waiting` | Parked on purpose until a human (or a named track) acts: a question, an approval, a dependency. |

**`running` belongs to the lane whose action is executing.** It is never used for work that belongs to another lane. A deploy
gate (the full suites, then the deploy) is `quality-gate:running`, not `implement:running` and not `in-progress:running`.

#### Transitions

Each lane in `conductor/workflow.json` may carry `on_success` and `on_failure`. A target is one of:

| Written | Means |
|---------|-------|
| `lane:status`, for example `review:queue`, `plan:success`, `implement:failure` | exactly that lane and status |
| `lane` alone, naming a **different** lane (`review`) | that lane with status `queue` |
| `lane` alone, naming the **same** lane the action ran in | `success` for `on_success`, `failure` for `on_failure` |
| a bare `done` from another lane | `done:queue`, never `done:success` |
| `null` | no automatic move: the lane's own action or a human decides |
| missing from the lane | the file's top-level `defaults.on_success` / `defaults.on_failure`, read the same way; no automatic move when the file has none (an explicit `null` never falls back) |
| `stay` or `stop` | no automatic move. Older files carry these words; they are read, never written, so do not put them in a file |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. These fields are leftovers of the older format and
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file (current format):

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (the older format: bare targets, old lane names): `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"`
resolves to `review:queue` on success and `in-progress:failure` on failure (the failure target names the same lane); `planning` with
`"on_success": "backlog"` resolves to `backlog:queue`; `done` and `backlog` with `null` targets have no automatic move.

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides and commands use the standard names. The standard names replaced the old ones:
`planning` to `plan` and `in-progress` to `implement`; older projects (and the older-format files they carry) keep the old names, and existing tracks
are never renamed. The lane guides stand for the project's lane that means the same thing: `plan` is `planning`, `implement` is `in-progress`.
The connector reports this mapping as `valid.guide_lanes` (and the project's lane names as `valid.lanes`); without it, match by meaning. Write
the project's own names into `**Lane**`.

#### Manual moves win

A human's move of a card always wins. Before writing any transition, re-read `**Lane**` in `index.md`; if it is no longer the lane you worked
in, leave `**Lane**` and `**Lane Status**` alone and say so in the completion comment. If you deliberately skip a lane (for example the
deploy gate stands in for review), note the skip in `conversation.md`; following the workflow strictly means taking `on_success`.

### `ops/tracks.md` (move; pulse; comment)

#### move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(it waits in that lane), `move NNN plan:success` (parked as done planning). Set `**Lane**` and
`**Lane Status**` in `conductor/tracks/NNN-*/index.md` (with the add-on, `update_track` with those markers).
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track`, which applies the workflow's move; its answer to
"where does it go" is `valid.next` in `get_track`. Without the connector, read `workflow.json` with the
grammar in `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane;
for the same lane it is `success` or `failure`).

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity; infer it if not given),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` does not write `**Status**` any more (it is a legacy marker the parser only reads when
`**Lane**` is missing).

#### comment `[track-number] [body]`

A comment from a person or an agent is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`; this is also how an agent answers a human comment. A note that records
an event (a run, a classification, a completion) is a dated line in `history.md` instead (see "What goes in each track file").
Use `⚠️` for something that needs a human and `ℹ️` for a note.

### `SKILL.md` (Finding a track; conversation.md format)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`, the
current form) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both** (a scan for one
form silently misses every folder of the other). If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If any folder exists for the number, use it. Scaffolding a second one is an error, not a
fallback: a scan that missed `AM-<number>-...` once created a duplicate `<number>-...` folder.

#### conversation.md format

`conversation.md` holds the dialogue. An entry that records an event (a lane completion, a classification) is a dated line
in `history.md` instead; with the connector, `append_conversation` with author `system` writes that line there. Every
entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a markdown header, a plain
blockquote, loose prose) stays in the file but is silently never synced to the UI, with no error.
For long pasted material (an email, a contract, a redline) keep one opening `> **author**:` line and
prefix every following line, blank ones and markdown headers included, with `>`. Do not drop the
prefix partway because the content reads like a document.
