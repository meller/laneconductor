# Spec: Wizard — GitHub + Jira + GCP Credential Onboarding

## Problem Statement

The App Creator wizard (`ui/src/components/wizard/AppCreatorWizard.jsx`, Track AM-1119) walks a
user from project name to Launch, but the only external system it ever asks about is the
**deploy** provider. Everything else a real project needs to be connected to — the GitHub repo it
lives in, the issue tracker it reports to, the cloud project it bills against — is configured
afterwards, by hand, in three different places: `gh auth login` in a terminal, `lc add-target
--type jira ...` in a terminal, `gcloud auth login` in a terminal.

The result is a wizard that *looks* like onboarding but leaves the user at a project that isn't
connected to anything. A solo founder finishing the wizard has no idea which of those three
connections are live and which are missing until something fails later, in a worker log.

This track adds a **Connections** step to the wizard that makes all three connections visible,
checkable, and configurable at creation time — and, for the categories where LaneConductor only
supports one provider today, makes the roadmap legible instead of pretending the choice doesn't
exist.

## Existing Machinery (READ THIS BEFORE PLANNING PHASES)

The track's original scope note claimed "no existing Jira integration exists anywhere in the
codebase (verified via grep)". That is **wrong**, and building on it would have produced a
duplicate Jira client. What actually ships today:

| Concern | Where it already lives | Reuse verdict |
|---|---|---|
| Jira config shape in `.laneconductor.json` | `collectors[]` entry `{ type: 'jira', domain, email, project_key, token_env \| token_store_type + token_secret_name }` — written by `lc add-target --type jira` (`bin/lc.mjs` ~L3023–3125) | **Reuse the exact shape.** The wizard writes the same entry; it must not invent a parallel one. |
| Jira credential validation | `jiraProjectExists(domain, email, token, projectKey)` — `bin/lc.mjs` L513 (`GET /rest/api/3/project/:key`, 10s timeout, returns bool) | **Extract and reuse** — do not re-implement. |
| Jira lane→status mapping | `lc add-target-mapping`, `validateJiraStatusesInCli()` — `bin/lc.mjs` L577 | Out of scope here; wizard links to it. |
| Jira polling/sync | `conductor/jira-collector.mjs` (782 lines: `readJiraConfig`, `pollJira`) | Untouched. Wizard only produces the config it reads. |
| Jira issue adapter (cloud) | `cloud/functions/src/adapters/jira.js` | Untouched. |
| Jira done-lane hook | `conductor/workflow.json` → `lanes.done.hooks[0]` | Untouched. |
| GitHub auth check | `checkGhAuth({ cwd, exec })` — `conductor/services/pr-flow.mjs` L22, wraps `gh auth status`, never throws | **Extract and reuse.** |
| GCP auth check | `gcloud auth list --format=value(account) --filter=status=ACTIVE` — inline in `ui/server/index.mjs` L4750 | **Generalize** (see REQ-4). |
| Credential-status UI pattern | `DeploymentStep.jsx` L20–95: `useEffect` → fetch → `checking`/`verified`/`NOT CONFIGURED` badge, **non-blocking** | **This is the template for all three connectors.** |
| Credential-status endpoint | `GET /api/workers/:id/deploy-credentials?provider=firebase\|gcp` — `ui/server/index.mjs` L4738 | Generalize to a shared handler (REQ-4). |
| Registry mirroring convention | `ui/src/lib/deployConfig.js` ↔ `conductor/deployConfig.mjs`, kept byte-identical because the worker runs standalone and can't import `ui/src` | **New connector registry MUST follow this convention.** |

## Requirements

### REQ-1 — A "Connections" step in the wizard
Insert a `Connections` step into `stepsForKind()` (`AppCreatorWizard.jsx` L20) between
`Design & Stack` and `Deployment` for `kind: 'app'`.

For `kind: 'marketing'`, the step appears but renders **only the issue-tracker picker** — a
no-code marketing project has no repo to connect and no cloud project to bill, and AM-1121
already established that asking those questions of a marketing project is a bug, not a feature.
Source-control and cloud pickers are omitted entirely (not shown-and-disabled) for that kind.

The step is **never required to advance**: `connectionsStepValid()` returns `true`
unconditionally. Skipping every connection is a first-class outcome.

### REQ-2 — Three provider categories, one real provider each
The step renders three category pickers, each a `<select>` (or equivalent) listing its real
provider plus its named, disabled alternatives:

