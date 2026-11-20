# quality-gate lane: `/laneconductor quality-gate N`

Run the checks, post the result, and route the track. Passing here queues a code track for merge
(`done:queue`); it is not shipped until the merge action sets `done:success` once the code is on `main`.
A non-dev track has no branch, so a pass closes it as `done:success`: nothing to merge.

0. **Claim the track first.** Write `**Lane**: quality-gate` and `**Lane Status**: running` to
   the track's `index.md`. Set `**Lane**` explicitly: when run directly the track may not sit in
   this lane, and the board would show it running in the wrong column. In the same edit, clear
   any existing `**Verdict**` marker, so a run cut short never leaves a stale value.
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
   - **Non-dev result:** after the readout write `**Result**` to `index.md` (one line, up to 200 characters:
     what you read and what it taught) and one dated `history.md` line with the same. Never invent a number.
     A miss with the run window used up (`KPI Check After` is today or earlier, or the `**Kill rule**` of the KPI
     block says stop) closes the track instead of the `on_failure` move: `done:success` with `killed:` and the reason in `Result`
     (`done:failure` means the merge failed; no merge is needed here). A miss with window left follows the
     KPI MISS replanning above.
2. **Execute the checks.** Read `conductor/quality-gate.md` and the track's `test.md`, and run
   every command in their "Automated Checks" / "Test Commands" sections with the shell.
   - **The checkboxes in `quality-gate.md` are a checklist to run, not a report.** Re-run each command
     and judge only by output you saw yourself, never by a ticked box or a stale `Status: PASS`.
   - `test.md` commands are the primary check for this track; `quality-gate.md` applies the
     project-wide standards.
   - Scan modified files for hardcoded secrets and check `.gitignore` covers the Zero-Secrets
     patterns.
   - If a command's tool is missing (for example `playwright`), install it or report a failure.
   - Non-dev tracks that passed KPI have no code to check; skip them.

   **2a. Run the product, not just the code.** Unit tests show the code does what its author
   believed; they cannot show a feature is missing. If the track touched UI or a user-facing flow:
   - Run the project's browser/E2E suite if `quality-gate.md` names one (for example
     `npx playwright test`). Run the existing specs; a line saying "if UI changes exist,
     create/run tests" does not license one trivial new passing test.
   - With no E2E suite, drive the flow by hand once: start the app, use what the track added, and
     record what you saw (screenshot, or the real API/DB response). "The code looks correct" is
     not evidence.
   - **Restart long-running processes first.** Servers and long-running tools do not hot-reload, so
     verifying against a process started before your change tests the old code.

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
4. **Post the result** (a missing `**Serves**` is a note, never a failure) as one dated line in `history.md`, emoji first:
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
     [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md) (a bare `done` is `done:queue`).
   - **Done-gate.** A track may reach `done` (queued for merge) only if the feature works end to
     end. Confirm all of: (1) the stub scan found nothing in `[x]` code paths; (2) no capability
     named in `spec.md`'s Solution is FFU, deferred or future; (3) step 2a's real-product check
     was performed and an observation recorded. If any fails, do not set `done`: set the lane to
     `review` (or `on_failure`), keep `**Progress**` below 100%, and write what remains in
     `conversation.md`. Documenting a deferral honestly does not make the track complete.
   - **PASS:** a code track takes the success move (this project: `done:queue`, passed and not yet shipped).
     A non-dev track (`**Type**` not `dev`) sets `**Lane**: done` and `**Lane Status**: success` instead (with the connector,
     as markers, not `outcome`) and says in one clause that there is nothing to merge. Append `## ✅ QUALITY PASSED` to
     `plan.md`, and in the same edit write `**Verdict**: pass`.
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
6. **Close** with the closing message of a lane. A non-dev track closed at `done:success` names `/laneconductor:next`, not merge.

## Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

<!-- generated: skill offers for this lane -->

## Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `verification-before-completion` helps keep the rule this lane already has: run the check this time and read the real output before marking anything done.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"quality-gate"` (`{ "skills": { "quality-gate": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.
