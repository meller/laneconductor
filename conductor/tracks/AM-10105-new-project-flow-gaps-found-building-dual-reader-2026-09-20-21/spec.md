# Spec: New-project flow gaps found building Dual Reader

## Problem Statement

A real end-to-end "Create with chat" new-project session (Dual Reader,
2026-09-20/21) hit eight distinct platform defects. Two were fixed live during
that session and are explicitly **out of scope** here:

- `.gitignore` scaffold entries missing — fixed as commit `6da8937d` with a
  regression test.
- `git init` defaulting to `master` with no origin — fixed via `git init -q -b main`.

The remaining eight are covered by this track. Each is a real, reproducible
defect in LaneConductor's own worker, collector API, CLI, or schema tooling —
not a Dual Reader problem. This is an umbrella track following track 1102's
precedent: one track, one phase per finding, each independently shippable.

### Planning-time verification

Every finding below was re-verified against this repo during planning. Three
findings' stated root cause turned out to be **wrong or too narrow**, and the
corrected diagnosis is recorded here — this matters because implementing the
originally-stated fix would not have fixed the bug:

| Item | Originally stated | Verified reality |
|---|---|---|
| 4 | "`lc worker sync` has a project-root-resolution bug" | Root resolution is fine. `findTrackFolder()` in `conductor/remote-sync.mjs:124` matches only `/^(\d+)-/` — the **legacy** folder convention. Every Dual Reader track used `INITIALS-NNN-slug`, so every one missed. Same bug class as track 10040's Finding 6, in a file that fix never touched. |
| 5 | "`projects.file_manifest` column is missing from the deployed schema — add the missing migration" | The migration already exists (`migrations/20260908120000_add_project_file_manifest.sql`). It was never **applied**. `atlas_schema_revisions` stops at `20260825120000` — nine migrations behind — and the columns are genuinely absent from the live DB. |
| 3 | "review park loops forever" | Confirmed, but there are two independent causes (stale routing *and* no repeat-park guard), not one. |

---

## Findings

### F1 — `POST /api/projects/:id/tracks/:num/resume` is not idempotent

`ui/server/index.mjs:5830`. The handler does a `SELECT` of
`lane_action_status`, checks it equals `'waiting'`, then issues an
unconditional `UPDATE`. Classic check-then-act with no atomicity and no
dedupe — the same shape as the `api_tokens` TOCTOU that track 10074 fixed with
a DB-enforced invariant.

