# Spec: Manager worker credential storage

## Problem Statement

A manager worker (`lc worker start --manager`) has **no credential or
endpoint storage of its own**. It is spawned with `cwd: workerRoot` — the
directory `lc` happened to be invoked from — and from there it loads that
directory's `.env` and `.laneconductor.json` exactly as a project worker
would. Every piece of its network identity is therefore borrowed from
whichever project it was started inside.

`conductor/laneconductor.sync.mjs` deliberately does **not** normalize a
manager's cwd (line 153, `isManager` → "leave cwd alone", correct in
itself: a manager isn't scoped to any checkout), so the borrowed config is
whatever is on disk at the launch directory.

Track 1102's F13 fixed one *symptom* of this — `PATCH /worker/heartbeat`
now trusts an explicit body `project_id` (including `null`) over
`collectorAuth`'s auth-derived value — but the borrowing itself is intact,
and this spec's audit found the same class of defect still live in three
more places.

### The borrowed-identity surface (audited)

`resolveCollectorToken(idx)` / `resolveToken(collector, envKey)` in
`conductor/laneconductor.sync.mjs`, in precedence order, for a manager
started inside a project (`workerNumber` is always 1 for a manager —
`--worker-number` is deliberately not read in that branch, line 118):

| # | Source | Site | What a manager gets |
|---|--------|------|---------------------|
| A | `.env` → `COLLECTOR_0_TOKEN` | `sync.mjs:252-257`, `:911`, `:829` | The **project's** collector token, at the highest precedence of all |
| B | Per-worker token store `conductor/.worker.tokens.json` | `sync.mjs:797`, `:916`, `:833` | The path is **relative to cwd** and keyed only on `workerNumber === 1` — so a manager and the project's worker #1 read and write **the same file**, clobbering each other in both directions. This is precisely the impersonation the store was built (see its own header comment, `sync.mjs:777-796`) to make impossible. |
| C | `collectors[0].machine_token` | `sync.mjs:947`, `:865` | The originally filed bug: the `workerNumber === 1` carve-out for pre-fix configs treats a co-located project's token as "this worker's own". |
| D | `~/.laneconductor-auth.json` | `sync.mjs:950`, `getUserToken()` | Machine-level and user-scoped — **legitimately** shared; not a defect. |
| E | `collectors[0].token` | `sync.mjs:954`, `:866` | The project's inline token. |
| F | **The collector URL itself** | `sync.mjs:319`, `getCollectors()` | Not a token, but the same defect: a manager has no endpoint of its own. Started from a directory with no `.laneconductor.json`, `getMode()` returns `local-fs`, `upsertWorker()` returns immediately, and the manager **registers nowhere and heartbeats nowhere while appearing to run normally**. Fixing only the token would leave a manager that authenticates correctly to an endpoint it can only learn by borrowing. |
| G | `conductor/.sync.pid` | `sync.mjs:1232` | Written unconditionally on `workerNumber === 1` — a manager **overwrites the co-located project worker's pidfile**. (`bin/lc.mjs` correctly uses `~/.laneconductor/manager.pid` for its own bookkeeping; the worker process disagrees with it.) |
| H | `ensureScaffold()` | `sync.mjs:358-367` | A manager scaffolds `conductor/tracks/` + `tracks-metadata.json` into whatever directory it started in. |
| I | Config-reload watcher | `sync.mjs:2498-2511` | An edit to the co-located project's `.laneconductor.json` live-reassigns the **manager's** collectors and token mid-run. |

### Server-side defects found by the same audit

1. **`POST /worker/register`, manager branch (`ui/server/index.mjs:3455-3470`)
   returns a token it never persists.** It mints `randomUUID()` and passes it
   as the INSERT value, but `machine_token` is **absent from the
   `ON CONFLICT (hostname) WHERE type = 'manager' DO UPDATE SET` list**. On
   every re-registration after the first, the DB keeps the *old* token while
   the handler returns the *new* one. A manager that stores what it is handed
   back therefore stores a token that matches no row — `collectorAuth`'s
   lookup misses, and it silently degrades to anonymous (local, no
   `COLLECTOR_0_TOKEN`) or hard-401s (remote). The project branch does this
   correctly (`:3477-3482` SELECT-then-reuse, plus
   `machine_token = EXCLUDED.machine_token` in its DO UPDATE).
   **This is a hard blocker: manager-owned token storage cannot work until it
   is fixed.**

