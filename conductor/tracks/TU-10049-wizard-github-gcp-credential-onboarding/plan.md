# Track TU-10049: Wizard — GitHub + Jira + GCP Credential Onboarding

Phases are ordered so each one is independently verifiable and leaves the wizard working.
Phase 1 (registry) and Phase 2 (endpoint) have no UI surface; Phase 3 is the first phase a user
can see. Do not start a phase before the prior one's tests are green.

---

## Phase 1: Connector registry (shared, mirrored)

**Problem**: Three categories, one real provider each plus named disabled alternatives, need to
be described in one place that both the browser bundle and the standalone sync worker can read.
The worker runs via `node conductor/laneconductor.sync.mjs` and cannot import `ui/src`.

**Solution**: Follow the existing `ui/src/lib/deployConfig.js` ↔ `conductor/deployConfig.mjs`
mirroring convention exactly — same header comment warning that both copies must be edited
together.

- [x] Task 1.1: Create `ui/src/lib/connectors.js` with `CONNECTOR_CATEGORIES` (spec § API
      Contracts), covering all three categories, their real provider, their disabled
      alternatives, and a `skip` default.
    - [x] Include the `— FFU` label suffix as data, not as JSX, so both copies agree.
- [x] Task 1.2: Add `buildJiraCollector({ domain, email, projectKey, tokenEnv })` returning the
      **exact** `collectors[]` entry shape `lc add-target --type jira` writes (`bin/lc.mjs`
      ~L3092) — `{ type: 'jira', domain, email, project_key, token_env }`, `undefined` for
      unset optional keys.
- [x] Task 1.3: Add `connectionsStepValid()` returning `true` unconditionally (REQ-1), and
      `buildConnectionsPayload(state)` producing the `wizard.connections` block, emitting
      `{ provider: 'skip' }` for untouched categories.
- [x] Task 1.4: Mirror all of the above byte-for-byte into `conductor/connectors.mjs`.
- [x] Task 1.5: Unit tests — registry shape, `buildJiraCollector` output matches the CLI's shape,
      skip-emission, and a test asserting the two mirrored files are identical apart from the
      module header (guards the convention the way the codebase already relies on it).
      **13/13 pass** (TC-1..TC-7, plus one extra for the FFU-as-data guarantee).

**Impact**: New shared module. Nothing consumes it yet; no behavior change.

---

## Phase 2: Generalized credential-status endpoint

**Problem**: `GET /api/workers/:id/credentials` must answer for github/jira/gcp/firebase, while
`deploy-credentials` and its existing test keep working untouched.

**Solution**: One handler, two routes.

- [x] Task 2.1: Extract `checkGhAuth()` usage — import from `conductor/services/pr-flow.mjs`
      (already returns `{ok, error}` and never throws). Do not re-implement.
      **Deviation**: `checkGhAuth`'s return shape is relied on with strict `assert.deepEqual` in
      `conductor/tests/track-10018-pr-flow.test.mjs` — extending it with a `detail`/account field
      would break that test. Left untouched; the credentials endpoint reads only `{ok, error}`,
      so github's `verified` detail is `null` (no account name) rather than the account, unlike
      Jira/GCP. AC-3 satisfied for the verified/NOT-CONFIGURED distinction and remediation text;
      not for naming the account.
- [x] Task 2.2: Extract `jiraProjectExists()` out of `bin/lc.mjs` (L513) into a shared module
      (`conductor/services/jira-auth.mjs`) and re-import it in `lc.mjs` so there is exactly one
      copy. Include `resolveJiraToken()` (L563) — server-side token resolution from env var /
      GCP secret.
- [x] Task 2.3: Write the shared `checkCredentialProvider(provider, query)` handler covering all
      four providers, preserving the 10s timeouts.
    - [x] `jira` with an unset `token_env` → `NOT CONFIGURED`, detail names the missing var.
      Never echo a token value in `detail` or in an error.
- [x] Task 2.4: Mount `GET /api/workers/:id/credentials`; re-point
      `GET /api/workers/:id/deploy-credentials` at the same handler as a thin alias.
- [x] Task 2.5: Tests in `ui/server/tests/track-10049-credentials.test.mjs` — one per provider,
      verified + not-configured for each, 400 unknown provider, 404 unknown worker, and an
      explicit assertion that a token value never appears in any response body. **11/11 pass.**
- [x] Task 2.6: **Ran the existing `ui/server/tests/track-1119-deploy-credentials.test.mjs`
      unmodified — 6/6 still pass.** Also confirmed via `git stash` that 9 pre-existing failing
      server test files predate this change entirely (unrelated: `track-1116-model-override`
      etc. — `syncTrackToFile is not a function`).

**Impact**: `ui/server/index.mjs` (route), `bin/lc.mjs` (import instead of local definition), new
`conductor/services/jira-auth.mjs`. No UI change yet.

---

## Phase 3: ConnectionsStep component

**Problem**: The step must render three pickers, show per-connector credential status, and never
block Launch.

**Solution**: Model it directly on `DeploymentStep.jsx` — same `useEffect`/`cancelled` fetch
pattern, same three-state badge, same non-blocking posture.

- [x] Task 3.1: Create `ui/src/components/wizard/ConnectionsStep.jsx` rendering the three
      category pickers from `CONNECTOR_CATEGORIES`, alternatives rendered `disabled` + muted +
      `— FFU` (REQ-2).
