# Track AM-10144: What's next: a state-aware command that names the next step and explains it (onboarding as a tutorial)

**Lane**: done
**Lane Status**: success
**Progress**: 90%
**Phase**: Closed by the owner 2026-11-22. Dropped: the Phase 7 walk-through (TC-31 to TC-42) in a real Fiti session and the other open tasks of Phases 7 and 8; /laneconductor:next ran correctly in a real session on 2026-11-22.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Owner idea (2026-11-18): a command, `/laneconductor:next` ("what's next"), that looks at where the project stands and tells the user the single next step, and explains what that step does and why, so using it doubles as an online tutorial and as onboarding. Today `help` lists commands but does not know the project's state, and a new user does not know whether to run setup, plan a track or implement one.

What it should do, from state to advice (all from files in git, so it works in the Markdown-only base; the connector, when present, supplies `valid.next` and the lists from 10131 and the audit tracks):
- No `conductor/` folder: "run setup", and what setup will create and ask.
- Set up but no tracks: "create your first track", with an example phrase.
- Track in plan:queue: "plan track N" (what the plan lane writes: spec, plan, test cases, and why before code).
- plan done or implement:queue: "implement track N", and that it runs in its own worktree when the parallel add-on is installed.
- implement done: review; review passed: quality-gate; done:queue: merge (asks before any push); waiting with satisfied dependencies: resume; waiting for a human reply: answer it; a stale running claim: say so.
- Several candidates: name one first, list the others in one line.
- Always: the exact command to type (in its own bash fence when it is a shell command), one sentence on what it will do, one on why it comes next, and one link to the reference (`ops/lanes-and-statuses.md`).

Tutorial mode: the first few times (or when asked, `next explain`) it explains the lane model and the markers in plain language; later it is one short line. The level is remembered only per person (a setting in the optional personal settings file, never committed), and the person can say "short" or "explain".

Open design questions: one command or also a hint at the end of every other command (the `next` field idea in track 10122); whether setup ends by saying "now run /laneconductor:next"; whether the board shows the same line; how it ranks candidates (human-waiting first, then by lane order, then by number). Depends on / uses: 10131 (valid.next), 10135 (done-lane truth), 10136 (ready to resume), 10141 (stale running); relates to 10122 (next hints) and 10124 (skill advisor offers at the moment of intent: next can point to them).

Deliverable: command `next` in the command catalog (so the base, parallel and help list it), the procedure text, tests that feed fixture projects in each state and check the named step, and a walk-through on the Fiti PLUG project.
**Summary**: A read-only command `next`, the universal front door: it reads where the project stands (files in git; the connector only adds valid.next and freshness), names the one next step with the exact command, one sentence on what and why, and teaches the lane model on the way (explain or short). With no conductor folder it offers three paths (continue an existing project, start a new one, look around); with no tracks it recommends the add-ons that fit, from the one catalog. Ships without the audit tracks 10135, 10136 and 10141, using git-only heuristics; the audit signals replace them later.
**Part Of**: 10145
**Verdict**: pass
