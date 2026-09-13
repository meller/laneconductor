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
      D-1..D-7 cover packaging format, first-run, updates, licensing, telemetry, marketplace
      requirements, pricing, with none left unanswered.
- [x] TC-0.2: Each of REQ-1..REQ-12 names a real file and a behaviour observable in the
      current tree — expected: the cited paths and symbols exist and behave as described.
- [x] TC-0.3: `grep -rniE "license.key|entitlement" bin conductor ui/server` — expected: no
      license-gate machinery, confirming D-4's premise.
- [x] TC-0.4: `find . -iname "Dockerfile*" -o -iname "docker-compose*" -o -iname "*.bicep"`
      (excluding `node_modules`) — expected: nothing, confirming Phase 5 starts from zero.

### Phase 1: De-cloud and harden (REQ-1, REQ-2, REQ-3)
- [ ] TC-1.1 **[remote-host]**: with the proxy opt-in unset, issue `GET /api/projects` to the
      server via a non-localhost hostname — expected: served locally from this process; no
      outbound request to any vendor endpoint (assert on a network capture or an injected
      fetch spy, not on the response body alone, since a proxied response can look identical).
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

### Phase 2: Path portability (REQ-4, REQ-9)
- [ ] TC-2.1: generate the three systemd units against a prefix that is not
      `/home/meller/Code/laneconductor` — expected: `systemd-analyze verify` clean, and all
      three start, on a machine where that path does not exist.
- [ ] TC-2.2: with the agent CLI installed somewhere other than `~/.local/bin`, a worker
      dispatch spawns it successfully — expected: no `spawn claude ENOENT`.
- [ ] TC-2.3: back up an instance, restore it onto a second machine at the same project path
      convention — expected: projects and tracks resolve; no duplicate `projects.repo_path`
      rows and no orphaned tracks.

### Phase 3: Unattended provisioning and first run (REQ-5, REQ-6, REQ-7)
- [ ] TC-3.1: `lc setup --non-interactive --seed <complete seed>` with stdin closed —
      expected: exits 0, writes a valid `.laneconductor.json`, never blocks on a prompt.
- [ ] TC-3.2: same with a seed missing a required field — expected: non-zero exit naming the
      missing field. Must not fall back to prompting or to a default.
- [ ] TC-3.3: on a freshly provisioned instance, `grep -r` the image and running config for
      the string `postgres:postgres` and for the `.env.example` default — expected: absent;
      the generated DB credential is unique per instance.
- [ ] TC-3.4: port-scan a freshly booted instance — expected: 5432 is not reachable from
      outside the compose network.
- [ ] TC-3.5: boot with no agent CLI authenticated, then open the dashboard — expected: an
      unmistakable "no provider connected" state, and a queued track does **not** silently sit
      in `queue` looking like normal pending work.
- [ ] TC-3.6: an agent CLI that is installed but **not logged in** — expected: first-run
      verification reports it as unauthenticated. A `--version` check alone passes here, which
      is exactly the false pass this case exists to catch.
- [ ] TC-3.7: after connecting real credentials, a track runs plan → implement → review →
      quality-gate → done on a repo on that instance — expected: it reaches `done` and the
      resulting commit exists on that machine.

### Phase 4: Updates and migrations (REQ-8)
- [ ] TC-4.1: `lc update` on an instance with projects and tracks, from version N to N+1 —
      expected: new version reported by `lc --version` and the UI; every project and track
      still present; `atlas migrate status` clean.
- [ ] TC-4.2: `lc update` run twice — expected: the second run is a no-op, exits 0.
- [ ] TC-4.3: `lc update` with no outbound network — expected: fails with a clear diagnostic
      and leaves the running instance untouched, rather than half-migrating.
- [ ] TC-4.4: boot an image whose schema is older than its code — expected: migrations apply
      on start; the API serves normally afterwards.
- [ ] TC-4.5: `lc support-bundle` — expected: a local archive containing logs and versions,
      with DB passwords and API tokens redacted; nothing is transmitted.

### Phase 5: Image build (REQ-10)
- [ ] TC-5.1: build the image twice from the same git tag — expected: the same stamped
      version, and `lc --version` inside both reports that tag.
- [ ] TC-5.2: deploy the image into a clean cloud subscription and reach the dashboard —
      expected: reachable over the authenticated path from Phase 1, no SSH needed.
- [ ] TC-5.3: reboot a configured instance — expected: the whole stack (Postgres, API, UI,
      worker) returns on its own; no manual start.

### Phase 6: Listing (REQ-11, REQ-12)
- [ ] TC-6.1: `LICENSE` and third-party attributions are present in the deployed image.
- [ ] TC-6.2: the documented open ports match what the booted instance actually listens on.

## Acceptance Criteria
- [x] Phase 0 cases pass against the current tree.
- [ ] Every Phase 1–6 case above passes before the listing is submitted.
- [ ] No case was marked passing on the strength of a `localhost` run where it is marked
      **[remote-host]**.
- [ ] No regression in the existing suites (`ui` vitest, worker `node --test`, Playwright)
      from the Phase 1–4 changes, which touch shared server and CLI code paths used by the
      author's own dogfooded install.