| Category | Real (selectable) | Disabled alternatives, labelled "FFU" |
|---|---|---|
| Source control | GitHub | GitLab, Bitbucket, Azure DevOps |
| Issue tracker | Jira | Linear, Asana, GitHub Issues, Shortcut |
| Cloud | GCP | AWS, Azure, Cloudflare |

Each category also carries a "Skip — configure later" option, which is the **default**.

The alternatives are roadmap signalling, not functionality. They must be *visibly present and
clearly unavailable*: rendered with `disabled`, a muted style, and a `— FFU` suffix, so a
selection is impossible rather than silently ignored. A category picker must never enter a state
where a disabled provider appears chosen.

### REQ-3 — Secrets are referenced, never captured
**No credential value ever enters the wizard state, the dispatch payload, the `worker_dispatch`
row, or Postgres.** This is non-negotiable and follows the repo's existing Zero-Secrets Policy
(`.gitignore` already covers `.env`, `conductor/.env`; `buildEnvExample()` emits *names* only).

Per connector, the wizard collects:

- **GitHub**: nothing secret. It reads the repo URL already entered on the Basics step and shows
  the `gh auth status` result. Remediation copy: `gh auth login`.
- **Jira**: `domain`, `email`, `project_key`, and the **name of the env var** holding the API
  token (`token_env`, defaulting to `JIRA_API_TOKEN`) — or, alternatively, a GCP Secret Manager
  secret name (`token_store_type: 'gcp-secret'` + `token_secret_name`). Never the token itself.
- **GCP**: `project_id` and optionally a service-account email. Auth itself stays delegated to
  Application Default Credentials on the worker machine. Remediation copy: `gcloud auth login`.

### REQ-4 — One generalized credential-status endpoint
Replace the firebase/gcp-only `GET /api/workers/:id/deploy-credentials` with a shared
implementation covering `github`, `jira`, `gcp`, `firebase`.

- Route: `GET /api/workers/:id/credentials?provider=<id>[&domain=&email=&project_key=&token_env=]`
- Response shape is unchanged from today: `{ provider, status: 'verified'|'NOT CONFIGURED', detail }`
- `deploy-credentials` is **kept as a thin alias** delegating to the same handler, so
  `DeploymentStep.jsx` and `ui/server/tests/track-1119-deploy-credentials.test.mjs` keep passing
  unmodified. Removing it is out of scope.
- Checks: `github` → `checkGhAuth()`; `gcp`/`firebase` → today's `gcloud`/`firebase` spawns;
  `jira` → `jiraProjectExists()` using a token resolved **server-side** from the named env var /
  GCP secret. If the env var is unset, the answer is `NOT CONFIGURED` with a detail naming the
  missing variable — not an error, and never an echo of the value.
- Every check keeps the existing 10s timeout and never throws past the route.

### REQ-5 — Non-blocking status, exactly like Deployment
Each configured connector shows `checking…` / `✅ verified (<detail>)` / `⚠️ NOT CONFIGURED —
<remediation command>`. **Launch is never gated on any of it** (same rationale as AM-1119's
TC-5: credentials get fixed on the worker machine after Launch, before the work runs). A failed
or unreachable check degrades to a muted "Credential check unavailable: <reason>" line.

### REQ-6 — Payload and persisted artifacts
`buildWizardPayload()` gains a `wizard.connections` block:

```json
{ "source_control": { "provider": "github" },
  "issue_tracker":  { "provider": "jira", "domain": "acme.atlassian.net",
                      "email": "me@acme.com", "project_key": "ACME", "token_env": "JIRA_API_TOKEN" },
  "cloud":          { "provider": "gcp", "project_id": "acme-prod", "service_account": null } }
```

Categories left on "skip" are emitted as `{ "provider": "skip" }`. Marketing dispatches emit only
`issue_tracker`.

In `runCreateProject` (`conductor/laneconductor.sync.mjs`, alongside the existing
`wizard.deployment` handling at L7015): a `jira` issue-tracker selection appends the
`collectors[]` entry described in Existing Machinery to the new project's `.laneconductor.json`
— the same file that function already writes at L7063 — and appends the Jira token env var name
to `.env.example`. GCP/GitHub selections write no new file beyond what already exists; they are
recorded in the dispatch and surfaced in `ReviewLaunchStep`.

Legacy dispatches with no `wizard.connections` key must behave exactly as today.

## Out of Scope / Explicitly Not Claimed

These are **not** deliverables of this track and must not appear as satisfiable acceptance
criteria:

