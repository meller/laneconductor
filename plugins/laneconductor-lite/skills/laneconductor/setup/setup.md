# setup, install and setup collection

Run these only when the user asks for them by name. They write config and symlinks into the
project.

## Install (one-time, per machine)

```bash
git clone <repo> ~/Code/laneconductor
cd ~/Code/laneconductor
make install    # writes ~/.laneconductorrc (the skill directory) + installs UI deps
```

Add LaneConductor to a project: `cd your-project && lc setup`.

`lc setup` symlinks the **whole skill directory** from the install into the project's
`.claude/skills/laneconductor` (and `.agents/skills/laneconductor`), so updates to the
laneconductor repo reach every project at once, and the `lanes/`, `ops/`, `setup/` and `deploy/`
subfolders travel with it. Without symlinks (Windows without WSL, Claude Desktop),
copy the whole folder, not just `SKILL.md`: the index links to files beside it. `lc` lives in the
install's `bin/`; `make install-cli` puts it on the PATH.

## setup

Initializes LaneConductor in the current project.

1. Check for the CLI (`which lc`). If it exists, the recommended route is `lc setup` (a guided
   wizard); the alternative is `setup scaffold` here.
2. Without `lc` (skill-only mode) assume `mode: "local-fs"`, create `.laneconductor.json`, then
   continue with `setup scaffold`:
   ```json
   {
     "mode": "local-fs",
     "project": {
       "name": "<detected-name>",
       "repo_path": "<absolute-path>",
       "primary": { "cli": "claude" }
     }
   }
   ```
In skill-only mode there is no heartbeat worker; the AI updates the `conductor/` files itself
during its turn.

## Operating modes (`local-api` and `remote-api` belong to the parked database tier)

`mode` in `.laneconductor.json` is the first field and controls everything else:

| Mode | DB | Collector | UI | Best for |
|------|----|-----------|----|----------|
| `local-fs` | no | no | no | offline, CI, tests (the default) |
| `local-api` | local Postgres | `localhost:8091` | `localhost:8090` | solo developer, full stack |
| `remote-api` | remote | remote URL | cloud URL | teams, multi-machine |

If `mode` is missing, it is inferred from `collectors`: none -> `local-fs`; a URL containing
`localhost` or `127.0.0.1` -> `local-api`; any other URL -> `remote-api`. One `.laneconductor.json`
per repository; `project.id` is its identity in the database (omit it for `local-fs`).

## setup collection (steps 2 and 3 apply only to the parked database tier)

Configures the operating mode, the AI agents, and registers the project. Ask in this order.

1. **Mode** (table above). For `local-fs`, skip steps 2 and 3.
2. **DB connection** (`local-api` only): host `localhost`, name `laneconductor`, port `5432`, user
   `postgres`, password, SSL `n`. The password goes in `.env` as `DB_PASSWORD`, never in
   `.laneconductor.json`. Create the schema with the SQL of the parked tier (`db-schema.md` in the LaneConductor repository's skill, not shipped in this plugin)
   (`psql -h <host> -p <port> -U <user> -d <db> -f <file>`, or a one-off node script).
3. **Collectors** (not `local-fs`): local only (default), LC cloud, or both. A cloud token is stored
   in `.env` as `COLLECTOR_n_TOKEN` (n is the collector's array index), never in the JSON; for a
   `gcp-secret` store type, ask for the secret name. Make sure `.gitignore` contains `.env`.
   The cloud URL is `https://app.laneconductor.com`, but **LC cloud is not fully supported yet
   (track 10052)**: several worker endpoints (`/tracks/claim-queue`, `/track/:n/lock`,
   `/track/:n/unlock`, `/projects/:id/workflow`, `/worker-dispatch/*`, `/track/:n/session`,
   `/api/projects/:id/claimable-tracks`) exist in `ui/server/index.mjs` but not in
   `cloud/functions/index.js`, so a worker pointed at LC cloud cannot claim or coordinate work.
   Recommend `local-api` until that port lands.
4. **Primary agent**: `claude`, `antigravity (agy)`, `gemini (retired)` or `other`. Verify it is
   reachable with `claude --version`, `agy --version`, `npx @google/gemini-cli --version`, or the
   command the user gives for `other`. Print `✅ <agent> reachable - <version>`. On failure warn
   and ask `Continue anyway? [y/N]`. If `gemini` is chosen, warn that Google retired Gemini CLI
   and antigravity is recommended (wording: the setup wizard in `bin/lc.mjs`); it does not block.
   - **Model:** for `claude` the CLI takes aliases (`haiku`, `sonnet`), so do not run a discovery
     command; leaving it blank takes the current default, which is the recommended choice. For
     `gemini`, a one-shot `npx @google/gemini-cli -p "List the available Gemini model IDs as a
     plain newline-separated list, no commentary"` can list models (fall back to free text after
     15s). For `agy` and `other` there is no known listing command: ask `Model name (leave blank
     to set later):`.
5. **Secondary agent** (optional): same reachability check and model question. Blank model means
   the default.
6. **Project name:** parse `git remote get-url origin`, falling back to `basename $(pwd)`.
7. **Write `.laneconductor.json`** (never put passwords or tokens in it):
   ```json
   {
     "mode": "local-api",
     "project": {
       "name": "<detected-name>",
       "id": null,
       "repo_path": "<absolute-path>",
       "git_remote": "<git-remote-or-null>",
       "primary": { "cli": "claude", "model": "<selected-model>" },
       "secondary": { "cli": "agy", "model": "<selected-model>" },
       "dev": { "command": "npm run dev", "url": "http://localhost:3000" }
     },
     "collectors": [{ "url": "http://localhost:8091", "token": null }],
     "ui": { "port": 8090 }
   }
   ```
   `local-fs` is the same minus `id`, `secondary`, `dev` and `ui`, with `"collectors": []`.
   `remote-api` points `collectors[0].url` at the remote collector (for example
   `https://collector.laneconductor.io`) and may set `"create_quality_gate": false`. Omit
   `secondary` and `dev` when unused. `dev.command` / `dev.url` add a "Start Dev Server" button to
   review-lane tracks in the Kanban UI.
