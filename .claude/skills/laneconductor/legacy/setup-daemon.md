# setup, install and setup collection (daemon era, parked)

Not part of the LaneConductor plugin. This is what `setup` meant before the plugin: install the repository with `make install`,
link the skill into a project, and register the project with a sync worker and a database. The plugin's `setup` is now
"add LaneConductor to this project" ([../setup/setup.md](../setup/setup.md), which follows
[../ops/new-project.md](../ops/new-project.md)). Use this file only when the person runs the CLI wizard (`lc setup`) or asks
for `setup collection` by name.

When the CLI wizard sends you to `setup scaffold generate` ([../setup/scaffold.md](../setup/scaffold.md)), also do the
daemon-era steps of this file: link the skill into the project (below), add the runtime lines to `.gitignore`, import
foreign tracks if the person says yes, and run the environment check.

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
laneconductor repo reach every project at once, and the `lanes/`, `ops/`, `setup/`, `deploy/` and
`legacy/` subfolders travel with it. Without symlinks (Windows without WSL, Claude Desktop),
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

## Operating modes

`mode` in `.laneconductor.json` is the first field and controls everything else:

| Mode | DB | Collector | UI | Best for |
|------|----|-----------|----|----------|
| `local-fs` | no | no | no | offline, CI, tests (the default) |
| `local-api` | local Postgres | `localhost:8091` | `localhost:8090` | solo developer, full stack |
| `remote-api` | remote | remote URL | cloud URL | teams, multi-machine |

If `mode` is missing, it is inferred from `collectors`: none -> `local-fs`; a URL containing
`localhost` or `127.0.0.1` -> `local-api`; any other URL -> `remote-api`. One `.laneconductor.json`
per repository; `project.id` is its identity in the database (omit it for `local-fs`).

## setup collection

Configures the operating mode, the AI agents, and registers the project. Ask in this order.

1. **Mode** (table above). For `local-fs`, skip steps 2 and 3.
2. **DB connection** (`local-api` only): host `localhost`, name `laneconductor`, port `5432`, user
   `postgres`, password, SSL `n`. The password goes in `.env` as `DB_PASSWORD`, never in
   `.laneconductor.json`. Create the schema with the SQL in `legacy/db-schema.md`
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


## Daemon-era steps of `setup scaffold` (moved here from `setup/scaffold.md`)

The plugin's `setup/scaffold.md` no longer carries these. Do them only for the CLI wizard (`lc setup`).

### Runtime lines for `.gitignore`

