# Tests: Track AM-10098 — V1.5 Standalone VM / Managed-App packaging

> Phases 1–6 are deferred (see `plan.md`). Their cases below are written now so the eventual
> build has a target, but **only the Phase 0 cases are runnable today** — the rest describe
> behaviour that does not exist yet and must fail if run against the current tree.
>
> A recurring trap for this track specifically: several of these behaviours are only wrong
> when the instance is reached by a **non-localhost hostname**. Testing over
> `http://localhost:8091` passes while the shipped product is broken. Every case marked
> **[remote-host]** must be exercised through a hostname or IP that is not `localhost` /
> `127.0.0.1`.

## Test Commands

```bash
# Worker/server unit + integration suites (current repo)
cd ui && npx vitest run

# Worker E2E (spawns real processes — check for orphans afterwards)
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# Browser E2E
cd ui && npx playwright test
```

## Test Cases

### Phase 0: Decisions and prerequisite inventory (runnable now)
- [x] TC-0.1: Every open question in `index.md` maps to a decision in `spec.md` — expected:
      D-1..D-9 cover packaging format (Azure Managed App), first-run (zero-secrets form + manager setup),
      updates, licensing, telemetry, marketplace requirements, pricing, hub-readiness, and run ledger.
- [x] TC-0.2: Each of REQ-1..REQ-16 names a real file, behaviour, or roadmap gate observable in
      the project tree.
- [x] TC-0.3: `grep -rniE "license.key|entitlement" bin conductor ui/server` — expected: no
      license-gate machinery, confirming D-4's premise.
- [x] TC-0.4: `find . -iname "Dockerfile*" -o -iname "docker-compose*" -o -iname "*.bicep"`
      (excluding `node_modules`) — expected: nothing, confirming Phase 5 starts from zero.
- [x] TC-0.5: Verify roadmap tracks AM-10099, AM-10100, AM-10101 exist in `conductor/tracks/`
      and have matching execution order markers.

### Prerequisite Gate (Before Phase 1)
- [ ] TC-GATE.1: Inspect Track AM-10099 status — expected: `Lane: done, Lane Status: success`.
      Vitest and node:test suites are green; worker isolated sandboxes in place.
- [ ] TC-GATE.2: Inspect Track AM-10100 status — expected: `Lane: done, Lane Status: success`.
      `runs` ledger table and parser are completed and merged.

### Phase 1: De-cloud and harden (REQ-1, REQ-2, REQ-3)
- [ ] TC-1.1 **[remote-host]**: with the proxy opt-in unset, issue `GET /api/projects` to the
      server via a non-localhost hostname — expected: served locally from this process; no
      outbound request to any vendor endpoint.
- [ ] TC-1.2: with the proxy explicitly enabled, the same request still proxies — expected:
      the opt-in works, so the cloud deployment's behaviour is preserved rather than deleted.
- [ ] TC-1.3: start the API with no host override — expected: listening on loopback only;
      a connection to the machine's routable address is refused.
- [ ] TC-1.4: start the API bound to a routable interface with no auth mode configured —
      expected: it refuses to start, or serves `/api/*` as 401. It must not start open.
- [ ] TC-1.5: with local auth configured, `/api/*` without a credential — expected: 401; with
      a valid credential — expected: 200. No Firebase project involved in either.
- [ ] TC-1.6: request `/` from the API with no Vite process running — expected: the built UI
      is served, and its `/api` and `/auth` calls resolve against the same origin.

### Phase 2: Path portability, hub-readiness, and run ledger (REQ-4, REQ-9, REQ-14, REQ-15)
- [ ] TC-2.1: generate the three systemd units against a prefix that is not
      `/home/meller/Code/laneconductor` — expected: `systemd-analyze verify` clean, and all
      three start, on a machine where that path does not exist.
- [ ] TC-2.2: with the agent CLI installed somewhere other than `~/.local/bin`, a worker
      dispatch spawns it successfully — expected: no `spawn claude ENOENT`.
- [ ] TC-2.3: back up an instance, restore it onto a second machine at the same project path
      convention — expected: projects and tracks resolve; no duplicate `projects.repo_path`
      rows and no orphaned tracks.
- [ ] TC-2.4: enable `collectors` array with a test hub target — expected: standalone instance
      successfully connects to hub with config change only (no image rebuild).
- [ ] TC-2.5: execute a test track lane action — expected: row inserted into local `runs` table
      with `requested_by`, `executed_by`, `total_cost_usd`, and `duration_ms` populated.

### Phase 3: Bootstrap Secrets Form & Manager-driven Setup (REQ-5, REQ-6, REQ-7, REQ-16)
- [ ] TC-3.1: Submit initial admin password and Claude API key via first-run bootstrap web form —
      expected: written to `.env` / secret store; system moves to configured state.
- [ ] TC-3.2: **Zero-Secrets assertion:** inspect `conversation.md` files and DB `track_comments`
      after bootstrap — expected: submitted API keys and passwords are completely absent.
- [ ] TC-3.3: on a freshly provisioned instance, `grep -r` the image and running config for
      `postgres:postgres` — expected: absent; unique DB credential generated.
- [ ] TC-3.4: port-scan a freshly booted instance — expected: 5432 is not reachable externally.
- [ ] TC-3.5: boot with no agent CLI authenticated — expected: unmistakable "no provider connected"
      state in the UI.
- [ ] TC-3.6: an agent CLI that is installed but **not logged in** — expected: first-run
      verification reports it as unauthenticated. A `--version` check alone must not pass.
- [ ] TC-3.7: Manager agent onboarding: conversational `set-up-this-machine` collects a test repo
      and initializes it as a LaneConductor project.

### Phase 4: Updates and migrations (REQ-8)
- [ ] TC-4.1: `lc update` on an instance with projects, tracks, and runs ledger — expected:
      new version reported; all data preserved; `atlas migrate status` clean.
- [ ] TC-4.2: `lc update` run twice — expected: second run is a no-op, exits 0.
- [ ] TC-4.3: `lc update` with no outbound network — expected: fails with clear diagnostic,
      leaving running instance untouched.
- [ ] TC-4.4: boot an image whose schema is older than its code — expected: migrations apply
      on start; API serves normally.
- [ ] TC-4.5: `lc support-bundle` — expected: local archive with logs and sanitized configs;
      zero data transmitted outbound.

### Phase 5: Image build & Azure Managed Application (REQ-10, D-1)
- [ ] TC-5.1: build image twice from same git tag — expected: identical version stamp reported
      by `lc --version` and UI.
- [ ] TC-5.2: deploy Azure Managed Application ARM/Bicep template in a clean Azure subscription —
      expected: succeeds; VM boots and reaches bootstrap screen over HTTPS.
- [ ] TC-5.3: reboot configured VM — expected: entire stack returns automatically.

### Phase 6: Marketplace Listing & Certification (REQ-11, REQ-12, D-6)
- [ ] TC-6.1: `LICENSE` and third-party attributions are present in the deployed image.
- [ ] TC-6.2: documented open ports and 16GB RAM floor match deployed template specifications.
- [ ] TC-6.3: passes Azure Marketplace automated certification test kit.

## Acceptance Criteria
- [x] Phase 0 cases pass against current tree.
- [ ] Every Phase 1–6 case above passes before marketplace listing is published.
- [ ] No case was marked passing on the strength of a `localhost` run where it is marked **[remote-host]**.
- [ ] Zero-Secrets Policy is strictly validated on first-run flows.
