# Track 1103: End-to-end onboarding experience (UI and skill), and the wiki walkthroughs

## Phase 1: UI happy path — explicit states

**Problem**: No written definition of "what should the user see at each
step" exists; 1102/1104's bugs were found by accident, not against a
spec.
**Solution**: The actual sequence, grounded in this session's real
dogfooding (1102, 1104) — not idealized, the *observed* behavior as of
2026-08-13, with unrepresented states marked explicitly.

1. **Nothing exists.** User opens the app, no projects registered.
2. **`+ Project` wizard.** Name, path/git-source, mode. On submit: scaffolds
   `.laneconductor.json`, 9 context files (product/tech-stack/workflow/
   product-guidelines/design-language/deployment-stack/kpis/user-stories/
   quality-gate.md), git-inits the target if needed (1102 F7), and
   **auto-starts a worker** — no separate step. *(Confirmed live, 1104
   Phase 1.)*
3. **Worker comes online.** WORKERS bar shows hostname, mode badge
   (`SYNC-ONLY`/manager), project scope, model — **this part is done
   well**, confirmed live as a positive reference point, not just a gap
   list.
4. **`+ Track` modal.** Scaffolds all 5 files (`index`/`spec`/`plan`/
   `test`/`conversation`) with a real, non-stub `test.md`. Lands at
   `plan/queue`.
5. **Trigger the Plan action** from the track card. Dispatches to the
   worker (1102 F5, confirmed fixed), Activity panel shows it live.
   ⚠️ **Unrepresented state**: if the dispatched run's worktree result
   never merges back (1102 F8/F9/F12 — three distinct root causes, same
   visible symptom), the card shows an ever-escalating "stale Ns" timer
   that **never resolves into a failure state** — no retry affordance,
   no error text, nothing distinguishing "still working" from "silently
   broken" from "actually finished but stuck in a worktree." *(Confirmed
   live twice, 1102 and independently again in 1104.)*
6. **Track detail drawer** — Transcript panel is good; Logs tab is
   readable but raw JSONL; Conversation tab correctly empty until a
   comment exists.
7. **Inbox** — accurately shows "No active conversations" when nothing
   needs a reply. No gap found here.
8. **CI/CD tab → Deploy wizard** — reaches step 1 (Provider selection)
   cleanly. Not walked further (deploying was explicitly out of scope for
   dogfooding).

**Unrepresented-state inventory** (carried forward from 1104 Phase 3,
this is the concrete input Phase 4 below consumes):