2. **`DELETE /worker` (`ui/server/index.mjs:3623`) still carries the exact
   F13 precedence bug.** It reads
   `req.worker_project_id || req.body.project_id`, and `removeWorker()`
   (`sync.mjs:1174`) sends `{ hostname, pid, worker_number }` with **no
   `project_id` at all**. A manager on a borrowed token therefore resolves to
   the project's id and its own graceful shutdown marks the **co-located
   project worker** offline (`project_id IS NOT DISTINCT FROM $1 AND
   hostname = $2 AND worker_number = $3` matches that worker exactly:
   same host, same `worker_number` 1). This is F13 with a different verb, and
   it is still live.

### Other token resolvers (audit result, no live risk)

- `conductor/collector-client.mjs:115` — a naive
  `env ?? machine_token ?? token` resolver with no per-worker store and no
  manager awareness. Its only importer is `conductor/agent-runtime.mjs`,
  which **nothing imports** — dead code. Decide explicitly (delete, or align
  with the real resolver) rather than leaving a second divergent copy.
- `conductor/remote-sync.mjs:29-49` — its own cwd-relative `.env`/config
  resolver. Not on any manager code path today; confirm and document.
- `scripts/merge-apis.js:34-52` — generated/bundled artifact mirroring the
  server's auth; follows whatever `ui/server/index.mjs` does.

## Solution

Give the manager its own credential storage in
`~/.laneconductor/manager-config.json` — the file that already holds
`projectsDir` — and make the manager code path read **only** from it,
never from the launch directory's `.env`, `.laneconductor.json`, or
per-worker token store.

## Requirements

- **REQ-1** — `manager-config.json` gains a `collectors` array with the same
  entry shape the project config uses (`url`, `machine_token`, optional
  `store_type`/`secret_name`, optional `enabled`), so the existing
  GCP-Secret-Manager resolution path works unchanged for a manager.
- **REQ-2** — The file holds a secret, so it is written with mode `0600`, and
  an existing file with looser permissions is tightened on write. Creation of
  `~/.laneconductor/` uses mode `0700`.
- **REQ-3** — Token acquisition: on start with a configured collector URL but
  no stored `machine_token`, the manager registers (anonymously, or with a
  bootstrap key from `--key`) and **persists the returned token** to
  `manager-config.json`.
- **REQ-4** — Token rotation: on a `401`/`404` from a heartbeat, the manager
  clears its stored token, re-registers, and persists the new one. This
  reuses the existing re-register-on-401 branch (`sync.mjs:1157-1160`);
  only the write target changes.
- **REQ-5** — `lc worker start --manager` accepts `--collector <url>` and
  `--key <key>`, persisting both to `manager-config.json` (same
  set-once-and-remember ergonomics `--projects-dir` already has, including
  the "from previous run" echo).
- **REQ-6** — In a manager process, token resolution reads **only**:
  manager-config collectors → `~/.laneconductor-auth.json` (item D, the one
  legitimately machine-level source). Sources A, B, C, and E are **not
  consulted at all** — not reordered, not deprioritized: not read.
- **REQ-7** — In a manager process, `getCollectors()` returns the
  manager-config collectors, never the launch directory's. A manager with no
  configured collector must **say so loudly at startup** and must not silently
  present as a healthy `local-fs` worker (defect F).
- **REQ-8** — A manager never reads or writes
  `conductor/.worker.tokens.json` (defect B). If a per-worker store is still
  used for a manager at all, its path is under `~/.laneconductor/`.
- **REQ-9** — A manager writes no pidfile into the launch directory
  (defect G) — `~/.laneconductor/manager.pid`, which `bin/lc.mjs` already
  owns, is the only manager pidfile.
- **REQ-10** — A manager does not run `ensureScaffold()` against its launch
  directory (defect H) and does not re-read the launch directory's
  `.laneconductor.json` on the config watcher (defect I).
