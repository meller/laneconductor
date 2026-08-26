# Track 1118: Manager worker needs its own credential storage

Phases are ordered by dependency. Phase 1 is a hard blocker for Phases 3–4:
a manager cannot hold a stable token until the server stops handing back
tokens it never persists.

Mapping to the four phases originally filed in `index.md`:
Phase 1 + 2 = filed Phase 1 (design storage/rotation & how a manager obtains
a token) · Phase 3 = filed Phase 2 (`resolveCollectorToken`) · Phase 4 + 5 =
filed Phase 3 (audit every other borrowing call site) · Phase 6 = filed
Phase 4 (regression test).

---

## Phase 1: Server — a manager's registration token must actually persist

**Problem**: `POST /worker/register`'s manager branch
(`ui/server/index.mjs:3455-3470`) mints `randomUUID()` and returns it, but
`machine_token` is missing from the `ON CONFLICT (hostname) WHERE type =
'manager' DO UPDATE SET` list. Every re-registration returns a token the DB
does not have. Any manager that stores what it is handed back stores a dead
credential — so this must be fixed before manager-owned storage means
anything.

**Solution**: Mirror the project branch's already-correct approach
(`:3477-3482`) — SELECT the existing token for this hostname's manager row
and reuse it, and add `machine_token = EXCLUDED.machine_token` to the DO
UPDATE so the insert path and update path agree.

- [ ] Task 1.1: In the `type === 'manager'` branch, `SELECT machine_token
      FROM workers WHERE hostname = $1 AND type = 'manager'` before the
      upsert; reuse it if found, mint `randomUUID()` only when absent.
- [ ] Task 1.2: Add `machine_token = EXCLUDED.machine_token` to the manager
      branch's `DO UPDATE SET`.
- [ ] Task 1.3: Return the token that is actually in the row (the SELECTed
      one, or the freshly minted one) — add `RETURNING id, machine_token`
      and return the DB's value rather than the local variable, so the two
      cannot silently diverge again.
- [ ] Task 1.4: Extend `ui/server/tests/track-1091-manager-registration.test.mjs`
      with a re-registration case asserting the second response's
      `machine_token` equals the first's.

**Impact**: A restarted manager keeps one stable identity. Fixes AC-4.
Behavior for `type: 'project'` workers is untouched.

---

## Phase 2: `manager-config.json` becomes the manager's credential store

**Problem**: `manager-config.json` holds only `projectsDir`, read by two
independent one-off parsers (`bin/lc.mjs:250-260`,
`sync.mjs:readManagerProjectsDir()` at `:5742`). There is nowhere to put a
token, and the file is written world-readable.

**Solution**: One shared module owning the file's read/write/permissions,
imported by both `bin/lc.mjs` and `laneconductor.sync.mjs`, replacing both
ad-hoc parsers so they cannot drift.

- [ ] Task 2.1: New `conductor/manager-identity.mjs` exporting
      `readManagerConfig()`, `writeManagerConfig(cfg)`,
      `getManagerCollectors()`, `setManagerToken(url, token)`,
      `clearManagerToken(url)`. Path: `~/.laneconductor/manager-config.json`.
- [ ] Task 2.2: Write with mode `0600`; `chmod` an existing looser file on
      write; create `~/.laneconductor/` with mode `0700` (REQ-2).
- [ ] Task 2.3: Support the `collectors` array and `bootstrap_key` fields
      from spec.md's Data Model Changes, defaulting to `[]`/`null` so a
      `projectsDir`-only file keeps working verbatim (REQ-1, REQ-13).
- [ ] Task 2.4: Repoint `bin/lc.mjs`'s `readManagerConfig`/`writeManagerConfig`
      and `sync.mjs`'s `readManagerProjectsDir()` at this module; delete the
      duplicated parsers.
- [ ] Task 2.5: `lc worker start --manager` accepts `--collector <url>` and
      `--key <key>`, persisting each and echoing a "from previous run" line
      when reusing a stored value — same ergonomics as `--projects-dir`
      (`bin/lc.mjs:1617-1626`). Update the help text at `:642-643` (REQ-5).

