# Tests: Track TU-10049 — Wizard: GitHub + Jira + GCP Credential Onboarding

Drives the implementation order (TDD): for each phase, write the listed cases first, watch them
fail, then implement until green.

## Test Commands

```bash
# Vitest — UI components, shared libs, Express routes (Phases 1–4)
cd ui && npm test

# Single file while iterating
cd ui && npm test -- src/components/wizard/ConnectionsStep.test.jsx

# node:test — worker-side artifact writing (Phase 5)
node --test conductor/tests/track-10049-connections-artifacts.test.mjs
node --test conductor/tests/track-10049-connectors-mirror.test.mjs

# Playwright — real-browser wizard walk-through (Phase 6)
cd ui && npx playwright test e2e/track-10049-connections.spec.js

# Regression guard — must pass UNMODIFIED (Phase 2 alias)
cd ui && npm test -- server/tests/track-1119-deploy-credentials.test.mjs
```

## Test Cases

### Phase 1 — Connector registry (`ui/src/lib/connectors.js` + `conductor/connectors.mjs`)
- [ ] TC-1: `CONNECTOR_CATEGORIES` has exactly three categories (`source_control`,
      `issue_tracker`, `cloud`) — expected: each has one `real` provider and a non-empty
      `alternatives` array.
- [ ] TC-2: Every entry in `alternatives` is marked unavailable in the data itself — expected:
      no alternative is ever emitted as a selectable value.
- [ ] TC-3: `buildJiraCollector({domain,email,projectKey,tokenEnv})` output — expected: deep-equals
      `{ type:'jira', domain, email, project_key, token_env }`, matching the shape
      `lc add-target --type jira` writes at `bin/lc.mjs` ~L3092.
- [ ] TC-4: `buildJiraCollector` omits unset optionals — expected: no `token`/`token_secret_name`
      keys present rather than `undefined` values that would serialize into JSON.
- [ ] TC-5: `connectionsStepValid()` with empty/partial/complete state — expected: `true` in all
      three cases (the step never blocks Next).
- [ ] TC-6: `buildConnectionsPayload` on untouched state — expected: all three categories emit
      `{ provider: 'skip' }`.
- [ ] TC-7: Mirror integrity — expected: `ui/src/lib/connectors.js` and
      `conductor/connectors.mjs` are identical below their module header comments.

### Phase 2 — Credential endpoint (`ui/server/tests/track-10049-credentials.test.mjs`)
- [ ] TC-8: `?provider=github` with `gh auth status` succeeding (stubbed exec) — expected:
      `{status:'verified'}` with the account in `detail`.
- [ ] TC-9: `?provider=github` with `gh` unauthenticated — expected: `{status:'NOT CONFIGURED'}`,
      route returns 200 (not an error).
- [ ] TC-10: `?provider=jira` with valid domain/email/project key and the token env var set —
      expected: `{status:'verified'}`, `detail` names project + domain.
- [ ] TC-11: `?provider=jira` with a project key that 404s — expected: `NOT CONFIGURED`.
- [ ] TC-12: `?provider=jira` with `token_env` naming an **unset** variable — expected:
      `NOT CONFIGURED`, `detail` names the missing variable, and no network call is attempted.
- [ ] TC-13: `?provider=gcp` verified / not-configured via stubbed `gcloud auth list` — expected:
      unchanged behavior from today's `deploy-credentials`.
- [ ] TC-14: **Secret non-leakage** — with a token env var set to a known sentinel value, assert
      that sentinel appears nowhere in the response body of TC-10 *or* in an error response —
      expected: absent in every case (REQ-3, AC-6).
- [ ] TC-15: `?provider=bogus` — expected: 400. Unknown worker id — expected: 404.
- [ ] TC-16: 10s timeout is applied to each outbound check — expected: a hanging stub yields
      `NOT CONFIGURED`, never an unhandled rejection or a hung request.
- [ ] TC-17: **Alias regression** — the pre-existing `track-1119-deploy-credentials.test.mjs`
      passes with zero edits — expected: green (Phase 2 Task 2.6).

### Phase 3 — ConnectionsStep component (`ConnectionsStep.test.jsx`)
- [ ] TC-18: Renders three category pickers with GitHub / Jira / GCP selectable — expected: each
      also offers a "Skip" option, selected by default.
