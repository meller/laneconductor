# Tests: Track 1118 — Manager Worker Credential Storage

## Test Commands

```bash
# New isolation suite (spawns real worker processes + mock collector, zero deps)
node --test conductor/tests/track-1118-manager-credential-isolation.test.mjs

# Regression: paths this track changes
node --test conductor/tests/per-worker-machine-token.test.mjs
node --test conductor/tests/track-1091-manager-worker.test.mjs
node --test conductor/tests/track-1089-provision-worker-dispatch.test.mjs

# Server endpoints (Vitest + supertest, mocked pg)
cd ui && npm test -- server/tests/track-1091-manager-registration.test.mjs
cd ui && npm test
```

## Test Fixture — "the decoy directory"

Every worker-level case below shares one fixture, because the bug is only
observable when a manager and a real project occupy the same directory.
Build a temp project containing **three distinct decoy tokens**, one per
borrowing source in spec.md's table, so a wrong resolution is identifiable
by *which* token arrives rather than just "some token arrived":

| File | Decoy value | Source |
|------|-------------|--------|
| `.env` → `COLLECTOR_0_TOKEN` | `decoy-env-token` | A |
| `conductor/.worker.tokens.json` → `{ "<url>": "decoy-store-token" }` | `decoy-store-token` | B |
| `.laneconductor.json` → `collectors[0].machine_token` | `decoy-config-token` | C |
| `.laneconductor.json` → `collectors[0].token` | `decoy-inline-token` | E |

`HOME` is redirected to a per-test `FAKE_HOME` (pattern:
`conductor/tests/track-1089-provision-worker-dispatch.test.mjs:81-90`) so
the real `~/.laneconductor/manager-config.json` is never read or written —
clobbering a developer's live manager config from a test run is not
acceptable.

The mock collector records the `Authorization` header of every request; the
assertions read from `/_state`.

## Test Cases

### Phase 1 — Server: manager registration token persistence
- [ ] TC-1.1: `POST /worker/register` with `type: 'manager'` twice for the
      same hostname — expected: both responses carry the **same**
      `machine_token`. (Fails today: the second returns a freshly minted
      UUID the DB never stored.)
- [ ] TC-1.2: The upsert's `DO UPDATE SET` includes `machine_token`, and the
      returned value comes from `RETURNING` — expected: response token and
      row token cannot diverge.
- [ ] TC-1.3: Regression — `type: 'project'` registration still returns
      400 without `project_id`, and still reuses an existing row's token.

### Phase 2 — `manager-config.json` store
- [ ] TC-2.1: `writeManagerConfig()` on a fresh `FAKE_HOME` — expected: file
      mode is `0600`, directory mode `0700`.
- [ ] TC-2.2: An existing `manager-config.json` at `0644` is tightened to
      `0600` on the next write — expected: mode `0600`, contents preserved.
- [ ] TC-2.3: A file containing only `{"projectsDir": "/x"}` is read without
      error — expected: `collectors` defaults to `[]`, `bootstrap_key` to
      `null`, `projectsDir` still `/x` (REQ-13 backward compatibility).
- [ ] TC-2.4: `setManagerToken(url, tok)` then `readManagerConfig()` —
      expected: token round-trips; a second call for a different url adds a
      second entry rather than replacing the first.
- [ ] TC-2.5: `clearManagerToken(url)` — expected: that entry's
      `machine_token` is removed, the `url` entry itself survives.

### Phase 3 — Manager resolves credentials only from its own store
- [ ] TC-3.1: Manager started in the decoy directory with a valid
      manager-config token — expected: the `Authorization` header on
      `/worker/register` and every `/worker/heartbeat` equals the
      manager-config token and matches **none** of the four decoys (AC-1).
- [ ] TC-3.2: Manager started in the decoy directory with **no** stored
      token — expected: it registers, and the token it subsequently
      heartbeats with is the one the collector issued, now persisted in
      `FAKE_HOME/.laneconductor/manager-config.json` (REQ-3).
