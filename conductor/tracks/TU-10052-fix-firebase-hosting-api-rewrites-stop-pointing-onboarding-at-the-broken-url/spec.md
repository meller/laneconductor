# Spec: Fix Firebase Hosting API rewrites; stop pointing onboarding at the broken URL

## Problem Statement

`firebase.json`'s hosting rewrites are written as `/api**`, `/track**`, `/worker**`
(prefix glued directly to `**`). **That pattern does not match across a `/`.** In
Firebase Hosting's glob dialect, `**` is only a cross-segment globstar when it is a
*whole* path segment (`/api/**`); glued to a prefix it degrades to single-`*`
semantics and matches within one segment only.

The result: every multi-segment API path falls through to the SPA catch-all
(`{ "source": "**", "destination": "/index.html" }`) and returns **HTTP 200 with
`text/html`** — the React app's `index.html` — instead of reaching the `api`
function. A caller gets a success status code and a document that looks nothing
like the API contract.

### Live reproduction (2026-09-03, against production)

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://app.laneconductor.com/<path>
```

| Path | Result | Interpretation |
|------|--------|----------------|
| `/health` | `200 application/json` | ✅ rewrite matched (`**` matched empty within the segment) |
| `/healthzzz` | `404 text/html` — body `Cannot GET /healthzzz` | ✅ rewrite matched; **Express** 404 (function was reached) |
| `/api` | `404 text/html` — body `Cannot GET /api` | ✅ rewrite matched; Express 404 |
| `/apifoo` | `404 text/html` — body `Cannot GET /apifoo` | ✅ rewrite matched (proves `**` behaves as `*`) |
| `/api/health` | `200 text/html` — body is `<!doctype html>` SPA | ❌ **rewrite missed** → SPA fallback |
| `/health/foo` | `200 text/html` — SPA | ❌ rewrite missed |
| `/v1/projects` | `200 text/html` — SPA | ❌ rewrite missed |
| `/tracks/1` | `200 text/html` — SPA | ❌ rewrite missed |
| `/workers/foo` | `200 text/html` — SPA | ❌ rewrite missed |

The `Cannot GET /apifoo` body is the decisive evidence: `/api**` matched a path
that shares no `/` boundary with the prefix, while `/api/health` did not. That is
single-segment `*` behaviour, not globstar behaviour.

Identical behaviour confirmed on **both** hosting targets — `app.laneconductor.com`
(target `app`) and `laneconductor.com` (target `landing`) — and on the raw
`laneconductor-app.web.app`. Both targets carry the same defective rewrite list.

### The function itself is healthy — this is purely a Hosting-layer bug

Probing the Cloud Run URL behind the function directly
(`https://us-central1-laneconductor-site.cloudfunctions.net/api`):

| Path | Result |
|------|--------|
| `/health` | `200 application/json` |
| `/tracks/running` | `401 application/json` (auth rejection — route reached) |

Multi-segment routing works perfectly when Hosting is bypassed. No change to
`cloud/functions/index.js` routing is required to fix this bug.

### Blast radius: 24 of the worker's 27 endpoints are unreachable

Every collector path `conductor/laneconductor.sync.mjs` calls, and whether it
currently survives the rewrite layer:

| Reachable today (single-segment) | Broken today (multi-segment) |
|---|---|
| `/provider-status`, `/track`, `/worker` | `/api/projects/:id/tracks`, `/api/projects/:id/claimable-tracks`, `/api/workers`, `/file-sync/claim`, `/file-sync/:id`, `/project/ensure`, `/projects/:id/workflow`, `/track/:n`, `/track/:n/action`, `/track/:n/lock`, `/track/:n/unlock`, `/track/:n/session`, `/track/:n/retry-count`, `/track/:n/prespawn-block`, `/track/:n/prespawn-block/reset`, `/tracks/claim-queue`, `/tracks/heartbeat`, `/tracks/stale`, `/tracks/reset-stuck-actions`, `/worker/register`, `/worker/heartbeat`, `/worker/:id/dispatch`, `/worker/:id/dispatch/claimed`, `/worker-dispatch/:id` |

**`remote-api` mode is non-functional in production.** A worker configured against
`https://app.laneconductor.com` cannot register, heartbeat, claim, lock, or report.

### Two prefixes are missing entirely, not just malformed

Correcting the glob syntax alone is insufficient. Two worker paths have **no
corresponding rewrite at any spelling**:

- `/projects/:id/workflow` — the existing entry is `/project**` (singular). A
  corrected `/project/**` still would not match `/projects/...`.
- `/worker-dispatch/:id` — `/worker**` matches the bare segment
  `/worker-dispatch`, but a corrected `/worker/**` would not match
  `/worker-dispatch/...` at all.

### Failure is silent and misdiagnosable

`conductor/laneconductor.sync.mjs`'s `get()` (line ~634) guards the response
content type and throws a legible `Expected JSON, got text/html: <!doctype html…`.
**`post()`, `patch()`, and `del()` have no such guard.** A rewrite miss returns
`200 text/html`, so `r.ok` is `true`, and the failure only surfaces from
`r.json()` as `SyntaxError: Unexpected token '<'`. That message points at
JSON parsing, not at hosting configuration — this is a large part of why the bug
survived to production.

### Why onboarding must stop advertising the cloud URL

Onboarding currently instructs users to point their worker at the broken origin:

