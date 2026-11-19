---
name: postgres-local-neon-prod-secret-manager
description: "Database layout for a new product: local Postgres in development and tests, Neon Postgres in production, the production connection string kept only in GCP Secret Manager in the shared project and bound into the Cloud Function with defineSecret, never in .env or git."
when_to_use: "Use when adding a database, Postgres, Prisma, DATABASE_URL or a connection string to a project; when about to put a production URL into .env or a chat; when writing functions/index.mjs, a deploy script that runs migrations or seeds against production; or when choosing between Neon, Cloud SQL, Supabase or SQLite."
paths: "prisma/schema.prisma, functions/index.mjs, .env.example"
metadata:
  kind: convention
  stack: [postgres, neon, prisma, gcp, secret-manager, firebase-functions-v2]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A Neon project and database for the product exists (the user creates it in the Neon console).
    - The user is signed in to gcloud with access to the shared GCP project <shared-project> (the user runs the sign-in).
    - The shared-gcp-firebase-site skill is in place, so the product has its own Functions codebase.
  verified: 2026-11-17
  smoke_check: gcloud secrets list --project=<shared-project> --format="value(name)"
---

## Why this works
Observed in the author's own projects with LaneConductor: four products keep the production Neon
connection string in Secret Manager and bind it into the function (three in the shared GCP
project, one in its own), so the string never touches a file, git or a chat. Three of them develop
against a local Postgres. Tests that truncate tables make a separate local database mandatory (see
isolated-test-database).

## Recommendation
- Local: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<product_underscored>` from
  `.env.example` (`files/.env.example.tmpl`); `make db-local` creates and migrates it.
- Production: Neon. Secret name rule, as a recommendation: **`<PRODUCT>_DATABASE_URL`**, upper-case
  snake case, the style of the author's newest product. The older products differ, see Pitfalls.
  Store the pooled string; scripts derive the direct one.
- Function: bind with `defineSecret("<PRODUCT>_DATABASE_URL")` and `secrets: [databaseUrl]`, set
  `process.env.DATABASE_URL = databaseUrl.value()` inside a lazily created, cached promise, and
  import the Express app (a `createApp()` factory, no top-level `listen()`) only after that
  (`files/functions/index.mjs.tmpl`).
- If the repo has `conductor/deploy.json`, add the secret name to `secrets.keys`.
- Production schema and data commands read the secret inline into one command's environment, and
  are packaged as Makefile targets that you run (Makefile escaping shown):
  `DATABASE_URL="$$(gcloud secrets versions access latest --secret=<NAME> --project=<shared-project> | sed 's/-pooler//')" npx prisma migrate deploy`
  Never write the value to a file, `.env` or an echo. Scripts that touch a database refuse a
  non-local host unless `ALLOW_REMOTE_DB=1`.
- Pick the function region next to the Neon region (one product: a us-east1 function because its
  Neon project is on AWS us-east-2).

## Claude does
- Write `functions/index.mjs`, `.env.example` lines and `scripts/store-database-url.sh` from `files/`
  (fill `{{product}}`, `{{function}}`, `{{gcp_project}}`, `{{gcp_region}}`, plus the secret name and
  the database name). `dist-server/src/app.js` in the template is one project's build output;
  adjust to the project's.
- Add `make db-migrate-prod`-style targets with the inline form above; never run them.
- Never run `gcloud secrets versions access`, never ask for, echo or paste a connection string.

## You run
1. Create the Neon project and database in the Neon console.
2. `bash scripts/store-database-url.sh` and paste the pooled connection string at the hidden prompt.
3. Create the schema in production: the `*-prod` migrate target (for one product this was a deploy
   script run with a `--db-change` flag).
4. `make deploy` (the secret must already exist, or the deploy fails).

## Pitfalls
- The secret must exist before `firebase deploy`, or the deploy fails; naming it in `defineSecret`
  and `secrets` is what makes Firebase grant the function's service account access (a code comment
  in the author's entry file). Creating the secret alone is not enough either: it must also be in
  `defineSecret` and in `deploy.json` `secrets.keys` (a stack note in one project).
- `.value()` only exists at runtime (confirmed in Firebase's config-env docs: secret values are
  hidden until the function executes), and a DB client that reads `process.env.DATABASE_URL` at
  import time breaks with a top-level `import`. Defer the import.
- Neon pooled strings (`-pooler` in the host) are for the app. Neon's docs recommend a direct
  connection for schema migrations and pg_dump, and one project saw stale catalog visibility on the
  pooled endpoint for DDL; hence `sed 's/-pooler//'` (the staleness is the author's observation).
  Neon's own `neon-postgres` skill ("Pooled vs direct connections") lists the failure modes of the
  pooled endpoint: a `SET search_path` that does not persist, `prepared statement already exists`
  and SQLSTATE 25006; see it for the general rule.
- `pg_dump` refuses a newer server: production Neon ran Postgres 18 against a local pg_dump 16
  ("aborting because of server version mismatch"). One project streams rows with `psql \copy ... TO
  STDOUT | psql \copy ... FROM STDIN` instead.
- A content sync used to `TRUNCATE CASCADE` the catalogue on every run; once real users existed
  that orphaned their data and it was about to delete paid unlocks. Sync dev to prod additively
  (insert what prod lacks), never truncate.
- A deploy script must never fall back to the local `.env`: `dotenv` does not override variables
  that are already set, so set `DATABASE_URL` in the child's environment before spawning.
- After `prisma db push` also run `prisma generate`: a stale client failed an unrelated upsert with
  P2022 "column does not exist" and looked like production schema drift. One project's Makefile
  already runs both after `migrate deploy`.
- Secret naming is not uniform across the author's products: most are kebab-case with a
  product prefix, one is upper-case snake case, one lives in its own GCP project. The rule above
  follows the newest product; changing the rule means changing this skill.
- Never paste a production string into a chat, a commit or an `.env`; `.env.example` holds the
  variable name and the localhost default only.
- Prisma strategy differs: one project uses `prisma migrate deploy`; another uses `prisma db push`
  with no migration files. This skill follows `migrate deploy`.

## Unproven
- `PGSSLMODE=require` in the function entry is one project's choice; whether a Neon connection
  string that already carries `sslmode=require` needs it was not shown.