- [ ] TC-3.3: Collector replies `401` to a heartbeat — expected: the manager
      clears the stored token, re-registers, persists the new one, and the
      next heartbeat carries the new value, not the stale one (REQ-4).
- [ ] TC-3.4: Manager started in a directory with **no** `.laneconductor.json`
      and no configured collector — expected: an explicit "no collector
      configured" message on stdout; the process does not report itself as a
      healthy running worker, and no `local-fs` silent-success path is taken
      (AC-6).
- [ ] TC-3.5: The decoy `.laneconductor.json` names a *different* collector
      url than manager-config — expected: traffic goes to the manager-config
      url only; the project's collector receives nothing (REQ-7).

### Phase 4 — A manager writes nothing into its launch directory
- [ ] TC-4.1: Record a hash of `conductor/.worker.tokens.json` before the
      manager starts; run the manager; re-hash — expected: byte-identical
      (AC-2, REQ-8).
- [ ] TC-4.2: After the manager runs — expected: no `conductor/.sync.pid` in
      the launch directory contains the manager's pid; if the file existed
      before, it is unchanged (AC-2, REQ-9).
- [ ] TC-4.3: Manager started in an empty directory — expected: no
      `conductor/tracks/` and no `conductor/tracks-metadata.json` created
      (AC-9, REQ-10).
- [ ] TC-4.4: Edit the co-located `.laneconductor.json`'s collector url while
      the manager is running — expected: the manager keeps sending to its own
      configured url (REQ-10, defect I).
- [ ] TC-4.5: Co-existence — start project worker #1 and a manager in the
      same directory; let both heartbeat several cycles — expected: two
      distinct DB rows, each holding its own token; the project worker's row
      never carries the manager's pid; neither token store is overwritten by
      the other process (AC-3). This is the direct regression for the F13
      pid-flapping incident.

### Phase 5 — Remaining borrowed-identity call sites
- [ ] TC-5.1: `DELETE /worker` with an explicit `project_id: null` in the
      body while `req.worker_project_id` resolves to `5` — expected: the
      update targets `project_id IS NULL`, leaving project 5's worker row's
      `status` untouched (REQ-12).
- [ ] TC-5.2: `DELETE /worker` with **no** `project_id` key in the body —
      expected: unchanged fallback to `req.worker_project_id` (the normal
      project-worker path must not regress).
- [ ] TC-5.3: End-to-end — SIGTERM the manager from TC-4.5 — expected: the
      project worker's DB row `status` is unchanged and its dispatch history
      is intact (AC-5).
- [ ] TC-5.4: `grep -rn "agent-runtime" --include="*.mjs" . | grep -v node_modules`
      returns no importer — expected: confirms the module is dead before it
      is deleted (REQ-14). Recorded as evidence in plan.md, not just run.

### Phase 6 — CLI
- [ ] TC-6.1: `lc worker start --manager --collector <url> --key <k>` —
      expected: both persisted to `manager-config.json` (mode `0600`).
- [ ] TC-6.2: A subsequent plain `lc worker start --manager` — expected:
      reuses the stored values and echoes a "from previous run" line, the
      same way `--projects-dir` already does (AC-7).
- [ ] TC-6.3: `--projects-dir` set in an earlier run still round-trips after
      the schema extension — expected: unchanged behavior (REQ-13).

## Acceptance Criteria

- [ ] All new test cases above pass.
- [ ] `conductor/tests/per-worker-machine-token.test.mjs`,
      `track-1091-manager-worker.test.mjs`, and
      `track-1089-provision-worker-dispatch.test.mjs` still pass — all three
      exercise code this track changes.
- [ ] `cd ui && npm test` passes in full (server + worker unit suites).
- [ ] TC-1.1, TC-3.1, TC-4.1, TC-4.5 and TC-5.1 are each confirmed to **fail
      against the pre-fix code** before the fix lands. A test that passes
      before the change proves nothing about this bug.
- [ ] No test reads or writes the real `~/.laneconductor/` — every case
      redirects `HOME`.
