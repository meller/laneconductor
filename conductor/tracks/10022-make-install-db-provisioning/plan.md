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

## Phase 2: Run migrations as part of make install

Add `install-migrate` target that:
- Checks if Atlas is available (`which atlas`)
  - If yes: run `atlas migrate apply --env local`
  - If no: run migrations via Node.js pg client against the SQL files directly (no extra dep)
- Wire after `install-db` in `make install`

- [ ] Add `install-migrate` target
- [ ] Implement Atlas path
- [ ] Implement fallback Node.js pg migration runner (reads `migrations/*.sql` in order)
- [ ] Wire into `make install`
- [ ] Test: fresh DB (all migrations apply), already-migrated DB (idempotent)

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

## Phase 5: lc setup prompt at end of make install

At the end of `make install`, print a clear next-step prompt:
```
✅ LaneConductor installed!

Next steps:
  cd your-project
  lc setup        ← registers this project and configures your AI agent
```

- [ ] Add next-steps message to end of `install` target output
- [ ] Consider: if `make install` is run from inside a project dir (has `.git`), auto-offer to run `lc setup` now