Observed live: a `409`, then an immediate retry returning `200`. The retry
produced a **second real queue transition**, and two concurrent `claude`
processes ended up claiming the same `track_number` in the same worktree
(confirmed via each PID's own open file descriptors).

Two distinct mechanisms produce this, and a fix must close both:

1. **Concurrent calls.** Two requests both read `waiting`, both `UPDATE`.
2. **Sequential calls across a re-park.** Call 1 resumes; the track runs,
   parks again; call 2 (the "retry") legitimately sees `waiting` and resumes
   again. State-based idempotency alone cannot catch this — the state really
   did return to `waiting`. Only a request-identity dedupe can.

Note: nothing in `ui/src` or `bin/lc.mjs` calls this endpoint. The retry came
from a human or an agent session, so the fix belongs in the endpoint, not in a
client.

### F2 — Claim/reclaim checks only its own recorded PID, never "is anyone else running this track"

`conductor/services/run-marker.mjs` stores exactly one PID per track in
`conductor/.runs/<track>.json`, and `isRunMarkerLive()` answers only *"is the
PID **this marker** recorded still alive?"*. Nothing ever asks *"is some other,
untracked process already working this track?"*.

This is why F1's duplicate dispatch became an actual collision rather than
being caught: the second dispatch overwrote the first's marker, so from that
moment the first process was invisible to every liveness check in the system.

The conversation-reply path (`laneconductor.sync.mjs:8475`) already defers when
the marker is live — that guard is correct but insufficient, because it trusts
a single-slot marker that the colliding writer clobbers.

### F3 — An answered `review:waiting` park re-runs review instead of acting on the reply

Observed: review found real blockers and asked a question. The human replied.
The reply resumed the **review** lane, which ran a **fresh** session (new
`session_id`, not `--resume`), reached the same conclusion, and re-asked the
same question. Three times in ten minutes, with no error anywhere. The only
escape was `lc move <track> implement:queue`, bypassing `resume()` entirely.

Two independent causes:

- **F3a — no answered-park routing.** `workflow.json`'s
  `review.on_failure: implement:queue` exists for exactly this situation, but
  it only fires on a hard FAIL verdict. A review that parks at `waiting` (a
  question) never reaches it, so an answered question routes back into the same
  review lane that asked it.
- **F3b — no repeat-park guard.** Nothing counts consecutive parks of the same
  lane action on the same track. The codebase already has this exact pattern
  twice — `prespawn-block-counter.mjs` (streak + cause-change reset) and
  `stuck-track-sweep.mjs` (escalate on repeat sighting) — but neither covers
  lane-action parks. Three identical parks produced three identical `⚠️`
  comments and no escalation.

### F4 — `remote-sync` cannot see prefixed track folders; no DB/file drift reconciliation

Two parts.

**F4a — the resolver bug.** `conductor/remote-sync.mjs:124`:

```js
const match = d.match(/^(\d+)-/);
return match && match[1] === trackNumber.toString();
```

This matches only the legacy `NNN-slug` convention. `AM-10105-...` never
matches, so `lc worker sync` (which shells to `lc remote-sync`, `bin/lc.mjs:2051`)
reports `Track folder not found` for every track in any project created after
the prefixed convention landed — i.e. every new project. `remote-sync.mjs`
imports nothing from `conductor/services/track-folder.mjs` /
`track-folder-fs.mjs`, the canonical resolvers the worker and `lc track-dir`
both use.

**F4b — the drift itself.** A track planned by editing
`conductor/tracks/<dir>/*.md` directly on disk never reached the DB. The UI
showed "Plan, 0%, no content" while the real file had a completed plan.
`autoLaunchLocalFs` reads the file directly, so automation was not blocked —
which is precisely what made this dangerous: the misleading view was the
*only* symptom, and nothing surfaced it.

### F5 — Schema migrations are never applied automatically, by either migration system

`PATCH /worker/file-manifest` 500s on every single worker start with
`column file_manifest of relation projects does not exist`.

The narrow fix (add the migration) is a no-op — it already exists. Verified
live:

- `migrations/20260908120000_add_project_file_manifest.sql` is present on disk.
- `atlas_schema_revisions` latest entry is `20260825120000` — nine migrations behind.
- `information_schema.columns` has no `file_manifest*` column on `projects`.

This repo has **two** migration directories and **no runner for either**:

| Directory | Tooling | Runner | State |
|---|---|---|---|
| `migrations/` | Atlas | none in `bin/lc.mjs` or `ui/server/index.mjs` | 9 behind on the live DB |
| `ui/server/migrations/*.sql` | hand-written SQL | none — confirmed by track 10060's own spec | applied ad hoc by hand |

Track 10060 already documented this exact gap for
`ui/server/migrations/013_track_10040_prespawn_block.sql` and worked around it
with a filesystem fallback counter. That workaround treated the symptom. The
same root cause is now producing a second recurring 500, which means it will
keep producing new ones.

### F6 — No documented GCP/Firebase deployment convention for new products

Every LaneConductor-built product shares **one** GCP project
(`laneconductor-site`) as its own Firebase Hosting *site* + Functions
*codebase*. Nothing states this anywhere. It was discoverable only by reading
sibling products' `.firebaserc`/`firebase.json` by hand.

The natural default assumption — a dedicated GCP project per product — is
actively wrong and hits GCP project-quota exhaustion. There is no
`conductor/deployment-conventions.md`, and this repo's own `.firebaserc` is
empty, so the scaffold has nothing to point a new project at.

### F7 — Neon MCP server auth fails (401 `invalid_token`)

Reproduced in this very planning session:

```
Neon (AUTH_HEADER_REJECTED): Server rejected the configured Authorization
header (HTTP 401) ... OAuth fallback is disabled when headers.Authorization
is set. Error detail: { error: invalid_token, error_description: No
authorization provided }
```

The error text is self-contradictory in a way that points at the cause: the
client sent an `Authorization` header (which disabled OAuth fallback), but the
server reports receiving *none*. That is the signature of a malformed or
unsubstituted header value, not an expired token. `plugin:github:github` fails
in the same session with `Authorization header is badly formatted` — the same
class of failure on a different server, which suggests a shared MCP config
defect rather than two independent stale credentials.

Scope: **diagnose and report**. This is an environment/config issue, not
LaneConductor platform code. Fixing it may require a credential the agent does
not hold.

### F8 — Scaffolded `workflow.json` pauses after every plan, contradicting `Auto Run: yes`

The canonical `conductor/workflow.json` (the file the scaffold copies) sets
`plan.on_success: "plan:success"`. `plan:success` is a terminal resting state:
the auto-launch loop only claims `queue`, so the track sits forever. Every
track in a fresh project exhibits "stuck after planning", regardless of its
`**Auto Run**: yes` marker.

**This is partly a documentation defect, not purely a config one.** `Auto Run`
is defined (see the marker table in `SKILL.md`) as *"whether a non-sync-only
worker's auto-launch loop may claim this track **from the queue**"*. It has
never promised lane auto-advance. A track at `plan:success` is not in the
queue, so `Auto Run` is not being violated — but the observed behaviour is
still wrong, because nothing tells the user the track is parked on purpose.

A fix applied to one project's `workflow.json` via
`POST /api/projects/:id/workflow` is not a platform fix (and a plain file edit
there is silently reverted by the next DB→file sync).

**Open decision — flagged for the author, not decided here.** Changing
`plan.on_success` to `implement:queue` means a fresh project auto-implements
every planned track unattended. `conductor/workflow.md`'s Workspace Modes
section is explicit that unattended autonomy should default to the safe side.
The plan below therefore implements the *reversible, visible* option
(Option B) and does not change behaviour for any existing project; see
`plan.md` Phase 8 for the three options and the recommendation.

---

## Requirements

- **REQ-1** (F1): `POST .../resume` must be safe to call any number of times
  for one human intention. Concurrency must be resolved by the database, not by
  application sequencing.
- **REQ-2** (F1): A repeat call that is genuinely a *new* human intention (the
  track parked again in between) must still resume. Idempotency must not become
  "resume once, ever".
- **REQ-3** (F2): Before dispatching any run for a track, the worker must
  establish that no *other* live process is already working that track — not
  merely that its own recorded PID is dead.
- **REQ-4** (F2): Writing a run marker must not silently destroy evidence of an
  existing live run.
- **REQ-5** (F3a): A park that a human has answered must route according to the
  lane's configured outcome, not unconditionally re-enter the lane that parked.
- **REQ-6** (F3b): Consecutive parks of the same lane action on the same track
  must be counted and must escalate to a terminal, human-visible state rather
  than repeating silently.
- **REQ-7** (F4a): `remote-sync` must resolve track folders under **both**
  naming conventions, using the shared canonical resolver rather than its own
  regex.
- **REQ-8** (F4b): DB/file drift must be either auto-reconciled or explicitly
  surfaced. A silently-stale UI view is not acceptable.
- **REQ-9** (F5): Pending schema migrations must be detected and reported on
  worker/API start, naming exactly what is pending and how to apply it.
- **REQ-10** (F5): The two migration directories must be reconciled — one
  documented source of truth, or both explicitly covered by the detector.
- **REQ-11** (F6): The shared-GCP-project convention must be written down at
  the meta level, and the scaffold must point at it instead of leaving a new
  project to guess.
- **REQ-12** (F7): The Neon MCP 401 must be diagnosed to a stated root cause
  and either fixed or documented as an environment action with the exact steps.
- **REQ-13** (F8): "Stuck after planning" must stop being silent, and the
  scaffold's chosen default must be a deliberate, documented decision.

### ⚠️ Open item for human review — fundamentals conflict

Two phases require editing project fundamental docs. Flagged here rather than
done silently (see `SKILL.md`'s fundamentals-conflict guardrail); non-blocking,
but the author should confirm both before implement lands them:

- **`conductor/tech-stack.md`** (Phase 5, Task 5.1) — its Database section names
  only Atlas + `migrations/`. It does not mention `ui/server/migrations/*.sql`
  at all, so it is already an incomplete description of reality. REQ-10 requires
  correcting it.
- **`conductor/workflow.md`** (Phase 8, Tasks 8.2–8.3) — `Auto Run`'s scope and
  the `plan.on_success` knob need stating. This is a documentation correction,
  not a behaviour change.

Neither is a change of project direction; both are corrections of docs that
currently understate or omit existing behaviour. No fundamental doc is modified
by this planning phase.

## Non-Goals

- Re-fixing the two items already fixed live (`.gitignore` scaffold entries,
  `git init -b main`).
- A general distributed-lock/leader-election layer. REQ-3 is a single-machine
  collision check, consistent with track 10079's "co-located only" scope
  boundary.
- Backfilling or repairing DB rows that drifted before this track. REQ-8 covers
  detection and forward reconciliation only.
- Changing `plan.on_success` for existing projects (see F8).
- Holding the whole track on F7. It is an environment issue and may end at
  "documented, requires a credential the agent does not hold" — that is an
  acceptable, explicitly-stated outcome for that phase alone.

## Acceptance Criteria

- [ ] **AC-1**: Firing `POST .../resume` twice concurrently on one parked track
      produces exactly one queue transition and exactly one dispatch. The second
      response is a success, not a 409.
- [ ] **AC-2**: After a resumed track parks again, a genuinely new resume call
      still resumes it.
- [ ] **AC-3**: With a live agent process already working track N, a second
      dispatch attempt for track N is refused and says so in the log. Two
      concurrent sessions on one track cannot be produced by any resume path.
- [ ] **AC-4**: A human answering a `review:waiting` question moves the track to
      the lane `workflow.json` specifies for that outcome. The same question is
      not re-asked by a fresh review session.
- [ ] **AC-5**: A lane action that parks repeatedly on the same cause reaches a
      terminal failure state with an explanatory comment, instead of repeating
      indefinitely.
- [ ] **AC-6**: `lc worker sync` in a project whose tracks use `INITIALS-NNN-slug`
      folders syncs them. Zero `Track folder not found` warnings for tracks that
      exist on disk.
- [ ] **AC-7**: A track hand-edited on disk becomes visible with its real lane
      and progress in the UI without any manual step beyond what is documented,
      OR an explicit, visible warning names the drift. A silent stale card fails
      this criterion.
- [ ] **AC-8**: `PATCH /worker/file-manifest` returns 2xx on a freshly-migrated
      database, and worker startup produces no `file_manifest` 500.
- [ ] **AC-9**: Starting a worker against a database with pending migrations
      prints which migrations are pending and the command to apply them. Against
      an up-to-date database it prints nothing new.
- [ ] **AC-10**: `conductor/deployment-conventions.md` exists, states the
      one-shared-GCP-project rule plainly, and is referenced from the scaffold
      output a new project actually sees.
- [ ] **AC-11**: The Neon MCP failure has a stated root cause and either
      connects successfully, or is documented with exact remediation steps and
      who must perform them.
- [ ] **AC-12**: After planning completes in a newly scaffolded project, the
      track's state is legible: either it advanced, or the UI shows why it is
      paused and what resumes it.

> Criteria deliberately describe observable outcomes. None of them can be
> satisfied by a stub, a log line asserting "not yet implemented", or a
> newly-written trivially-passing test.

## API Contracts / Data Models

### F1 — resume endpoint

Replace the `SELECT`-then-`UPDATE` pair with a single conditional update:

```sql
UPDATE tracks
   SET lane_action_status = 'queue', lane_action_result = NULL,
       waiting_reason = NULL, claimed_by = NULL,
       last_updated_by = 'human', last_heartbeat = NOW(),
       last_resume_key = $3, last_resumed_at = NOW()
 WHERE project_id = $1 AND track_number = $2
   AND lane_action_status = 'waiting'
   AND (last_resume_key IS DISTINCT FROM $3)
RETURNING lane_status;
```

Response contract:

| Situation | Status | Body |
|---|---|---|
| Row updated | 200 | `{ ok: true, lane_status, lane_action_status: 'queue' }` |
| Already `queue` or `running` | 200 | `{ ok: true, noop: true, already_resumed: true, lane_action_status }` |
| Same `Idempotency-Key` seen before | 200 | `{ ok: true, noop: true, duplicate_request: true }` |
| Track not `waiting` and not `queue`/`running` | 409 | unchanged — a genuinely stale caller view |
| Track absent | 404 | unchanged |

`Idempotency-Key` is an optional request header. When absent the endpoint keeps
today's behaviour plus the atomic CAS — i.e. REQ-1 is satisfied without a
client change; REQ-2's cross-re-park case requires the header.

### F1 — schema

```sql
ALTER TABLE tracks ADD COLUMN last_resume_key  text NULL;
ALTER TABLE tracks ADD COLUMN last_resumed_at  timestamp NULL;
```

Must be added to **both** migration directories per REQ-10's resolution, or to
whichever single one Phase 5 establishes as canonical. Phase 5 lands before
this migration is written so there is one place to put it.

### F2 — run marker

`conductor/.runs/<track>.json` gains a claim discipline rather than a new
shape:

- Write is `O_EXCL`-guarded. An existing marker whose PID is live is **never**
  overwritten; the caller is refused.
- An existing marker whose PID is dead is replaced, with the replacement logged.
- A `scanLiveRunsForTrack(trackNumber)` helper cross-references the marker
  against a real process scan (`readProcessCommand` over candidate PIDs) so a
  process whose marker was clobbered before this fix is still detected.

### F3b — park streak

Reuse `prespawn-block-counter.mjs`'s established shape exactly (sibling counter
files beside the track, cause-change reset, DB column when available): a
`**Park Count**` streak keyed on the park's cause, reset by a human resume or a
different cause, escalating to `<lane>:failure` at the configured threshold.

### F5 — migration status

A pure `conductor/services/migration-status.mjs` that, given the applied
revision list and the on-disk migration filenames, returns
`{ pending: [...], applied: [...], behind: n }`. No I/O in the module; the DB
query and directory read are injected, matching the testing style of every
other service in `conductor/services/`.
