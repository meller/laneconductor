# LaneConductor Skills: Node.js and Postgres

Skills for Node.js apps on Postgres: local Postgres with Neon in production and the connection string in Secret Manager, Prisma inside Cloud Functions, an isolated test database, and a Makefile for local runs.

A skill pack for Claude Code, version 0.1.0, from the LaneConductor marketplace. It holds Markdown and template files only: no script, hook, MCP server or agent, and it sends nothing anywhere. It works on its own; LaneConductor is not required.

## Skills

- `postgres-local-neon-prod-secret-manager`: Database layout for a new product: local Postgres in development and tests, Neon Postgres in production, the production connection string kept only in GCP Secret Manager in the shared project and bound into the Cloud Function with defineSecret, never in .env or git.
- `prisma-in-cloud-functions`: Run Prisma in a Firebase Functions app the way the author's apps do: the functions folder has its own package.json with prisma and a postinstall generate, the root prisma folder is the single source and is synced in at deploy, runtime packages are declared in both package.json files and a test enforces it, and generate always follows a schema push.
- `isolated-test-database`: Keep the test suite off the interactive dev database: tests that truncate tables run against a dedicated <product>_test Postgres database, forced in the Vitest config so a shell-exported or .env DATABASE_URL cannot override it.
- `makefile-local-run`: Give a project the standard root Makefile: make help, install-all, db-local, db-seed, db-reset, dev, test-all, stop-all and a product-scoped deploy, so a fresh clone runs with one command and no manual database or .env step.

## Install

```
claude plugin marketplace add meller/laneconductor
claude plugin install laneconductor-node-postgres@laneconductor
```

## Update

```
claude plugin marketplace update laneconductor
claude plugin update laneconductor-node-postgres@laneconductor
```

## Advice, never orders

These skills are one author's own conventions and the incidents behind them, observed in the author's own projects with LaneConductor. Claude may decide against one and say why. Names such as `<shared-project>` or `<product>` are placeholders you fill in for your own setup. See [docs/skills.md](https://github.com/meller/laneconductor/blob/main/docs/skills.md) for the format and for attaching skills to lanes.

## License

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md. Questions and bugs: https://github.com/meller/laneconductor/issues
