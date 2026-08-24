# Spec: End-to-end onboarding experience (UI and skill)

## Problem Statement

Track 1102 found the create-project → track → plan path broken at
several independent points. Fixing each in isolation missed that nobody
had decided what the experience is *supposed* to be — the bugs were
symptoms of unanswered design questions (worker-required-or-not, git-init
ownership, machine visibility, mode naming). This track answers those
questions and turns the answer into both UI affordances and the wiki
walkthroughs that document the real, walked path.

## Requirements

- REQ-1: A project with zero workers is a valid, non-blocked state, and
  the UI must say so explicitly rather than looking identical to a
  working project (D1/D2).
- REQ-2: Machine/connection information for a project's worker(s) is
  visible in the existing WORKERS bar, including projects with workers
  on more than one machine (D3).
- REQ-3: `create-project`'s git-init stays refuse-and-explain on
  non-empty directories — no silent `git add -A`, no new confirmation
  prompt for the common (empty-directory) case (D4/D5).
- REQ-4: Worker mode is labeled `Manual`/`Automatic` in the UI;
  `sync-only`/`sync+poll` remain the internal wire values unchanged
  (D6).
- REQ-5: A lane action's outcome is always one of three UI-distinguishable
  states — running, failed-with-a-reason, or succeeded-but-unmerged — never
  an indefinitely-escalating "stale" counter with no terminal state. This
  is the single highest-value fix from the confirmed inventory (hit twice,
  independently, this session: 1102 F8/F9, 1104's F12).
- REQ-6: The `lc setup` vs. UI-wizard worker-auto-start divergence is
  documented as intentional (D7), not silently inconsistent.
- REQ-7: The wiki UI guide and skill/CLI guide are each transcribed from
  a real walked session (1104/1105/1106's own session logs), not written
  from memory — a guide that can't describe a step that doesn't actually
  work.

## Acceptance Criteria

- [ ] A project with no worker shows an explicit, non-blocking indicator
      in the UI (not just an empty-looking board)
- [ ] The WORKERS bar correctly displays a project's worker(s) across
      more than one machine, not just the single-worker case already
      confirmed working
- [ ] `create-project` against a non-empty target directory still
      refuses and explains, unchanged from 1102's F7 fix — regression
      test, not new behavior
- [ ] The UI's worker mode badge/label reads `Manual`/`Automatic`; the
      underlying `mode` field/API contract is unchanged (`sync-only`/
      `sync+poll` still round-trip correctly)
- [ ] A lane action that fails during setup (1102 F8's case) shows a
      distinct failed state with a reason, not an indefinite stale timer
- [ ] A lane action that succeeds but doesn't merge back (1102 F9/F12's
      case) shows a distinct "succeeded, unmerged" state — different
      from both "running" and "failed"
- [ ] The wiki's UI walkthrough is a transcription of 1104's actual
      session-log.md, verifiable by diffing the guide's steps against
      that log
- [ ] The wiki's skill/CLI walkthrough is a transcription of 1105/1106's
      actual walked sessions (once those tracks run)

## Non-goals

- Redesigning the New Project wizard or Workers view from scratch —
  this track adds specific, scoped affordances (REQ-1/2/4/5) to the
  existing UI, not a rebuild.
- Cross-machine locking or distributed sync (that's
  [1112](../1112-git-sync-and-worktree-visibility/index.md)) — this
  track's machine-visibility requirement (REQ-2) is purely about
  *displaying* existing worker registration data, not new synchronization
  mechanics.
- The remote-mode zero-hosts onboarding flow itself — that's
  [1108](../1108-remote-worker-vm-provisioning/index.md); this track's
  REQ-1 only establishes that the *state* (project, no worker) is valid
  and must be shown, not how a user gets their first worker running.