- Any working GitLab, Bitbucket, Azure DevOps, Linear, Asana, GitHub Issues, Shortcut, AWS,
  Azure, or Cloudflare integration. This track ships the *disabled menu entries only*. The
  deliverable is the signalling; the integrations remain unbuilt (see Phase 5's unchecked
  deferral in `plan.md`).
- GitHub App installation flow / OAuth device flow. GitHub connection status is `gh auth status`
  only. A real App-install flow belongs with the cloud OAuth work (Track 1002).
- Jira OAuth 2.0 (3LO). API-token-by-env-var-reference is the supported path, matching what
  `lc add-target --type jira` already does.
- Jira lane→status mapping configuration (`lc add-target-mapping`) — the wizard links to it.
- Rotating, storing, or validating any secret value.

**Note for the quality gate**: this track deliberately introduces the literal strings `FFU` and
`disabled` into a connector registry as *user-facing product copy* (REQ-2). The quality-gate
stub-scan (step 2b) greps for `FFU`. Those hits are expected and correct — they are the feature,
not a stub. Hits anywhere *other than* the connector registry's alternatives list remain
failures.

## Acceptance Criteria

Each criterion describes something a user can observe.

- [ ] AC-1: A user running the guided wizard on a software app sees a **Connections** step
      between "Design & Stack" and "Deployment", and can reach Launch without filling in any of
      it.
- [ ] AC-2: In each of the three category pickers, the named alternatives are visible and
      cannot be selected — attempting to pick one leaves the selection unchanged, and each is
      visibly marked unavailable rather than silently inert.
- [ ] AC-3: With `gh` authenticated, the source-control picker set to GitHub shows a green
      verified badge; with `gh` logged out it shows an amber `NOT CONFIGURED` badge telling the
      user to run `gh auth login` — and Launch still works in both cases.
      **Revised during Phase 2 implement**: does not name the account. `checkGhAuth()`
      (`conductor/services/pr-flow.mjs`) returns only `{ok, error}`, and its shape is asserted
      with strict `assert.deepEqual` in `conductor/tests/track-10018-pr-flow.test.mjs` — adding a
      detail/account field would have broken that pre-existing test for the sake of one extra
      badge string. Verified/NOT-CONFIGURED distinction and remediation copy are unaffected.
- [ ] AC-4: Entering a real Jira domain/email/project key plus the name of an env var that holds
      a valid token shows a verified badge for that Jira project; a wrong project key or an unset
      env var shows `NOT CONFIGURED` naming the specific problem.
- [ ] AC-5: Launching with Jira configured produces a new project whose `.laneconductor.json`
      contains a `collectors[]` entry that `lc list-targets` lists as a Jira target, and whose
      `.env.example` names the token variable. Running `lc list-targets` in the created project
      shows it without any further manual step.
- [ ] AC-6: No credential value appears in the dispatch payload, the `worker_dispatch` row, or
      any file written into the created project — verified by inspecting the stored dispatch
      after a Launch with Jira configured.
- [ ] AC-7: A marketing-kind project shows the Connections step with the issue-tracker picker
      only — no source-control or cloud picker.
- [ ] AC-8: A Quick-create (legacy) dispatch, and a wizard dispatch with every category skipped,
      both produce exactly the same created project as before this track.

## API Contracts / Data Models

**`GET /api/workers/:id/credentials`**

Query: `provider` (required: `github|jira|gcp|firebase`); for `jira` additionally `domain`,
`email`, `project_key`, `token_env`.

```json
{ "provider": "jira", "status": "verified", "detail": "ACME @ acme.atlassian.net" }
{ "provider": "github", "status": "NOT CONFIGURED", "detail": "gh: not logged in" }
```
`400` on unknown provider, `404` on unknown worker, `500` never leaks a token.

**New registry** — `ui/src/lib/connectors.js`, mirrored byte-for-byte to
`conductor/connectors.mjs` (same convention and comment header as `deployConfig.js` ↔
`deployConfig.mjs`):

```js
export const CONNECTOR_CATEGORIES = [
  { id: 'source_control', label: 'Source control',
    real: { value: 'github', label: 'GitHub' },
    alternatives: [{ value: 'gitlab', label: 'GitLab' }, /* … */] },
  // issue_tracker, cloud
];
export function buildJiraCollector({ domain, email, projectKey, tokenEnv }) { /* … */ }
export function connectionsStepValid() { return true; }
```

No database migration. `worker_dispatch.payload` is already JSONB.