- **REQ-11** — `POST /worker/register`'s manager branch persists the token it
  returns: SELECT-then-reuse an existing token, and include
  `machine_token = EXCLUDED.machine_token` in the DO UPDATE, matching the
  project branch.
- **REQ-12** — `DELETE /worker` applies the same explicit-body precedence
  F13 gave the heartbeat handler (`'project_id' in req.body`), and
  `removeWorker()` sends an explicit `project_id` (`null` for a manager).
- **REQ-13** — Backward compatibility: an existing
  `manager-config.json` containing only `projectsDir` keeps working — the
  manager registers and persists a token on first start under the new code.
  A manager started with no collector configured anywhere reports the
  misconfiguration (REQ-7) rather than crashing.
- **REQ-14** — The dead `conductor/agent-runtime.mjs` +
  `collector-client.mjs:resolveToken` divergent resolver is explicitly
  resolved (removed, or aligned), not left as a second copy that the next
  reader mistakes for live code.

## Acceptance Criteria

Each criterion below is an observable outcome, not a code shape.

- [ ] **AC-1** — A manager started from inside a real project directory that
      has a `.laneconductor.json` with `collectors[0].machine_token` set, an
      `.env` with `COLLECTOR_0_TOKEN`, and a populated
      `conductor/.worker.tokens.json`, authenticates its registration and
      heartbeats with **none of those three values**.
- [ ] **AC-2** — After that manager runs, the project's
      `conductor/.worker.tokens.json` is **byte-identical** to what it was
      before the manager started, and no `conductor/.sync.pid` in that
      directory points at the manager's pid.
- [ ] **AC-3** — Starting the project's own worker #1 in that same directory,
      before and after the manager runs, yields a worker that still
      authenticates as itself: its `machine_token` is unchanged and its DB row
      still carries its own pid, not the manager's.
- [ ] **AC-4** — A manager restarted three times in a row is, on the third
      start, still able to make an authenticated call that the server resolves
      to the manager's own worker row (the token it holds matches the row the
      DB has). Today this fails on the second start.
- [ ] **AC-5** — A manager's graceful shutdown (SIGTERM) leaves the
      co-located project worker's DB row `status` untouched.
- [ ] **AC-6** — A manager started from a directory with **no**
      `.laneconductor.json` and no configured collector prints an explicit
      "no collector configured — run `lc worker start --manager --collector
      <url>`" message and does not report itself as a running, healthy
      worker.
- [ ] **AC-7** — `lc worker start --manager --collector <url> --key <k>`
      followed by a plain `lc worker start --manager` uses the remembered
      collector and key, echoing them the way `--projects-dir` already does.
- [ ] **AC-8** — `~/.laneconductor/manager-config.json` is mode `0600` after
      a token is written to it.
- [ ] **AC-9** — The manager does not create `conductor/tracks/` or
      `conductor/tracks-metadata.json` in a launch directory that had none.

## Non-goals

- Multi-manager-per-host. The `workers_one_manager_per_host` partial unique
  index (`migrations/20260810140302_add_workers_type.sql`) stands.
- Changing `~/.laneconductor-auth.json`'s role. It stays a legitimate
  machine-level fallback (source D).
- Re-scoping the manager's *dispatch* behavior or `create-project` flow —
  1091's design is unchanged here; this track only fixes whose credentials
  and endpoint it uses to do that work.

## Data Model Changes

None in Postgres. One file-format extension, additive and backward
compatible:

```jsonc
// ~/.laneconductor/manager-config.json   (mode 0600)
{
  "projectsDir": "/home/meller/Projects",   // existing, unchanged
  "collectors": [                            // new
    {
      "url": "http://localhost:8091",
      "machine_token": "…",                  // written by REQ-3/REQ-4, never by hand
      "enabled": true,
      "store_type": "gcp-secret",            // optional, same semantics as project config
      "secret_name": "LC_MANAGER_KEY"
    }
  ],
  "bootstrap_key": "…"                       // new, optional — from `--key`, for
                                             // collectors that reject anonymous register
}
```
