# Tests: Track 1075 — Pino logging for worker + UI/API

## Test Commands
```bash
node --check conductor/laneconductor.sync.mjs
node --check conductor/services/logger.mjs
node --check ui/server/index.mjs
node --check ui/server/logger.mjs
node --check bin/lc.mjs

# Standalone Pinorama service
lc logs start
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:6201   # expect 200

# Confirm both components' logs land in the same store
curl -s http://localhost:6201/pinorama/stats
curl -s -X POST http://localhost:6201/pinorama/search -H "Content-Type: application/json" \
  -d '{"term":"<search term>"}'
```

## Results (this pass)

- `node --check`: clean on all 5 files.
- `lc logs start/stop/status/open` all work correctly. Found and fixed a real bug during
  verification: the initial implementation spawned via `npx pinorama`, which produced a PID
  mismatch (the npx wrapper's PID ≠ the actual listening process) — `lc logs stop` killed the
  wrapper while the real server survived as an orphan, confirmed via `ss -tlnp` still holding
  port 6201. Fixed by invoking `pinorama-studio`'s entry script directly via `node <path> --server
  ...` instead of through `npx`; `stop` now frees the port immediately, confirmed via `ss -tlnp`
  showing nothing bound to 6201 afterward.
- Auto-start verified: `lc worker start` (with the viewer stopped beforehand and enough time
  elapsed to avoid a TIME_WAIT port race) brings the viewer up automatically; `lc logs status`
  confirms `RUNNING` afterward.
- End-to-end log flow confirmed via `/pinorama/stats` (97 docs after one worker reconcile pass)
  and `/pinorama/search` (both `component: "worker"` and `component: "api"` entries present,
  distinguishable).
- `.sync.log`/`.api.log` confirmed unchanged — both still receiving normal plain-text output
  after the multistream change.
- No collision confirmed: this instance (port 6201, `.pinorama.msp`) ran simultaneously with
  coachai's own separate `pinorama --open` session (default port 6200) with no conflict.

## Test Cases

### Feature: standalone Pinorama, isolated from managed projects
- [x] TC-1: `lc logs start` binds to port 6201, not 6200 — confirmed running alongside
      coachai's `make local-start` (port 6200) simultaneously with no conflict.
- [x] TC-2: `lc logs start`'s storage path (`.pinorama.msp` in the install directory) is not
      the shared `os.tmpdir()/pinorama.msp` default — confirmed via the `--server-db-path`
      argument passed at spawn time.

### Feature: both processes' logs land in one viewer
- [x] TC-3: With worker + viewer running, a heartbeat cycle produces a visible log line
      tagged `component: "worker"` (confirmed via `/pinorama/search`).
- [x] TC-4: With the API + viewer running, a logged API action produces a visible log line
      tagged `component: "api"` (confirmed via `/pinorama/search`).
- [x] TC-5: Filtering by `component` in a search query isolates one process's logs from the
      other (confirmed — `component: "worker"` search hits never included `"api"` entries and
      vice versa).

### Feature: no regression to existing file-based logging
- [x] TC-6: `conductor/.sync.log` still receives the same plain-text lines as before this
      track.
- [x] TC-7: `ui/.api.log` likewise unaffected.
- [x] TC-8: `lc worker restart` and `lc api stop`/`start` don't break the transport connection
      — logs resume appearing in Pinorama after restart cycles (exercised repeatedly during
      both this track's and Track 1076's verification, which ran in the same session with
      these logger changes already in place).

## Acceptance Criteria
- [x] `node --check` clean on all touched/created files.
- [x] All 8 test cases pass via manual verification.
- [x] `SKILL.md` updated with viewer/logging docs.
