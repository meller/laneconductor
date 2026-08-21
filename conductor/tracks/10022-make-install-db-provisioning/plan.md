# Plan: Track 10022 — make install: end-to-end DB provisioning & lc setup integration

## Phase 1: install-db Makefile target

Add `install-db` target that:
- Checks if Docker is available (`docker info`)
- If yes: checks if `laneconductor-pg` container exists and is running
  - If running: print "✅ Postgres already running" and skip
  - If stopped: `docker start laneconductor-pg`
  - If not exists: `docker run -d --name laneconductor-pg ...`
  - Wait for readiness: poll `docker exec laneconductor-pg pg_isready` up to 30s
- If no Docker: check if native Postgres is reachable (`pg_isready` or `psql`)
  - If reachable: use it
  - If not: print instructions + exit 1
- Wire `install-db` into `make install` after `install-node`

- [ ] Add `install-db` target to Makefile
- [ ] Add Docker container spin-up with readiness wait
- [ ] Add native Postgres fallback detection
- [ ] Wire into `make install` dependency chain
- [ ] Test: fresh run, re-run (idempotent), no-Docker path

## Phase 2: Install Atlas and run migrations

Add `install-atlas` target that:
- Checks if `atlas` is already on PATH — skip if so
- Downloads and installs Atlas via its official install script:
  `curl -sSf https://atlasgo.sh | sh`
- Verifies: `atlas version`

Add `install-migrate` target that:
- Runs `atlas migrate apply --env local` (uses `atlas.hcl` already in repo)
- Wire: `install-atlas` → `install-migrate` → after `install-db` in `make install`

- [ ] Add `install-atlas` target with skip-if-present check
- [ ] Add `install-migrate` target using Atlas
- [ ] Wire both into `make install` dependency chain
- [ ] Test: fresh DB (all 29 migrations apply), already-migrated DB (idempotent), Atlas already installed (skips download)

## Phase 3: Start UI at end of make install

Add final step to `make install` that:
- Calls `lc api start` and `lc ui start`
- Prints dashboard URL

- [ ] Add `lc api start && lc ui start` to end of `install` target
- [ ] Print "✅ Dashboard ready at http://localhost:8090"

## Phase 4: lc setup DB connectivity check

In `lc setup`, when user selects `local-api` mode, before asking for DB credentials:
- Attempt a quick TCP connect to `localhost:5432` (or configured host)
- If unreachable: show prompt:
  ```
  ⚠️  Cannot reach Postgres at localhost:5432
  [1] Start Docker container (docker run laneconductor-pg) ← recommended
  [2] I have Postgres — let me configure the connection
  [3] Skip for now
  ```
- If [1]: run `docker start laneconductor-pg || docker run -d --name laneconductor-pg ...`, wait for ready, then continue
- If [2]: proceed to credential prompts as today
- If [3]: warn and continue

- [ ] Add TCP connectivity check to `lc setup` local-api path
- [ ] Implement Docker start/run offer
- [ ] Add readiness wait after Docker start
- [ ] Test: Postgres running (no prompt), Postgres down + Docker available, Postgres down + no Docker

## Phase 5: Next-steps prompt at end of make install

At the end of `make install`, print clear guidance — no auto-launch of `lc setup` since that is per-project:
```
✅ LaneConductor installed!
   Dashboard: http://localhost:8090

Next: for each project you want to track:
  cd your-project
  lc setup
```

- [ ] Add next-steps message to end of `install` target
- [ ] Confirm `make install` dependency order: install-node → install-atlas → ui-install → install-cli → install-db → install-migrate → api-start + ui-start
