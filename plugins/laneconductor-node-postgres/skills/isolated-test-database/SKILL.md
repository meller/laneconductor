---
name: isolated-test-database
description: "Keep the test suite off the interactive dev database: tests that truncate tables run against a dedicated <product>_test Postgres database, forced in the Vitest config so a shell-exported or .env DATABASE_URL cannot override it."
when_to_use: "Use when setting up or changing tests that use a real Postgres/Prisma database, writing vitest.config.ts, a test:db script or CI env, when a test run wiped or reset the dev database or data disappeared from the running app, or when several worktrees or agents run tests at once."
paths: "vitest.config.ts, vitest.config.mts, prisma/schema.prisma"
metadata:
  kind: convention
  stack: [vitest, postgres, prisma, testing, worktrees]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A local Postgres is running (the user starts it) and the project has Prisma migrations or an equivalent schema step.
    - The makefile-local-run skill's db-test target exists, or Claude creates the test database by the one-time command below.
  verified: 2026-11-17
---

## Why this works
Observed in the author's own projects with LaneConductor: in one project `npm test` ran against the
same local database as the running dev server. Several server tests truncate tables between cases,
so a test run wiped whatever the author had open in the app, twice in one session, with no
warning. The fix is one forced setting, and it belongs in every product that has database tests.

## Recommendation
- Test database name: `<product_underscored>_test` on the same local Postgres.
- Force it in the Vitest config for the project that touches the database, as a literal value, not
  `process.env.DATABASE_URL || default`:
  `test: { env: { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/<product>_test" } }`.
  The forced form wins even when the shell already sourced `.env` (observed; see Pitfalls).
- `fileParallelism: false` for that project: test files share one database and truncate between
  tests, so parallel files race each other. Tests inside a file still run normally.
- Create and migrate once: `make db-test` (makefile-local-run), which is
  `createdb <product>_test` then `DATABASE_URL=<test url> npx prisma migrate deploy`.
- Test cross-database logic (dev to prod sync) with two Postgres schemas inside the test database
  standing in for the two databases.

## Claude does
- Add the `env` and `fileParallelism` settings to the database-touching Vitest project, and the
  `db-test` target to the Makefile if missing.
- Add a line to the project's test notes: "tests run against `<product>_test`, never the dev DB".
- If data in the running app disappears after a test run, check `vitest.config.ts` first.

## You run
1. `make db-test` once per machine (creates and migrates the test database; needs local Postgres up).

## Pitfalls
- One project's override is a literal in `test.env`; another's is `process.env.DATABASE_URL ||
  '...<product>_test'`, so any exported `DATABASE_URL` (a sourced `.env`, a prod string exported
  for a one-off script) points the suite at that database. This is the failure the literal removes;
  the second project has the weaker form.
- Vitest's documentation says only that `test.env` is "available on `process.env` and
  `import.meta.env` during tests" and does not state that it beats an already-exported variable;
  that precedence is the author's own observation (a comment in a config file), UNVERIFIED
  against Vitest's source. Check it in a new project with a one-line test that prints the database
  name.
- Parallel test files on one database race their truncations (a config comment in one project).
  `fileParallelism` is a Vitest option that sets the worker count to 1; whether it can be set per
  project inside a `projects` config is not documented on Vitest's page; one project sets it in its
  `server` project and it works there.
- Tests that touch real directories can destroy real artifacts too: see
  vertex-imagen-retry-gcs-fallback (a suite deleted developer-generated images); inject temp
  directories, not `<cwd>/generated-images`.
- The e2e suite needs no database in the author's project (it runs on a fixture repository); keep
  it that way so `make test-all` needs no more database than `npm test`.

## Unproven
- **One test database per worktree.** None of the author's projects does this: the test database
  name is a literal in the config, so every worktree and every agent running `npm test` at once uses
  the same database, and `fileParallelism: false` only serialises files inside one process, not
  across processes. Parallel worktrees (LaneConductor tracks run in `.worktrees/<id>`) can
  therefore truncate each other's data mid-test. Advice with no observed project behind it: derive
  the name from the worktree folder, for example `<product>_test_<worktree-name>` (lower-case,
  letters, digits, underscores, at most 63 characters, the Postgres identifier limit), create it
  on demand in a Vitest `globalSetup`, and drop it afterwards. Try it on one project and record
  the result before promoting it to the Recommendation.
- A guard that fails the suite when `DATABASE_URL` does not end in `_test` (a `globalSetup` check)
  would catch a bad override early. No project implements it.
