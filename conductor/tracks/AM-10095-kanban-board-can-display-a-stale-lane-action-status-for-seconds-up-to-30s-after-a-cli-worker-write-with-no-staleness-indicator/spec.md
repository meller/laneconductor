# Spec: Bounded, honest freshness for Kanban lane_action_status

## Problem Statement

A lane transition driven by the CLI or by the worker's own claim can be
invisible on the Kanban board for as long as 30 seconds, and the board's
existing freshness indicator reads "updated 1s ago" the entire time — so a
genuinely stale render is indistinguishable from a confirmed-fresh one.

Three independent causes were confirmed by reading the source end to end.

### RC-1 — the worker's DB claim never broadcasts (dominant path, previously unstated)

`claimQueuedTracks` (`ui/server/index.mjs:3659-3795`, mounted at
`POST /tracks/claim-queue`) performs `UPDATE tracks SET lane_action_status =
'running', ... claimed_by = $3` and returns the claimed rows. It contains
**zero** `broadcast()` calls — verified: 32 exist elsewhere in that file, none
inside this handler.

So in the ordinary local-api setup the DB is correct *immediately* when the
worker claims a track, and the board still does not find out until its next
scheduled poll. Once the websocket reports connected, that poll interval is
`POLL_INTERVAL_CONNECTED = 30000` (`ui/src/hooks/usePolling.js:6`) — the
websocket being healthy is precisely what makes this case slowest, because the
board trusts a push that is never sent. This is the largest share of the
reported 30s window and the cheapest thing to fix.

### RC-2 — the CLI writes the file and pushes nothing

`bin/lc.mjs`'s shared move-family handler (`move`, `plan`, `implement`,
`review`, `quality-gate`, `backlog`, `done`, `pulse`, `rerun`; handler opens
~line 2962) rewrites the `**Lane**` / `**Lane Status**` / `**Progress**`
markers in the track's `index.md` and commits them with a plain
`writeFileSync(indexPath, content)`. The handler's only outbound HTTP calls are
the unrelated session-invalidation `DELETE /track/:num/session` and, for
`rerun` only, a `POST /track/:num/comment`. Nothing pushes the transition
itself.

The DB therefore learns only via the second-process path: the sync worker's
chokidar watcher, a 250ms debounce, `POST /track` to the collector, which
writes the row and *then* broadcasts; the browser debounces that broadcast a
further 500ms (`usePolling.js:128-131`) before refetching. Typical end-to-end
latency is ~1-2s, with no guaranteed upper bound — and if no worker happens to
be running for that project, the DB never learns at all until one starts.

### RC-3 — the existing freshness indicator measures the wrong thing

`ui/src/App.jsx:563-573` renders a websocket status dot plus
`updated {timeAgo(lastUpdated)}`. `lastUpdated` (`usePolling.js:26`) is set on
every successful fetch, so it reports *when the board last talked to the API* —
not whether what the API returned is current with the filesystem. During the
entire RC-1 window the header reads "updated 1s ago" while the card is up to
30s out of date. The indicator is not merely absent; it is actively
reassuring at exactly the moment it should not be.

## Corrections to the reported problem statement

Both are load-bearing for scope, and both are recorded here because the
`index.md` **Problem** text is stale on them.

1. **"The same is true of the worker's own in-file running-claim write in
   `autoLaunchLocalFs`" is no longer accurate.** Track AM-10083 introduced
   `patchTrackAction()` (`conductor/laneconductor.sync.mjs:1348`), and the
   running claim *is* mirrored outward at
   `conductor/laneconductor.sync.mjs:8450`. Two caveats keep this from closing
   the gap on its own: that mirror is inside an `if (otherCollectors.length)`
   block, so it does not run at all in the single-collector local-api setup;
   and in that setup the DB row is already correct anyway, because
   `claim-queue` wrote it. The worker's residual defect is RC-1's missing
   broadcast, not a missing write. **No change to the worker is in scope.**

2. **The 30s figure is a real worst case, not a typical one**, and it applies
   to the RC-1 path specifically. The RC-2 path is bounded in practice by the
   worker's own watch cycle. Both are fixed here, but only RC-1 explains the
   headline number.

## Requirements

- **REQ-1**: `POST /tracks/claim-queue` MUST emit a `track:updated` broadcast
  for every track it actually claims, after the transaction commits. A call
  that claims nothing MUST NOT broadcast.
- **REQ-2**: The broadcast MUST carry the same `{ projectId, trackNumber }`
  shape every other `track:updated` broadcast in `ui/server/index.mjs` uses, so
  existing browser-side handling needs no change.