| Location | Instruction |
|---|---|
| `ui/src/App.jsx:758` | `lc config mode remote-api --url https://app.laneconductor.com --key YOUR_KEY` |
| `ui/src/pages/AccountPanel.jsx:201,206` | `lc add-target --url https://app.laneconductor.com …` |
| `bin/lc.mjs:2921` | setup prompt: `Remote Collector URL (e.g., https://app.laneconductor.com)` |
| `.claude/skills/laneconductor/SKILL.md:719` | "The default URL for LC cloud is `https://app.laneconductor.com`" |

**Fixing the rewrites does not by itself make these instructions true.** The cloud
function is *also* missing route families the worker depends on — verified absent
from `cloud/functions/index.js` while present in `ui/server/index.mjs`:
`/projects/:id/workflow`, `/worker-dispatch/*`, `/api/projects/:id/claimable-tracks`,
`/tracks/claim-queue`, `/track/:n/prespawn-block`, `/track/:n/session`,
`/track/:n/lock`. This is the same class of gap track 1046 fixed for `/api/keys`.

That port is **explicitly out of scope here** (see Out of Scope) — which is
precisely why onboarding must not present cloud mode as a working, supported path
in this pass.

## Requirements

- **REQ-1** — Every rewrite in `firebase.json` that targets the `api` function must
  match both the bare prefix and all descendant paths, on **both** the `app` and
  `landing` hosting targets.
- **REQ-2** — Add the two missing prefixes: `/projects/**` and `/worker-dispatch/**`.
- **REQ-3** — The SPA catch-all `{ "source": "**", "destination": "/index.html" }`
  must remain last and continue to serve client-side routes (`/`, `/board`, deep
  links) as `text/html`. Fixing the API must not break SPA deep-linking.
- **REQ-4** — An automated test must assert the corrected rewrite set covers every
  path prefix the worker and UI actually call, and must fail if a prefix regresses
  to the `/x**` form. This test must run offline (no network, no deploy).
- **REQ-5** — `post()`, `patch()`, and `del()` in `conductor/laneconductor.sync.mjs`
  must apply the same JSON content-type guard `get()` already has, so a hosting
  misroute reports as a content-type error naming the URL rather than a
  `SyntaxError`.
- **REQ-6** — Onboarding surfaces (REQ-6 table above) must not present
  `https://app.laneconductor.com` as a ready-to-use collector URL while the cloud
  function is missing worker-critical routes. They must either omit cloud mode or
  label it explicitly as not yet supported, and point users at `local-api` instead.
- **REQ-7** — The cloud-route gap must be recorded as its own follow-up track, with
  the specific missing routes enumerated. It must not be silently deferred.

## Acceptance Criteria

Each criterion is a user-observable outcome. None is satisfiable by a stub.

- [ ] **AC-1** — After deploy, `curl https://app.laneconductor.com/api/projects`
      returns `application/json` (a `401` auth rejection is a **pass** — it proves
      the function was reached). It must not return `text/html`.
- [ ] **AC-2** — The same holds for a representative path under every corrected
      prefix: `/api/**`, `/v1/**`, `/auth/**`, `/project/**`, `/projects/**`,
      `/track/**`, `/tracks/**`, `/worker/**`, `/worker-dispatch/**`,
      `/file-sync/**`, `/provider-status/**`, `/heartbeat/**`, `/log/**`,
      `/health/**` — each returns `application/json`, never the SPA document.
- [ ] **AC-3** — Bare single-segment paths that worked before still work:
      `curl https://app.laneconductor.com/health` returns
      `{"ok":true,"cloud":true}` as `application/json`.
- [ ] **AC-4** — SPA deep-linking still works: `curl https://app.laneconductor.com/`
      and a client-side route both return the React `index.html` with `200`.
- [ ] **AC-5** — The REQ-4 test suite passes, and demonstrably **fails** when a
      rewrite is reverted to the `/api**` form (proven by temporarily reverting one
      entry and observing a red test).
- [ ] **AC-6** — A worker pointed at a corrected origin gets a real JSON response
      (including a real `401`) from `POST /worker/register` — not SPA HTML.
- [ ] **AC-7** — With REQ-5 in place, a `post()` against a deliberately unrewritten
      path produces an error message containing the offending URL and the received
      content type, not `Unexpected token '<'`.
- [ ] **AC-8** — No onboarding surface instructs a user to configure
      `https://app.laneconductor.com` as a working collector without an explicit
      "not yet supported" label.
- [ ] **AC-9** — A follow-up track exists enumerating the missing cloud routes.

## Out of Scope (deferred — NOT satisfiable by this track)

- **Porting the missing route families to `cloud/functions/index.js`**
  (`/projects/:id/workflow`, `/worker-dispatch/*`, `/api/projects/:id/claimable-tracks`,
  `/tracks/claim-queue`, `/track/:n/prespawn-block`, `/track/:n/session`,
  `/track/:n/lock`). This is a substantial port with its own auth and schema
  surface, tracked separately per REQ-7. **Because this is deferred, this track
  cannot claim that `remote-api` mode works end to end**, and must not be marked
  `done` on any criterion implying it does. AC-1…AC-9 are all deliberately scoped
  to the hosting layer, diagnosability, and honest onboarding.
- Custom-domain/DNS configuration, and the `landing` target's own SPA content.

## Notes on the fix shape

Prefer two explicit entries per prefix over clever glob syntax — explicit entries
are readable and directly assertable by the REQ-4 test:

```json
{ "source": "/api",    "function": "api" },
{ "source": "/api/**", "function": "api" }
```

Brace forms such as `/api{,/**}` are deliberately avoided: they are less portable
across Firebase's glob implementation and harder to assert mechanically. Order
matters — every function rewrite must precede the `**` SPA catch-all, which stays
last.