- [x] Task 3.2: Conditional per-provider fields — Jira: domain / email / project key / token env
      var name (placeholder `JIRA_API_TOKEN`); GCP: project id + optional service-account email;
      GitHub: no fields, reads the Basics repo value (`repoUrl` prop, displayed read-only next to
      the picker once GitHub is selected — informational only, not sent anywhere new).
- [x] Task 3.3: Per-connector credential badge hitting `/api/workers/:id/credentials`, debounced
      (400ms) for the Jira text inputs so it doesn't fire per keystroke. Reuse the exact
      `checking`/`verified`/`NOT CONFIGURED` / "check unavailable" rendering from
      `DeploymentStep.jsx`, including `data-testid` naming.
- [x] Task 3.4: Remediation copy per connector — `gh auth login`, `gcloud auth login`, and for
      Jira the missing env var name plus a pointer to `lc add-target-mapping` for status mapping.
- [x] Task 3.5: Component tests — pickers render, alternatives are disabled and cannot be
      selected, badges reflect mocked API responses, and **no input value is ever sent to the
      credentials endpoint as a token** (REQ-3). **11/11 pass** (TC-18..25, plus TC-3.2 for the
      repo-value display).

**Impact**: New component, not yet mounted.

---

## Phase 4: Wire into the wizard + payload

**Problem**: The step must join `stepsForKind()` with the right kind-dependent shape, and its
answers must reach the dispatch payload without breaking legacy dispatches.

- [ ] Task 4.1: Add `connections` to `defaultWizardState()` (all categories `skip`).
- [ ] Task 4.2: Insert the step in `stepsForKind()` between Design & Stack and Deployment for
      `'app'`; for `'marketing'` insert an issue-tracker-only variant after Product (REQ-1/AC-7).
- [ ] Task 4.3: Extend `buildWizardPayload()` with `wizard.connections`; add the `stepProps`
      entry (needs `workerId`, same as Deployment).
- [ ] Task 4.4: Surface chosen connections in `ReviewLaunchStep.jsx`.
- [ ] Task 4.5: Update `ui/src/components/NewProjectModal.test.jsx` — the existing "walks all
      five steps" test now walks six; add cases for the marketing shape and for all-skipped
      producing `{provider:'skip'}` triples.
- [ ] Task 4.6: Confirm the Quick-create test still passes untouched (AC-8).

**Impact**: `AppCreatorWizard.jsx`, `ReviewLaunchStep.jsx`, wizard tests. User-visible from here.

---

## Phase 5: Worker-side artifact writing

**Problem**: A Jira selection must produce a working target in the created project, not just a
line in a payload.

- [ ] Task 5.1: In `runCreateProject` (`conductor/laneconductor.sync.mjs`, next to the
      `wizard.deployment` block ~L7015), read `entry.payload?.wizard?.connections`.
- [ ] Task 5.2: For `issue_tracker.provider === 'jira'`, append `buildJiraCollector(...)` to the
      `collectors[]` of the `.laneconductor.json` that function already writes (~L7063). Must
      run **after** that write, mirroring why the deployment block runs after scaffold-generate.
- [ ] Task 5.3: Append the Jira token env var name to the created project's `.env.example`
      (name only — REQ-3).
- [ ] Task 5.4: No-op cleanly when `connections` is absent (legacy dispatch) or every category
      is `skip`.
- [ ] Task 5.5: Tests in `conductor/tests/track-10049-connections-artifacts.test.mjs` — Jira
      entry written and matching the CLI shape, `.env.example` names the var and holds no value,
      legacy dispatch unchanged.

**Impact**: `conductor/laneconductor.sync.mjs`.

### Deferred — NOT part of this track's completion (spec § Out of Scope)

- [ ] **FFU**: working GitLab / Bitbucket / Azure DevOps source-control integration
- [ ] **FFU**: working Linear / Asana / GitHub Issues / Shortcut issue-tracker integration
- [ ] **FFU**: working AWS / Azure / Cloudflare cloud integration
- [ ] **FFU**: GitHub App installation + OAuth device flow (belongs with Track 1002)
- [ ] **FFU**: Jira OAuth 2.0 (3LO) as an alternative to API-token-by-reference

These stay unchecked permanently for this track. They are listed so the deferral is explicit and
so no future reader mistakes the disabled menu entries for shipped integrations. Per the skill's
done-gate, this track may still reach `done` at 100% — the *deliverable* is the disabled
signalling (AC-2), which is fully implemented; these are separate future capabilities, not
unfinished parts of this one.

---

## Phase 6: End-to-end verification

**Problem**: Unit tests cannot tell us the wizard actually works. AM-1119 already established an
e2e walk-through as the standard for this wizard.

- [ ] Task 6.1: Extend `ui/e2e/app-creator-wizard.spec.js` (or add
      `ui/e2e/track-10049-connections.spec.js`) for the six-step walk-through, asserting the
      dispatched payload contains the expected `wizard.connections` block.
- [ ] Task 6.2: E2E assertion that a disabled alternative cannot be selected (AC-2).
- [ ] Task 6.3: **Restart the API server and the sync worker before verifying** — neither
      hot-reloads; verifying Phase 2's route or Phase 5's writer against a process started before
      the change is a false pass (`quality-gate.md` calls this out explicitly).
- [ ] Task 6.4: Drive one real Launch with Jira configured against a scratch project directory
      and record the observed result: the created `.laneconductor.json`, and `lc list-targets`
      output in that project (AC-5).
- [ ] Task 6.5: Inspect the stored `worker_dispatch` row from that Launch and confirm no
      credential value is present (AC-6).

**Impact**: E2E specs. No production code.
