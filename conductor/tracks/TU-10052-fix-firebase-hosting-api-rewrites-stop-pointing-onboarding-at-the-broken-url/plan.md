# Track TU-10052: Fix Firebase Hosting API rewrites; stop pointing onboarding at the broken URL

Root cause is proven (see `spec.md`): `/api**` matches within a single path
segment only, so every multi-segment API path falls through to the SPA catch-all
and returns `200 text/html`. The `api` function itself is healthy — verified
directly against its Cloud Run URL.

Phases are ordered so the regression test exists **before** the fix (TDD, per
`conductor/workflow.md`), and so nothing is deployed until it is proven locally.

---

## Phase 1: Failing regression test for the rewrite set

**Problem**: Nothing in the repo asserts that `firebase.json`'s rewrites actually
route the paths the worker calls. The defect reached production silently and would
regress just as silently.

**Solution**: A pure-offline `node:test` suite that parses `firebase.json`, applies
Firebase's documented glob semantics, and asserts every worker/UI path prefix
resolves to the `api` function rather than the SPA catch-all.

- [x] Task 1.1: Add `conductor/tests/firebase-rewrites.test.mjs` (zero deps,
      `node:test` — per `conductor/tech-stack.md`, filesystem-touching tests use
      `node:test`, not Vitest).
- [x] Task 1.2: Implement a small matcher mirroring Firebase's glob dialect — the
      one rule that matters: `**` is a cross-segment globstar **only** when it is a
      whole segment; glued to a prefix it matches within one segment.
    - [x] Self-check the matcher against the live-observed truth table in
          `spec.md` (`/api**` matches `/apifoo`, does **not** match `/api/health`),
          so the test encodes verified production behaviour, not an assumption.
- [x] Task 1.3: Assert every path in `spec.md`'s blast-radius table resolves to
      the `api` function, for **both** hosting targets (`app` and `landing`).
- [x] Task 1.4: Assert the SPA catch-all is still present and still last (REQ-3).
- [x] Task 1.5: Add a guard test that fails on any function rewrite matching the
      defective `/<prefix>**` shape (prefix glued to `**`).
- [x] Task 1.6: **Run it and confirm it FAILS red** against today's `firebase.json`,
      naming the specific unmatched paths. A test that passes before the fix is
      worthless here.

**Impact**: The bug becomes reproducible offline in under a second, and can never
silently return.

---

## Phase 2: Correct the rewrites

**Problem**: 24 of 27 worker endpoints are unreachable; two prefixes are missing
outright.

**Solution**: Replace each `/<prefix>**` with an explicit bare + descendant pair,
and add the two missing prefixes.

- [x] Task 2.1: In `firebase.json`, for **both** the `app` and `landing` targets,
      replace every function rewrite `/<p>**` with `/<p>` and `/<p>/**`, across:
      `/api`, `/v1`, `/auth`, `/project`, `/track`, `/tracks`, `/worker`,
      `/file-sync`, `/provider-status`, `/heartbeat`, `/log`, `/health`.
- [x] Task 2.2: Add the two missing prefixes (REQ-2): `/projects` + `/projects/**`,
      and `/worker-dispatch` + `/worker-dispatch/**`.
- [x] Task 2.3: Keep `{ "source": "**", "destination": "/index.html" }` last in
      both target lists; leave the `app` target's `headers` block untouched.
- [x] Task 2.4: Re-run Phase 1's suite — confirm it now passes **green**.
- [x] Task 2.5: Prove the test is load-bearing (AC-5): temporarily revert one entry
      to `/api**`, observe red, restore, observe green. Record both observations.
- [x] Task 2.6: Commit — `fix(track-10052): correct Firebase Hosting rewrite globs`.

**Impact**: Every API path prefix routes to the `api` function. Verified locally
before any deploy.

---

## Phase 3: Make a misroute diagnosable in the worker

**Problem**: `get()` guards response content type; `post()`/`patch()`/`del()` do
not. A misroute returns `200 text/html`, passes `r.ok`, and surfaces as
`SyntaxError: Unexpected token '<'` — a message that blames JSON parsing rather
than hosting config.

**Solution**: Apply `get()`'s existing guard to the other three verbs.

- [x] Task 3.1: Extract `get()`'s content-type check (`conductor/laneconductor.sync.mjs`
      ~line 646) into one shared helper; leave `get()`'s behaviour identical.
- [x] Task 3.2: Apply it in `post()`, `patch()`, and `del()` before `r.json()`.
      Error text must name the URL and the received content type.
- [x] Task 3.3: Test — a mock endpoint returning `200 text/html` makes each verb
      throw an error containing the URL and `text/html`, never `Unexpected token`.
      Extend `conductor/tests/firebase-rewrites.test.mjs` or add a sibling file.
