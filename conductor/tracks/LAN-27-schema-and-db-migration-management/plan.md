# Track 1009: Schema and DB Migration Management

## Phase 1: Schema Audit & Migration Planning

**Problem**: Current schema is scattered across ad-hoc SQL files; need unified source of truth.
**Solution**: Document all existing tables, relationships, and constraints. Plan migration strategy.

- [x] Audit existing Postgres schema (tables, columns, constraints, indexes)
- [x] Document all tables in spreadsheet or doc
- [x] Identify all foreign key relationships
- [x] List all custom types (enums, etc.)
- [x] Identify existing migration scripts in `ui/server/migrations/`
- [x] Plan phased approach (Prisma first, then Atlas integration)
- [x] Choose Prisma version (latest stable)
- [x] Plan zero-downtime deployment strategy

**Impact**: Complete understanding of current schema and clear migration roadmap.

---

## Phase 2: Prisma Setup & Schema Definition

**Problem**: Schema is implicit and scattered; need explicit, versionable schema definition.
**Solution**: Set up Prisma ORM and define complete schema from existing database.

- [x] Install Prisma CLI and `@prisma/client`
- [x] Create `prisma/schema.prisma` boilerplate
- [x] Run `prisma db pull` to introspect Postgres schema
- [x] Review and clean up generated schema
- [x] Document all models, relationships, and constraints
- [x] Test Prisma client generation (`prisma generate`)
- [x] Create `.env` file with DATABASE_URL pointing to laneconductor DB
- [x] Validate schema matches current production state
- [ ] Commit schema.prisma to git

**Impact**: Prisma schema as source of truth; type-safe database client available.

---

## Phase 3: Atlas Integration for Migration Management

**Problem**: No structured migration tool; manual SQL execution is error-prone.
**Solution**: Integrate Atlas to manage schema migrations and provide validation/rollback.

- [x] Install Atlas CLI
- [x] Create `atlas.hcl` configuration file
- [x] Configure Atlas to work with Postgres and Prisma schema
- [x] Test schema inspection: `atlas schema inspect`
- [x] Convert existing manual migrations to Atlas format (in `migrations/`)
- [x] Test dry-run: `atlas migrate plan` (no execution)
- [x] Document Atlas workflow and commands
- [x] Test rollback capability on staging DB
- [x] Create CI/CD validation step (schema consistency check)

**Impact**: Structured migration tooling with validation and rollback capability.

---

## Phase 4: CI/CD Integration & Automation

**Problem**: Schema changes are manual and not validated before deployment.
**Solution**: Integrate migration checks and automation into CI/CD pipeline.

- [x] Add schema validation step to CI (e.g., `atlas migrate validate`)
- [x] Create Makefile targets:
  - `make db-migrate` — apply pending migrations
  - `make db-rollback` — rollback last migration (handled via atlas commands)
  - `make db-validate` — check schema consistency
  - `make db-status` — show pending migrations
- [x] Add migration step to deployment pipeline (updated `migrate.sh`)
- [x] Test CI/CD workflow with test migration
- [x] Document deployment checklist
- [x] Set up pre-merge checks (schema compatibility)

**Impact**: Safe, automated schema deployments with validation.

---

## Phase 5: Documentation & Team Training

**Problem**: Team doesn't know new schema management workflow.
**Solution**: Create comprehensive documentation and train team.

- [x] Write developer guide: "Adding Database Fields" (step-by-step)
- [x] Write ops guide: "Deploying Schema Changes"
- [x] Create troubleshooting guide (migration failures, rollbacks)
- [x] Document Prisma and Atlas concepts
- [x] Create video walkthrough (optional)
- [x] Share with team and gather feedback
- [x] Update project wiki or docs site
- [x] Schedule knowledge-sharing session

**Impact**: Team confident in new schema management workflow.

---

## Status Tracking
- [ ] Phase 1: Schema Audit & Migration Planning
- [ ] Phase 2: Prisma Setup & Schema Definition
- [ ] Phase 3: Atlas Integration for Migration Management
- [ ] Phase 4: CI/CD Integration & Automation
- [ ] Phase 5: Documentation & Team Training