- **REQ-3**: In `local-api` / `remote-api` mode, `bin/lc.mjs`'s move-family
  handler MUST push the lane transition it just wrote to the configured
  collectors, via `PATCH /track/:num/action`, immediately after the
  `writeFileSync`.
- **REQ-4**: That push MUST be best-effort and MUST NOT be able to fail, block,
  or change the exit status of the lane move — matching the handler's existing
  session-invalidation call, which is already wrapped this way.
- **REQ-5**: The push MUST be skipped entirely when `cfg.mode === 'local-fs'`,
  and MUST fan out to enabled collectors only (`c.enabled !== false`), reusing
  the handler's existing `getCollectorToken(cfg, idx, projectRoot)` token
  resolution.
- **REQ-6**: The board's worst-case blind window MUST be bounded well below
  30s even when every push is missed. `POLL_INTERVAL_CONNECTED` is reduced from
  30000ms to 10000ms.
- **REQ-7**: The header indicator MUST distinguish fresh from possibly-stale.
  When the time since the last successful fetch exceeds a staleness threshold,
  the indicator MUST visibly change state rather than continue reading as
  normal.
- **REQ-8**: The 10013 coalescing guard (`inFlightRef` / `pendingRerunRef` in
  `usePolling.js:41-42, 50-54, 108-111`) MUST remain the single funnel for all
  fetches. No new code path may call the fetch routine around it.

## Design Decisions

**Use `PATCH /track/:num/action`, not `POST /track`, for REQ-3.** The action
endpoint already accepts `lane_status`, `lane_action_status` and
`progress_percent`, already broadcasts `track:updated`, and is already the
endpoint the worker's own `patchTrackAction()` targets. `POST /track` expects a
fully parsed track body and would force the CLI to duplicate the worker's
`index.md` parser.

**Accept the `syncTrackToFile` echo.** `PATCH /track/:num/action` also calls
`syncTrackToFile()`, which writes the same markers back into `index.md`. Since
the CLI just wrote those exact values, this is a same-value write. It may retouch
the file and so retrigger chokidar once, costing one extra `POST /track` round
trip. It cannot loop, because the second write changes no content and so
produces no further divergence. This is called out explicitly because the DB→file
direction has previously reverted file-only edits; here the DB is being told the
file's own values, so the two agree by construction.

**Per-card optimistic/pending state is a non-goal.** The problem statement
floats it. It cannot work for this bug: the board must reflect transitions it did
not initiate (a `lc plan` run in another terminal), and a browser has no way to
know a write it never made is in flight. A bounded global freshness signal is the
only honest option for externally-driven changes, so REQ-6 and REQ-7 take that
route instead.

## Acceptance Criteria

- [ ] AC-1: With the UI open and the websocket connected, a track claimed by
      the worker appears as `running` on the board within ~1s, not on the next
      scheduled poll. Observed in a real browser against a real worker, not
      inferred from the diff.
- [ ] AC-2: Running `lc implement <n>` from a terminal moves the card on an
      already-open board within ~1s, with the sync worker stopped — proving the
      CLI pushed the change itself rather than a worker noticing the file.
- [ ] AC-3: With the collector unreachable (API server stopped), `lc plan <n>`
      still rewrites `index.md` and still exits 0.
- [ ] AC-4: With all pushes suppressed, the board's own polling reflects an
      externally-changed row within 10s.
- [ ] AC-5: When the board has not successfully fetched for longer than the
      staleness threshold, the header stops reading as normal and visibly
      indicates the data may be out of date.
- [ ] AC-6: A burst of rapid `track:updated` broadcasts does not produce one
      fetch per broadcast — the 10013 coalescing still collapses them.
- [ ] AC-7: `cd ui && npx vitest run` passes, including the pre-existing
      suites. (Per repo memory: check `ps aux | grep laneconductor.sync.mjs`
      for leaked workers afterwards.)

## Files In Scope

| File | Change |
|---|---|
| `ui/server/index.mjs` | REQ-1/REQ-2: broadcast claimed tracks in `claimQueuedTracks` |
| `bin/lc.mjs` | REQ-3/4/5: push `PATCH /track/:num/action` after the move-family `writeFileSync` |
| `ui/src/hooks/usePolling.js` | REQ-6/REQ-7: bound the connected interval, expose staleness |
| `ui/src/App.jsx` | REQ-7: render the stale state in the existing header indicator |

Out of scope: `conductor/laneconductor.sync.mjs` (see Correction 1).