Make sure `.gitignore` covers the sync-only runtime files that are never
  meaningful to review, only ever DB/API-synced state** — append whichever
  of these lines are missing (create the file if it doesn't exist):
  ```
  conductor/tracks/**/conversation.md
  conductor/tracks/**/conversation.json
  .conv-cursor
  .worktrees/
  conductor/.runs/
  .prespawn-block-count
  .prespawn-block-kind
  ```
  (Bare filenames — `.conv-cursor`, `.prespawn-block-count`,
  `.prespawn-block-kind` — match at any depth, the same way a
  path-prefixed `conductor/tracks/**/` spelling would; keep the bare form
  so a future reader can tell these are the same canonical pattern list
  `conductor/services/scaffold-gitignore.mjs` defines, not a hand-drifted
  copy.)
  `conversation.md`/`.json` hold comment threads that sync via the DB/API
  layer, not git; `.conv-cursor` (written by `laneconductor.sync.mjs`) is a
  per-track, per-machine sync cursor position; `.worktrees/` holds git
  worktree checkouts, which must never be tracked in the main tree at all —
  confirmed live on a sibling project: without this rule, 6 track worktrees
  ended up accidentally committed as git submodule-style gitlinks;
  `conductor/.runs/` holds per-run dispatch/pid-liveness markers;
  `.prespawn-block-count`/`.prespawn-block-kind` (written by
  `conductor/services/prespawn-block-counter.mjs`) are per-track counters.
  Left tracked, all of these show up as permanent "uncommitted changes"
  that trip the main-mode lane actions' clean-checkout gate and block every
  merge project-wide — not just the one track whose file happens to be
  dirty. This mirrors the exact patterns `lc setup` (CLI mode) already
  writes into `.gitignore` — do it here too, since skill-only mode (no `lc`
  CLI) never runs that code path and would otherwise accumulate the same
  problem with nothing preventing it. Do **not** add
  `conductor/tracks/**/index.md` here — unlike everything above, `index.md`
  carries real authored content (the track's Problem/Solution write-up)
  that IS worth tracking; a project that finds its own `index.md` diffs are
  pure marker-churn noise should decide that for itself, not inherit it
  silently from scaffolding.

### Link the skill into the project

Link the skill into this project so agents can invoke it locally. Skip this step when the
  skill is already provided by the LaneConductor plugin (this file's path contains `/plugins/` or
  `/.claude/plugins/`, not `<project>/.claude/skills/`): the plugin is the install, and the symlink would add a second copy. Link the **directory**
  (`-n` keeps `ln` from creating the link inside an existing directory link, which here would
  write into the skill folder itself):
  ```bash
  SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
  TARGET=".claude/skills/laneconductor"
  # Skip if this IS the laneconductor repo (the skill is the real directory here)
  if [ "$(realpath $TARGET 2>/dev/null)" = "$(realpath $SKILL_DIR 2>/dev/null)" ]; then
    echo "Skill already present (this is the laneconductor repo)"
  else
    mkdir -p .claude/skills .agents/skills .agents/rules
    ln -sfn "$SKILL_DIR" "$TARGET"
    ln -sfn "$SKILL_DIR" ".agents/skills/laneconductor"
    REPO_DIR=$(dirname $(dirname $(dirname "$SKILL_DIR")))
    ln -sf "$REPO_DIR/.agents/rules/laneconductor.md" ".agents/rules/laneconductor.md"
    echo "Skill and rules symlinked for Claude and Antigravity"
  fi
  ```
  On Windows without WSL use `mklink /D` or `mklink /J`, or copy the whole `laneconductor`
  folder (not just `SKILL.md`) into `.claude/skills/`.

The heartbeat worker (`laneconductor.sync.mjs`) is managed globally by `lc`; do not copy it into
the project's `conductor/` folder, and do not embed its code in a skill file (template
substitution of query placeholders corrupted that once).


### Import foreign tracks through the worker

After creating the structure, scan `conductor/tracks/` for folders that do not follow the
`NNN-slug` convention (for example Gemini conductor tracks like `feature_name_20260213/README.md`);
the heartbeat worker will not sync them. If you find any, ask: "Found N existing tracks from a
previous conductor tool. Import them as LaneConductor tracks? (y/n)". If yes, for each folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or
   `in-progress` -> `implement`; anything else -> `backlog`.
3. Assign the next free track number (continue from the highest existing `NNN-*` folder, or `001`).
4. Create `conductor/tracks/NNN-slug/index.md`:
   ```markdown
   # Track NNN: Title

   **Lane**: done
   **Lane Status**: success
   **Progress**: 100%
   **Last Run**: imported (n/a)
   **Summary**: Imported from previous conductor tool
   ```
5. Copy or symlink the original content alongside, or leave the original `README.md` in place.
6. Print `✅ Imported NNN tracks -> conductor/tracks/NNN-*/`. The worker picks them up on the next
   `lc start`.


### Environment check

After scaffolding, verify the environment: `chokidar` installed (`npm list chokidar`), git
present (`git rev-parse --is-inside-work-tree`, note `main` vs `master`), and the agents named in
`.laneconductor.json` (`claude`, `agy`, `gemini`) on the PATH. Report each problem as
`⚠️  Environment Issue: <description>` and ask "Would you like me to create Track 001 to track these
environment fixes? (y/n)". If yes, create `conductor/tracks/001-fix-environment/index.md`
(`**Lane**: backlog`, `**Lane Status**: queue`, `**Progress**: 0%`, a `**Summary**` naming the
gaps) and put the fixes (`npm install chokidar`, `git init`, ...) in its `plan.md`.

If `create_quality_gate` is `true` in `.laneconductor.json`, create `conductor/quality-gate.md` from
the template in `templates.md`, including its Test Layers section.