- [x] Task 3.4: Commit — `fix(track-10052): guard JSON content-type on post/patch/del`.

**Impact**: The next hosting misroute names itself in one line of worker log.

---

## Phase 4: Deploy and verify against production

**Problem**: The rewrite fix is inert until Hosting is redeployed; local test
passage is necessary but not sufficient evidence.

**Solution**: Deploy hosting, then re-run the exact `curl` probes from `spec.md`.

- [x] Task 4.1: Deploy both hosting targets
      (`firebase deploy --only hosting --project laneconductor-site`).
      The `api` function needs no redeploy — its routing is unchanged.
- [x] Task 4.2: Re-run the `spec.md` probe table against
      `https://app.laneconductor.com`. Record actual status + content-type per path.
      **Read the content type, not just the status** — the whole defect presented as
      a `200`.
- [x] Task 4.3: Confirm AC-1/AC-2 — every prefix returns `application/json`
      (a `401` is a pass: the function was reached).
- [x] Task 4.4: Confirm AC-3 — `/health` still returns `{"ok":true,"cloud":true}`.
- [x] Task 4.5: Confirm AC-4 — `/` and a client-side deep link still return the SPA
      `index.html` with `200`. Regressing SPA routing would trade one bug for another.
- [x] Task 4.6: Confirm AC-6 — `POST /worker/register` returns JSON (real `401`
      included), not SPA HTML.
- [x] Task 4.7: Repeat the spot-check against the `landing` target.
- [x] Task 4.8: Paste observed output into `conversation.md` as the evidence record.

**Impact**: The production fix is demonstrated by observation, not inference.

> ✅ **RUN 2026-09-03 — deployed and verified live.**
> `firebase deploy --only hosting --project laneconductor-site` — both targets
> released clean. All API prefixes (verb-corrected) return real `application/json`
> responses from the function; `/health` unchanged; SPA routing (`/`, `/board`,
> `/settings/profile`, `/inbox`) confirmed body-level as the real React shell;
> `landing` target and raw `laneconductor-app.web.app` spot-checked and match.
> Full evidence in `conversation.md`. AC-1 through AC-9 all confirmed.

---

## Phase 5: Honest onboarding

**Problem**: Four onboarding surfaces tell users to point a worker at
`https://app.laneconductor.com`. Even with rewrites fixed, the cloud function is
missing seven worker-critical route families — so the instruction stays false.

**Solution**: Stop presenting cloud mode as ready; steer onboarding to `local-api`.

- [x] Task 5.1: `ui/src/App.jsx:758` — replace the `remote-api` onboarding step
      with the `local-api` equivalent, or mark it explicitly "not yet supported".
- [x] Task 5.2: `ui/src/pages/AccountPanel.jsx:201,206` — same treatment for the
      two `lc add-target` examples.
- [x] Task 5.3: `bin/lc.mjs:2921` — the setup prompt must not present the URL as a
      working default without the same caveat.
- [x] Task 5.4: `.claude/skills/laneconductor/SKILL.md:719` — annotate the "default
      URL for LC cloud" line with current status.
- [x] Task 5.5: Confirm AC-8 — re-grep for `app.laneconductor.com` and check every
      remaining user-facing hit is either a caveated mention or non-onboarding
      (CORS allowlists in `cloud/functions/*` are correct and must stay).
- [x] Task 5.6: Commit — `fix(track-10052): stop onboarding users onto unsupported cloud mode`.

**Impact**: No user is sent down a path that cannot work.

---

## Phase 6: Record the deferred cloud-route gap (REQ-7)

**Problem**: The missing cloud routes are the *reason* Phase 5 exists. Left
unrecorded, the deferral becomes invisible.

**Solution**: File it as its own track with the specific routes enumerated.

- [x] Task 6.1: Create a follow-up track ("Port missing worker routes to the cloud
      function") listing: `/projects/:id/workflow`, `/worker-dispatch/*`,
      `/api/projects/:id/claimable-tracks`, `/tracks/claim-queue`,
      `/track/:n/prespawn-block`, `/track/:n/session`, `/track/:n/lock` — each
      confirmed present in `ui/server/index.mjs` and absent from
      `cloud/functions/index.js`. Note track 1046 as the precedent.
- [x] Task 6.2: Reference the new track number in this track's `conversation.md`
      and in `spec.md`'s Out of Scope section.

**Impact**: The remaining work is visible and owned.

---

## ⛔ Deferred — not claimable by this track

Porting the missing route families to `cloud/functions/index.js` (Phase 6's
follow-up) stays **open**. Per `spec.md`'s Out of Scope, this track must not be
marked complete on any claim that `remote-api` mode works end to end. This track
fixes the hosting layer, makes misroutes diagnosable, and makes onboarding honest —
that is its whole scope, and every acceptance criterion is written to that line.