**Impact**: One owner for the manager's own config, holding a secret at the
right permissions. No behavior change yet — Phase 3 consumes it.

---

## Phase 3: Manager token/collector resolution reads only its own store

**Problem**: spec.md's table A–F. `resolveCollectorToken(idx)` (`:906`) and
`resolveToken(collector, envKey)` (`:827`) walk the launch directory's
`.env`, per-worker token store, and `.laneconductor.json`. `getCollectors()`
(`:319`) returns the launch directory's endpoints, so a manager started
outside a project degrades silently to `local-fs` and registers nowhere.

**Solution**: A manager-specific resolution path, chosen on `isManager` —
not a reordering of the existing chain, an early branch that never touches
sources A/B/C/E at all (REQ-6).

- [ ] Task 3.1: `getCollectors()` returns manager-config collectors when
      `isManager`, with the same `enabled !== false` filter (REQ-7).
- [ ] Task 3.2: `getMode()`/`getIsLocalFs()` must not report a manager with
      no configured collector as a healthy `local-fs` worker. Print the
      explicit "no collector configured — run `lc worker start --manager
      --collector <url>`" message at startup (REQ-7, AC-6).
- [ ] Task 3.3: In `resolveCollectorToken` and `resolveToken`, branch on
      `isManager` before source A: manager-config `machine_token` for that
      url → `store_type: gcp-secret` resolution (reuse the existing
      `execSync` block, do not duplicate it) → `bootstrap_key` →
      `getUserToken()` (source D). Nothing else.
- [ ] Task 3.4: `upsertWorker()` persists the returned token via
      `setManagerToken(url, res.machine_token)` instead of
      `rememberOwnMachineToken()` when `isManager` (REQ-3).
- [ ] Task 3.5: Rotation — in the heartbeat's existing `401`/`404` branch
      (`:1157-1160`), a manager calls `clearManagerToken(url)` before
      re-registering, so the stale credential is not re-read on the retry
      (REQ-4).
- [ ] Task 3.6: Verify by running it: start a manager inside a project whose
      `.env`, `.laneconductor.json`, and `.worker.tokens.json` all carry
      distinct decoy tokens, and confirm from the collector side which token
      actually arrived on the wire. Do not infer this from reading the diff.

**Impact**: AC-1, AC-6. The originally filed defect (C) closes here, along
with the higher-precedence A/B/E that would have masked a C-only fix.

---

## Phase 4: A manager writes nothing into its launch directory

**Problem**: spec.md's defects B, G, H, I. Independently of tokens, a
manager currently shares the project worker #1's token-store file and
pidfile, scaffolds `conductor/` into wherever it started, and live-reloads
the project's config into its own runtime state.

**Solution**: Make each of these four artifacts manager-aware, the same way
the worker lock (`:203-209`) and log path already are.

- [ ] Task 4.1: `workerTokenStorePath` (`:797`) — for a manager, either skip
      the per-worker store entirely (manager-config is now its store) or
      point it under `~/.laneconductor/`. Never `./conductor/` (REQ-8, AC-2).
- [ ] Task 4.2: `loadOwnMachineTokens()` / `rememberOwnMachineToken()` must
      not read or write the project's file in a manager process — the read
      at `:824` runs at import time, before any manager check today.
- [ ] Task 4.3: The unconditional `conductor/.sync.pid` write (`:1232`) is
      skipped for a manager; `~/.laneconductor/manager.pid` (already written
      by `bin/lc.mjs`) stays the only manager pidfile (REQ-9, AC-2).
- [ ] Task 4.4: `ensureScaffold()` (`:367`) is skipped for a manager
      (REQ-10, AC-9).
- [ ] Task 4.5: The `.laneconductor.json` config-reload watcher
      (`:2498-2511`) does not reassign a manager's collectors/token (REQ-10).
- [ ] Task 4.6: Check the chokidar watch roots and the 60s
      reconcile/doc-sync/git-sync intervals for the same class of defect — a
      manager watching and syncing the co-located project's `conductor/tracks/`
      duplicates the project worker's own sync. Fix or document each with a
      reason; do not leave any unexamined.

**Impact**: AC-2, AC-3, AC-9. Removes the mutual-clobbering (B) that is
strictly worse than the filed bug, since it corrupts the project worker's
credentials too.

---

## Phase 5: Close the remaining borrowed-identity call sites

**Problem**: F13 fixed `PATCH /worker/heartbeat`'s precedence. The identical
bug is still live in `DELETE /worker`, and two divergent token resolvers
exist elsewhere in the tree.

**Solution**: Apply F13's fix to the second verb, and resolve the duplicate
resolvers explicitly.

- [ ] Task 5.1: `DELETE /worker` (`ui/server/index.mjs:3623`) — replace
      `req.worker_project_id || req.body.project_id` with the same
      `'project_id' in req.body` explicit-body precedence the heartbeat
      handler uses, carrying over F13's comment rationale (REQ-12).
- [ ] Task 5.2: `removeWorker()` (`sync.mjs:1166-1180`) sends an explicit
      `project_id` — `null` for a manager, `proj.id` otherwise — mirroring
      `updateWorkerHeartbeat`'s body at `:1133` (REQ-12, AC-5).
- [ ] Task 5.3: Resolve `conductor/agent-runtime.mjs` +
      `conductor/collector-client.mjs:115`'s divergent `resolveToken`. Nothing
      imports `agent-runtime.mjs`; confirm that with a fresh grep, then delete
      both the dead module and the divergent resolver, or align the resolver
      and document why the module stays (REQ-14).
- [ ] Task 5.4: Confirm `conductor/remote-sync.mjs:29-49`'s independent
      cwd-relative resolver is unreachable from any manager code path;
      document the finding in this file either way.
- [ ] Task 5.5: Sweep for any remaining site that derives manager identity
      from `getProject()`/`config.project` — record each hit with a verdict,
      so this audit is reproducible rather than a one-time read-through.

**Impact**: AC-5. Closes the class F13 patched at one site, rather than
waiting for the next variant to surface in production.

---

## Phase 6: Regression tests

**Problem**: The defect is only observable when a manager and a project
worker share a directory — no existing test constructs that pairing. Note
that `conductor/tests/mock-collector.mjs:88-101` mints a fresh token and
pushes a new row per registration, so it does **not** model the real
server's ON CONFLICT upsert: Phase 1's defect is invisible to it and needs a
server-side test.

**Solution**: Split by layer, matching this repo's existing conventions —
`node:test` + mock-collector for spawned-worker behavior, Vitest +
supertest + mocked `pg` for endpoint behavior.

- [ ] Task 6.1: `conductor/tests/track-1118-manager-credential-isolation.test.mjs`
      (`node:test`) — the decoy fixture from Task 3.6, built on the
      `FAKE_HOME` pattern in
      `conductor/tests/track-1089-provision-worker-dispatch.test.mjs:81-90`
      so the real `~/.laneconductor/` is never touched. Covers AC-1, AC-2,
      AC-6, AC-8, AC-9.
- [ ] Task 6.2: A co-existence case in the same file: project worker #1 and a
      manager live in one directory simultaneously; assert each keeps its own
      token and its own DB row (AC-3).
- [ ] Task 6.3: Server-side cases in `ui/server/tests/` — manager
      re-registration token stability (AC-4, folded into Task 1.4) and
      `DELETE /worker` not touching the project worker's row (AC-5).
- [ ] Task 6.4: `bin/lc.mjs` CLI case for `--collector`/`--key` persistence
      and the "from previous run" echo (AC-7).
- [ ] Task 6.5: Run the full existing suite, not just the new file —
      `conductor/tests/per-worker-machine-token.test.mjs`,
      `track-1091-manager-worker.test.mjs`, and
      `track-1089-provision-worker-dispatch.test.mjs` all exercise paths this
      track changes.

**Impact**: The bug becomes reproducible in CI, and the four F13-class
regressions cannot come back silently.
