# implement lane: `/laneconductor implement N`

Execute the track's `plan.md`, phase by phase, communicating through files. A worker or runner
normally has already locked the track and started you in `.worktrees/NNN`; that is where the
commits go.

0. **Claim the track first.** Write `**Lane**: implement` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: a human may run this right after planning, and
   this project's `workflow.json` keeps `plan.on_success: plan:success`, so the track does not
   land in the implement lane by itself. Without it the board shows the track running in the
   wrong column.
1. **Locate the track.** `lc track-dir <N>` prints its folder (either naming convention). Never
   scaffold a second folder for an existing number. Without `lc`, check
   `conductor/tracks-metadata.json`, then scan `conductor/tracks/` for `INITIALS-NNN-slug` and
   `NNN-slug`.
2. **Workspace.** If you were not started inside `.worktrees/NNN` and the track is branch-mode,
   take the lock yourself: `node conductor/lock.mjs NNN` (prints JSON with `worktree_path`),
   work there, and finish with `node conductor/unlock.mjs NNN`, also when the work fails. If the
   lock is already held, stop and report instead of working in the primary checkout.
3. **Read context.** On `FRESH_SESSION: false` skip what you already read this session, except
   `conversation.md` and `last_run.log`, which you always check for anything new.
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
   - Check `.claude/skills/` for recommended skills (marketing: `social-content`, `copywriting`,
     `content-strategy`, `launch-strategy`; sales: `sales-enablement`, `cold-email`). Print
     `⚠️ Track type '<type>' works best with [skill] - not found in .claude/skills/` for each
     missing one and `💡 Invoke /[skill] before writing content` for each present one.
   - Read `## Draft` from `spec.md`; output the publish-ready content and the
     `### Publish Instructions` to the user.
   - Set `**Waiting for reply**: yes` in `index.md`. That marker is itself the Inbox signal, so no
     completion comment is needed. The worker sees the human's "done" reply and schedules the
     quality gate.
   - Stop. Do not transition the lane yourself.
4b. **Fundamentals conflict (dev tracks).** If what you must build conflicts with, or implies a
   change to, `product-guidelines.md`, `design-language.md`, `tech-stack.md` or `workflow.md`,
   do not write code that contradicts them and do not rewrite them silently. Append the same
   `> **system**: ⚠️ FUNDAMENTALS CONFLICT - ...` comment the plan lane uses, naming the doc and
   the conflict. It is non-blocking unless proceeding would be actively wrong; then treat it like
   any blocker and stop for human input instead of guessing.
5. **Dev tracks: per phase.**
   - Implement the tasks.
   - **Run the verification before you tick anything.** Do not mark a task `[x]` or write
     "Phase N complete" until you have executed whatever verifies it and read the real output.
     This holds even when `test.md` has no case for the phase: if there is a CLI flag, endpoint,
     UI flow or dispatch to exercise, exercise it. A written-but-unrun test file or a plausible
     diff is not verification. Track 1087 phase 6 shipped a "complete" phase with two new test
     files that were never run (one had an import error) and a hardcoded `null` that broke the
     one path that mattered.
   - **Never end a turn on a command you just backgrounded.** The harness kills background
     children when the session exits, so the work is silently lost and the run exits 0
     mid-work (track 1102 F21; the exit handler now reports `ended_mid_work`, which is recovery,
     not prevention). Run long commands in the foreground and wait, or hand off explicitly with a
     note in `conversation.md` naming what is still running and what the next turn should check.
   - Update `plan.md` (tick the task) and the `**Progress**` marker in `index.md`.
   - Commit: `feat(track-NNN): Phase X - description`.
6. **Complete (dev tracks).** Apply the same verification bar to the track as a whole before
   writing `## ✅ COMPLETE`.
   - Set `**Progress**` to 100%.
   - **Transition.** Re-read `index.md`'s `**Lane**` first. If it is no longer `implement` (a
     human moved the card), leave `**Lane**` and `**Lane Status**` alone and say so in the
     completion comment. Otherwise read `conductor/workflow.json` and set `**Lane**` to
     `lanes.implement.on_success` (this project: `review:queue`).
   - Append `## ✅ COMPLETE` to `plan.md`.
   - Append the completion comment to `conversation.md`:
     `> **system**: ✅ Implementation complete - moved to <lane>.`
   - Final commit: `feat(track-NNN): Implementation complete`.
7. **Release the lock** if you took it in step 2 (`node conductor/unlock.mjs NNN`).

Boundaries: `workflow.json` is the only authority for target lanes. On exit, `**Lane Status**`
should end as `success` or `queue` according to the outcome; if the work failed, still unlock.
