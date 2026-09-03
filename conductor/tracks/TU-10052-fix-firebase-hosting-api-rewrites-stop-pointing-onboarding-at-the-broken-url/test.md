# Tests: Track TU-10052 — Fix Firebase Hosting API rewrites; stop pointing onboarding at the broken URL

## Test Commands

```bash
# Offline rewrite regression suite (primary gate — no network, no deploy)
env -u NODE_TEST_CONTEXT node --test conductor/tests/firebase-rewrites.test.mjs

# Worker content-type guard tests (Phase 3)
env -u NODE_TEST_CONTEXT node --test conductor/tests/collector-content-type.test.mjs

# Full worker suite — regression check
env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs

# Syntax check
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +

# Live production probe (Phase 4 — after deploy)
for p in /health /api/projects /v1/projects /track/1 /tracks/running /worker/register \
         /projects/1/workflow /worker-dispatch/1 /file-sync/claim /auth/config; do
  printf "%-24s " "$p"
  curl -s -o /dev/null -w "%{http_code} %{content_type}\n" --max-time 15 "https://app.laneconductor.com$p"
done
```

> `env -u NODE_TEST_CONTEXT` is required — same gotcha documented by track 1096 in
> `conductor/quality-gate.md`.

## Test Cases

### Phase 1 — Rewrite matcher + failing regression suite

- [ ] **TC-1**: Matcher reproduces live-observed truth — `/api**` matches `/apifoo`
      — expected: `true` (encodes real production behaviour, not an assumption).
- [ ] **TC-2**: Matcher reproduces live-observed truth — `/api**` matches
      `/api/health` — expected: **`false`** (this is the entire bug).
- [ ] **TC-3**: `/api/**` matches `/api/health` and `/api/projects/1/tracks`
      — expected: `true` for both (the fix shape works).
- [ ] **TC-4**: `/api/**` matches bare `/api` — expected: `false`, which is exactly
      why the bare `/api` entry is also required.
- [ ] **TC-5**: Suite run against **unfixed** `firebase.json` — expected: FAILS red,
      listing the unmatched multi-segment paths. A green run here invalidates the suite.

### Phase 2 — Corrected rewrite set

- [ ] **TC-6**: Every path in `spec.md`'s blast-radius table resolves to the `api`
      function on the `app` target — expected: all 27 resolve, none hit the catch-all.
- [ ] **TC-7**: Same assertion for the `landing` target — expected: all resolve
      (both targets carry the same list and both were confirmed broken).
- [ ] **TC-8**: `/projects/1/workflow` resolves to `api` — expected: pass. Guards
      REQ-2; a corrected `/project/**` alone would *not* match this.
- [ ] **TC-9**: `/worker-dispatch/42` resolves to `api` — expected: pass. Guards the
      second missing prefix; `/worker/**` would not match it.
- [ ] **TC-10**: SPA catch-all `**` → `/index.html` is present and is the **last**
      entry in both targets — expected: pass (REQ-3).
- [ ] **TC-11**: Non-API SPA routes (`/`, `/board`, `/settings/profile`) resolve to
      `/index.html`, not the function — expected: pass. Guards against over-broad globs.
- [ ] **TC-12**: No function rewrite uses the defective glued `/<prefix>**` shape
      — expected: zero matches (REQ-4 regression guard).
- [ ] **TC-13**: Reverting one entry to `/api**` turns the suite red; restoring turns
      it green — expected: both observed and recorded (AC-5).

### Phase 3 — Worker content-type guard

- [ ] **TC-14**: `post()` against a mock returning `200 text/html` — expected: throws
      an error containing the request URL and `text/html`; **not** `Unexpected token '<'`.
- [ ] **TC-15**: Same for `patch()` — expected: same guarded error.
- [ ] **TC-16**: Same for `del()` — expected: same guarded error.
- [ ] **TC-17**: `get()` behaviour is unchanged by the refactor — expected: still
      throws its existing `Expected JSON, got …` message (no regression).
- [ ] **TC-18**: All four verbs against a mock returning valid `application/json`
      — expected: parsed body returned, no throw.

### Phase 4 — Live production verification (post-deploy)

- [ ] **TC-19**: `GET /api/projects` on `app.laneconductor.com` — expected:
      `application/json` (a `401` is a **pass**: the function was reached).
      Fails if `text/html`.
- [ ] **TC-20**: One representative path per corrected prefix returns
      `application/json` — expected: pass for all 14 prefixes (AC-2).
- [ ] **TC-21**: `GET /health` — expected: `200 application/json`,
      body `{"ok":true,"cloud":true}` (AC-3, no regression on what already worked).
- [ ] **TC-22**: `GET /` and a client-side deep link — expected: `200 text/html`
      serving the React `index.html` (AC-4 — SPA routing must survive).
- [ ] **TC-23**: `POST /worker/register` — expected: JSON response (real `401`
      counts), never SPA HTML (AC-6).
- [ ] **TC-24**: Spot-check `/api/projects` + `/health` on the `landing` target
      — expected: same corrected behaviour.
- [ ] **TC-25**: Content type is asserted on **every** live probe, not just status
      code — expected: enforced. The defect presented as `200`; status alone is
      blind to it.

### Phase 5 — Onboarding honesty

- [ ] **TC-26**: `grep -rn "app.laneconductor.com" ui/src bin .claude/skills` — expected:
      no remaining hit instructs configuring it as a working collector without an
      explicit "not yet supported" label (AC-8).
- [ ] **TC-27**: CORS allowlists in `cloud/functions/index.js:101` and
      `reader.js`/`reader.mjs` still contain the origin — expected: unchanged.
      These are correct and must not be swept up by TC-26's cleanup.
- [ ] **TC-28**: UI builds and the onboarding panel renders the revised copy
      — expected: `cd ui && npm run build` succeeds; step 2 shows the `local-api`
      instruction.

### Phase 6 — Deferred-work record

- [ ] **TC-29**: Follow-up track exists enumerating all seven missing cloud route
      families — expected: present, with its number referenced from this track's
      `conversation.md` and `spec.md` Out of Scope (AC-9).

## Acceptance Criteria

- [ ] TC-1 … TC-29 pass (TC-5 passes by being **red** before the Phase 2 fix).
- [ ] `conductor/tests/firebase-rewrites.test.mjs` fails on unfixed `firebase.json`
      and passes on fixed — both observed, not assumed.
- [ ] Full worker suite shows no new failures attributable to this track (compare
      against `main`'s own run, per `conductor/quality-gate.md`'s diff-confirm practice).
- [ ] Live probes recorded in `conversation.md` with actual status **and**
      content-type per path.
- [ ] No regression in SPA deep-linking (TC-22).
- [ ] Deferred cloud-route port is filed, not silently dropped — and this track
      claims no criterion implying `remote-api` mode works end to end.