- [ ] TC-19: Alternatives render disabled with an `FFU` marker — expected: present in the DOM and
      carrying the `disabled` attribute.
- [ ] TC-20: Attempting to select a disabled alternative — expected: the category's selection is
      unchanged afterwards (AC-2); no error thrown, no silent state change.
- [ ] TC-21: Choosing Jira reveals domain/email/project-key/token-env-var fields — expected:
      token env var field defaults to `JIRA_API_TOKEN` and is labelled as a *variable name*.
- [ ] TC-22: Badge states with mocked fetch — expected: `checking…` → `✅ verified` for a
      verified response, `⚠️ NOT CONFIGURED` + remediation command for the other.
- [ ] TC-23: Failing/unreachable credential endpoint — expected: muted "Credential check
      unavailable" line, step still renders, Next still enabled (REQ-5).
- [ ] TC-24: Jira text inputs are debounced — expected: typing a 10-char domain issues far fewer
      than 10 credential requests.
- [ ] TC-25: No field value is ever sent as a token — expected: the outgoing request carries
      `token_env` (a name) and never a credential value (REQ-3).

### Phase 4 — Wizard wiring (`NewProjectModal.test.jsx`)
- [ ] TC-26: App-kind wizard now shows six steps with Connections between Design & Stack and
      Deployment — expected: stepper labels in that order.
- [ ] TC-27: Full walk-through dispatches `wizard.connections` with the entered Jira details —
      expected: payload matches the REQ-6 shape.
- [ ] TC-28: Every category left on skip — expected: payload emits three `{provider:'skip'}`
      entries and Launch succeeds.
- [ ] TC-29: Back from Connections to Design & Stack and forward again — expected: entered Jira
      values are preserved (matches the existing "Back preserves values" guarantee).
- [ ] TC-30: Marketing kind — expected: Connections shows the issue-tracker picker only, no
      source-control or cloud picker (AC-7).
- [ ] TC-31: Quick-create path — expected: unchanged, dispatches no `wizard` key at all (AC-8).

### Phase 5 — Worker artifacts (`track-10049-connections-artifacts.test.mjs`)
- [ ] TC-32: Dispatch with a Jira connection — expected: created `.laneconductor.json` contains a
      `collectors[]` entry deep-equal to `buildJiraCollector`'s output.
- [ ] TC-33: The Jira entry is *appended*, not replacing existing collectors — expected: the
      manager-derived collectors written at `laneconductor.sync.mjs` ~L7063 survive.
- [ ] TC-34: `.env.example` in the created project names the token variable — expected: contains
      `JIRA_API_TOKEN=` with an **empty** value.
- [ ] TC-35: No credential value anywhere in the created project tree — expected: a recursive
      grep for the sentinel token finds nothing (AC-6).
- [ ] TC-36: Legacy dispatch with no `connections` key — expected: created project byte-identical
      to pre-track behavior.
- [ ] TC-37: All-skip connections — expected: no `collectors[]` addition, no `.env.example` change.

### Phase 6 — End-to-end (Playwright)
- [ ] TC-38: Real-browser six-step walk-through → Launch — expected: intercepted dispatch payload
      contains the `wizard.connections` block (mirrors AM-1119's TC-15 pattern).
- [ ] TC-39: A disabled alternative cannot be selected in a real browser — expected: selection
      unchanged after the click (AC-2).
- [ ] TC-40: Manual real-product check with API server and sync worker **restarted first** —
      expected: a real Launch with Jira configured yields a project where `lc list-targets` lists
      the Jira target, recorded as observed output (AC-5).

## Acceptance Criteria

- [ ] All Vitest suites pass (`cd ui && npm test`), including the two pre-existing suites this
      track touches (`NewProjectModal.test.jsx`, `track-1119-deploy-credentials.test.mjs`)
- [ ] All node:test suites pass (`node --test conductor/tests/track-10049-*.test.mjs`)
- [ ] Playwright wizard specs pass (`npx playwright test`) — existing AM-1119 spec included, not
      just the new one
- [ ] TC-14, TC-25, TC-35 all green — no credential value reaches the payload, the DB, or disk
- [ ] Long-running processes (API server, sync worker) restarted before the Phase 6 checks
- [ ] No regressions in Quick create or in legacy (no-`connections`) dispatches
