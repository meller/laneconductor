# Spec: Schema and DB Migration Management

## Problem Statement
LaneConductor manages multiple database tables and relationships across the system (projects, tracks, collectors, billing entities). Currently, schema changes are managed through:
- Ad-hoc SQL scripts in `ui/server/migrations/`
- Manual execution on dev and production
- No version control or rollback capability
- Risk of schema drift between environments

This approach is error-prone and not scalable as the system grows.

## Requirements

### Core Schema Management
- REQ-1: Define complete database schema in Prisma ORM
- REQ-2: Document all tables, relationships, and constraints
- REQ-3: Export schema definitions from Postgres to Prisma
- REQ-4: Validate schema against current state (laneconductor DB)

### Migration Automation
- REQ-5: Use Atlas to manage schema migrations
- REQ-6: Auto-generate migrations from Prisma schema changes
- REQ-7: Version all migrations with timestamps
- REQ-8: Support dry-run and validation before applying migrations
- REQ-9: Enable rollback capability (reversible migrations)
- REQ-10: Migrate schema across dev and production without downtime

### Deployment Pipeline
- REQ-11: Integrate migrations into CI/CD workflow
- REQ-12: Validate schema consistency before merge
- REQ-13: Auto-apply migrations on deployment
- REQ-14: Log and audit all schema changes

### Development Experience
- REQ-15: CLI commands for generating, applying, and rolling back migrations
- REQ-16: Local development workflow with automatic re-migration
- REQ-17: Type-safe database client generation from Prisma

## Acceptance Criteria
- [ ] Prisma schema file created and validated against current DB
- [ ] All existing tables and relationships documented in schema
- [ ] Atlas configured and integrated with Prisma
- [ ] Migration workflow tested (apply, validate, rollback)
- [ ] CI/CD pipeline includes schema validation and migration steps
- [ ] CLI commands (`make db-migrate`, `make db-rollback`, etc.) functional
- [ ] Documentation created for developers and ops teams
- [ ] Test migration in staging environment successful
- [ ] Production migration completed with zero downtime

## API / Tools Involved
- **Prisma**: ORM and schema definition
  - Config: `prisma.schema` file
  - Generated client: `@prisma/client`
  - CLI: `prisma migrate`, `prisma db push`, `prisma generate`

- **Atlas**: Database schema migration management
  - Config: `atlas.hcl` (or SQL files)
  - Commands: `atlas migrate apply`, `atlas migrate push`, `atlas schema inspect`

- **Database**: Postgres (laneconductor DB)
  - Existing tables: projects, tracks, and others

## Workflow

### Developer Workflow
1. Update `prisma/schema.prisma` with new model or field
2. Run `prisma migrate dev --name <migration-name>`
3. Prisma generates migration SQL in `prisma/migrations/`
4. Apply to local database automatically
5. Update application code using generated client
6. Commit schema and migrations to git

### Deployment Workflow
1. CI/CD validates migration against staging schema
2. Atlas inspects staging schema vs. migration
3. On approval, run `atlas migrate apply` in production
4. Verify schema consistency with health checks
5. Rollback on failure (automated or manual)

## Data Model (Current Schema Outline)

The following tables exist and must be defined in Prisma:

```sql
-- projects table
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT UNIQUE NOT NULL,
  git_remote TEXT,
  git_global_id UUID UNIQUE,
  primary_cli TEXT DEFAULT 'claude',
  primary_model TEXT,
  secondary_cli TEXT,
  secondary_model TEXT,
  create_quality_gate BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- tracks table
CREATE TABLE tracks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  track_number TEXT NOT NULL,
  title TEXT NOT NULL,
  lane_status TEXT DEFAULT 'backlog',
  progress_percent INTEGER DEFAULT 0,
  current_phase TEXT,
  content_summary TEXT,
  sync_status TEXT DEFAULT 'synced',
  last_updated_by TEXT DEFAULT 'human',
  last_heartbeat TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, track_number)
);
```

Plus any tables for collectors, billing, and other features.

## Deliverables
1. `prisma/schema.prisma` — complete schema definition
2. `atlas.hcl` — Atlas configuration
3. `prisma/migrations/*` — existing migrations converted
4. Makefile targets: `make db-migrate`, `make db-rollback`, `make db-validate`
5. Documentation: `conductor/db-migration-guide.md`
6. CI/CD integration: `.github/workflows/schema-validate.yml` (if applicable)