| State | Shown today | Gap |
|---|---|---|
| No manager worker registered | Clear blocking modal, exact fix command, target machine | None — reference for how the others should look |
| Which machine/mode a worker is on | WORKERS bar: hostname, mode badge, scope, model | None — also done right |
| Project is not a git repo | N/A now (1102 F7 fixed the wizard's own trigger) | No UI rendering exists at all for this state — still reachable via "Git URL to clone" pointing at a bad remote, or a hand-authored `.laneconductor.json` |
| Lane action running vs. stuck | `stale Ns` counter, yellow→red, no ceiling | Never resolves into an actionable failure state |
| Lane action failed (exception during setup) | Board shows `running`; Activity shows worker `idle` — panels contradict | No error text, no distinction from "still working" |
| Lane action succeeded but didn't sync back | Indistinguishable from "stuck with no output" | No way to say "it finished, here it is" vs. "this broke" |
| Project has zero workers | Board looks identical to a working project until you queue something | No "this project has no worker" indicator anywhere |

**Impact**: A concrete, evidence-backed UI state list — Phase 4's actual
input.

## Phase 2: Skill/CLI happy path — explicit states, and where it diverges from the UI

**Problem**: Same gap as Phase 1, for the two non-UI entry points. Not
previously walked this session; grounded here by reading `lc setup`'s
actual implementation (`bin/lc.mjs`) rather than assumed.

### Variant A — full-stack CLI (`lc setup`)

1. `lc setup` — prompts: project name (defaulted from `package.json`),
   git remote (auto-detected), operating mode (`local-fs`/`local-api`/
   `remote-api`, prompt defaults to `local-api`), DB config if
   `local-api`.
2. Writes `.laneconductor.json`, symlinks the skill (+ Antigravity
   variants), registers the project in the DB if API mode.
3. Runs an interactive AI brainstorm loop, then generates the 9 context
   files via `/laneconductor setup scaffold generate`.
4. Prints explicit next steps and **stops** — does not auto-start a
   worker.

   ```
   Next steps:
     1. Run "lc ui start" ...
     2. Run "lc start" ...
     3. Create your first track with "lc new".
   ```

   **⚠️ Confirmed divergence from the UI path**: the UI's `+ Project`
   wizard auto-starts a worker (step 2 above); `lc setup` explicitly
   requires the user to run `lc start` as a separate, manual step. Two
   entry points, two different defaults for the same underlying action.
   Not yet judged whether this is intentional (CLI users may reasonably
   want to review config before starting a live worker) or an
   inconsistency worth closing — decision needed in Phase 3.

5. `lc new` scaffolds a track (mirrors the UI's `+ Track`, same 5 files).
6. `lc plan <id> --run` (or queueing + a running worker) mirrors the UI's
   "Run plan action" — same underlying dispatch/queue mechanism
   (`autoLaunchLocalFs`/claim-queue, per track 1110), so the *execution*
   path is identical once a worker exists; only the *getting a worker
   started* step differs from the UI.

### Variant B — Skill-Only mode (no `lc`, no DB)

Per `SKILL.md`'s own description: `/laneconductor setup` detects no `lc`
binary, assumes `mode: "local-fs"`, writes a minimal
`.laneconductor.json`, and proceeds straight to scaffold generation — no
brainstorm-loop distinction from Variant A at the file-generation step,
but **there is no worker at all**: the AI itself acts as the
orchestrator, updating `conductor/` files directly during its own turn
rather than a background process reacting to them.

This makes several of Phase 1's UI-path concepts **not applicable**, not
just differently-implemented:
- "Which machine is the worker on" — no machine/worker to report; there
  is no persistent process.
- "Worker mode (manual/automatic)" — doesn't exist; the AI drives the
  lane transitions inline, synchronously, during the conversation.
- Live Activity/Transcript panel — nothing to stream; the "live view" is
  the AI editor's own chat transcript.

This is documented as advertised behavior but had never actually been
walked this session — flagged in track 1105's own scope as something to
verify hands-on, not assumed correct just because `SKILL.md` describes
it.

**Impact**: The CLI/skill happy path is now written down with the same
rigor as the UI path, and one concrete, confirmed divergence (worker
auto-start) is identified for Phase 3 to decide on rather than leaving
implicit.

## Phase 3: Decisions

See `conversation.md` for the reasoning behind each — decided
2026-08-13, with explicit user sign-off sought on the two genuinely
subjective/product calls (git-init ownership+approval, machine/
connection surfacing prominence) rather than silently assumed.

- [x] D1: Is a project with zero workers a valid, expected state, or
      should the UI actively discourage/block reaching it?
- [x] D2: Does the UI say "this project has no worker" explicitly?
- [x] D3: How prominently is machine/connection info surfaced (which
      machine(s) a project's worker(s) run on)?
- [x] D4: Who owns git-init — `create-project`'s current placement
      (manager handler), or `lc setup`/the project's own worker on first
      start?
- [x] D5: Does git-init require explicit user approval (a prompt), or
      does 1102's current refuse-and-explain-on-non-empty-dir remain
      sufficient?
- [x] D6: Worker mode naming — `manual`/`automatic` as user-facing
      labels over `sync-only`/`sync+poll` (keeping the latter as the
      internal wire values)?
- [x] D7: Should `lc setup`'s worker-auto-start behavior match the UI
      wizard's (auto-start), or is the current divergence (UI auto-
      starts, CLI requires a manual `lc start`) intentional and worth
      keeping, documented rather than silently inconsistent?

## Phase 4: UI affordances

- [ ] Implement D1-D3's decisions: a "no worker" state indicator, and
      whatever machine/connection display D3 settles on
- [ ] A real failure/stuck-vs-succeeded-unmerged state in the track
      card, replacing the indefinite "stale Ns" counter (Phase 1's
      biggest confirmed gap) — this is the highest-value single fix from
      the whole inventory, hit independently twice this session
- [ ] Worker mode label change per D6 (UI display only — wire values
      unchanged, per D6's own framing)

## Phase 5: Wiki walkthroughs

- [ ] UI guide, transcribed from 1104's actual session-log.md (once
      1104 itself reaches this point — see its own Phase 4)
- [ ] Skill/CLI guide, transcribed from 1105/1106's walkthroughs (not
      yet run — this phase is blocked on those)
- [ ] Both guides link the unrepresented-state inventory inline at the
      step that surfaces it, not as a separate appendix

## Phase 6: E2E spec

- [ ] Once track 1100's fast tier is stable (currently 85%, not yet
      `done` — see track 1100), add a spec walking this document's UI
      happy path, so the walkthrough can't silently rot
