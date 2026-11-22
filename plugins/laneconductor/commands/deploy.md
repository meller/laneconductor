---
description: Set up, run, check or roll back deployment for this project (runs only because you named it)
argument-hint: "[status | history | rollback | setup]"
---
Deploy: `$ARGUMENTS`. This runs only because I named it; do nothing else with it.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

Follow `deploy/deploy.md` (it covers `status`, `history` and `rollback` too), or `deploy/setup-deploy.md` when the action is `setup`; both are under "Reference" below. Show me each deploy command before you run it; never deploy or roll back without my yes.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `deploy/deploy.md`

Run only when the user asks for it by name. A deploy or a rollback changes something live, so say which environment, which version and
which command you are about to run, and wait for a yes that names them. `status` and `history` only read. Nothing here runs from a build
step. Never write a secret into a record, a log or a message: a secret stays in the environment or in the provider login.

Before step 1, offer the stack's deploy pack if it is missing (usually silent, never blocking):

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `deploy` lane (stack tags: firebase, cloudflare):

- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official`
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare`

1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `defaultEnvironment`, else `prod`).
3. Show the environment (say so when it is production), the local build version, the commit, the exact command and "Shipped since the last deploy" (below), and ask. Uncommitted changes: say so first.
4. After the yes, run the command in the terminal and show its output.
5. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.
6. Write the record (below), also when the run failed. When it failed, follow "When a deploy fails".

#### The record

Every deploy and every rollback ends with one small file, `conductor/deploys/<env>-<UTC timestamp>.md` (for example `prod-20261122T101500Z.md`),
kept in git so the history is shared. A short header of `key: value` lines, in this order:

```
environment: prod
time: 2026-11-22T10:15:00Z
commit: <short commit>
build version: <the local build version>
command: <the command from deploy.json, exactly>
result: success | failed
log: conductor/logs/deploy-prod-20261122T101500Z.log
approved by: <who said yes>
previous good record: <file name of the newest record with result success, or none>
```

Add `production: yes` for a production environment. A rollback adds `kind: rollback` and `restored record: <file name>`; its build version
and commit are the restored ones. Write it right after the run, show it and offer to commit it (never push). Read it back before you
write it: a value that looks like a token, a password or a key is never written; if the command itself holds one, stop and tell the
owner to move it out of `deploy.json`. Never edit or delete an old record.

The local build version is, in this order: the output of the environment's `version` command in `deploy.json`; the `version` in
`package.json`; `git describe --tags --always` (a tag, else the short commit).

Optional keys per environment in `deploy.json`: `rollback` (a command), `service` (the name a provider command needs), `version` (a command
that prints the local build version), `liveVersionUrl` (where the live server reports its version) and `liveVersionField` (the field of its
answer that holds it; default `version`).

#### status `[env]`

Read only: no file changes and nothing is deployed. With no environment, cover every environment in `deploy.json`.

1. Local build version and short commit, as above.
2. Last record: the newest record of the environment with `result: success` (a good rollback counts). Name its version, commit, time, how long ago and who approved it. When a newer run failed, say it failed and is not live.
3. Live version: only when the environment sets `liveVersionUrl`, one read-only GET (for example `curl -fsS <url>`) and the field named by `liveVersionField`. When it cannot be read, say so. Without `liveVersionUrl`, say "the live version is not checked".
4. Commits ahead: `git rev-list --count <recorded commit>..HEAD`.
5. Compare, in this order: drift when the live version differs from the recorded version (someone deployed outside the records: change nothing, offer to look into it); else ahead when the local copy has commits since the record or its build version differs from the recorded one ("the local copy is ahead of the last deploy by N commits"); else in sync. Without a live version, in sync only means the local copy matches the last record: say the live server was not checked.
6. No record for the environment: say "No deploy recorded for <env>" and offer `deploy <env>`.

End with the next step as a command, not run: `deploy <env>` when ahead, `deploy rollback <env>` when the newest run failed or drift was found.

#### history `[env]`

Read only. List the records of the environment, newest first, as a table: time, version, commit, result, who approved it, and a mark on the
live one (the newest with `result: success`). A rollback is an entry too (kind `rollback`), and a failed run is listed as failed. The
history is the list of versions: a version deployed twice appears twice.

#### rollback `[env] [version]`

A rollback is a deploy of an older version, with its own record. Never `git reset` or a force push on main.

1. Read `deploy.json` and the records of the environment. With no version: list the versions as `history` does, only the ones with `result: success` (a failed run is not a version to go back to), mark the live one, and ask which version. Stop until the answer comes.
2. With a version (a version, a commit of at least 7 characters or a record file name): find the newest record with `result: success` that has it. None: say so, name the versions recorded and stop. Already live: say so and stop.
3. Show the exact command before anything runs. The strategy is: the environment's `rollback` command, with `{service}`, `{version}` and `{commit}` filled in (stop when it needs `service` and none is set); else, the default that is always available, redeploy that record's commit from a clean checkout: `git worktree add --detach /tmp/deploy-<env>-<commit> <commit>`, then in it the environment's deploy command, then `git worktree remove --force /tmp/deploy-<env>-<commit>`.
   Hints for the `rollback` key, labelled by what was checked: Cloud Run: `gcloud run services update-traffic <service> --to-revisions=<revision>=100` moves traffic to a named revision (verified in its help). Firebase Hosting: redeploy the older commit (the default), or `firebase hosting:clone <site>:<channel> <site>:live` when a channel holds the older version (the command exists; a console rollback was not verified).
4. Show the environment (production marked), the version, the commit and the command, and ask. Wait for a yes that names the environment, the version and the command, for example "yes, roll back prod to 1.0.0 with <command>". A bare "yes" is not enough: ask again naming them.
5. Run it, log it, write the record (`kind: rollback`, `restored record`), then show `status`. Ask whether to open a track for the cause with `new`; do not open one unasked.

#### When a deploy fails

Nothing changes without a yes.

1. Read the last 40 lines of the log (`tail -n 40`) and the exit status. Name the failed step (the build, the login, the upload, a check after it) and the likely cause in a line or two, quoting only the log lines that show it, never one that looks like a secret.
2. Write the record with `result: failed` and say the live version did not change.
3. Offer a fix: what to change and the command. After a yes, apply it and re-run only the failed step, not the steps before it that succeeded; when the command is one script that cannot run a step alone, say so before re-running it whole.
4. When it works, finish the remaining steps and write a new record. When it does not, stop after one more attempt, show the log tail again and offer `rollback`.

#### Shipped since the last deploy

Plain Markdown, no model. Take the time of the newest record of the environment with `result: success` (none: every finished track). For each
folder in `conductor/tracks/` whose `**Lane**` is `done`, take the date of the last dated line of its `history.md` (`- YYYY-MM-DD` or
`- YYYY-MM-DD HH:MMZ`; a date alone counts to the end of that day). List the tracks after that time, oldest first, as `- <id>: <title> (<date>)`
under `## Shipped since the last deploy`; a done track with no dated line is named apart, not guessed. Show it before the yes and keep it
under the record's header, so the history keeps what each version carried.

### `deploy/setup-deploy.md`

Run only when the user asks for it by name. This is a chat procedure: you scan, ask, and then write the files.
It runs nothing that changes anything outside the project, and it never asks for or reads a secret.
Once you know the stack (step 1), offer its deploy pack if it is missing, as `deploy.md` says: one plain offer, never a block.

1. **Scan for deployment signals.** Look for `deploy.sh`, `Dockerfile`, `firebase.json`, `vercel.json`, `infra/`, CI files
   and the hosting hints in `package.json`, and read `conductor/deployment-stack.md` if it exists. Say what you found.
2. **Ask, one question at a time, with a likely default:** which component runs where (frontend, backend, database, secrets),
   the environments (usually `prod`, optionally `staging`), the deploy command (default: the script you found, for example
   `bash infra/deploy.sh`), and whether CI/CD should deploy too. Then, per environment and only if the person wants them, the optional keys
   `rollback` (a command that goes back to a version), `service` (the name a provider command needs), `version` (a command that prints the
   local build version) and `liveVersionUrl` (where the live server reports its version, for example `https://example.com/version.json`;
   a static site can ship a small `version.json` with the commit and the time). Leave out what they do not know.
3. **Credentials.** Ask whether the person is signed in to each provider. You may run a read-only status command (for
   example `gcloud auth list`) after a yes; never ask for, read or write a key or token. Whatever is not signed in is
   marked `NOT CONFIGURED` with the command the person runs themselves.
4. **Show the plan and get a yes.** List the files you will create (`conductor/deployment-stack.md`,
   `conductor/deploy.json`, `.env.example`, and the `.gitignore` additions; deploy records go to `conductor/deploys/` later, one per run, and are not created now) and which of them already exist; never overwrite
   one without asking.
5. **Generate the files**, from what you gathered, as below. The gathered facts have this shape:
```json
{
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "environments": ["prod", "staging"],
  "deploy_command": "bash infra/deploy.sh",
  "cicd": false,
  "credentials": { "gcp": "verified (user@example.com)", "firebase": "verified" },
  "existing_signals": ["deploy.sh", "Dockerfile", "firebase.json"]
}
```

**Generate each file listed in `files_to_create`:**

**`conductor/deployment-stack.md`** — Full human-readable topology:
```markdown
# Deployment Stack

## Provider
[derived from components]

## Environments
[list each environment with region/project if detectable]

## Services
- Frontend: [component]
- Backend: [component]
- Database: [component]
- Secrets: [component]

## Authentication
[credentials entry from context — verified ✅ or NOT CONFIGURED]

## Deploy Command
`deploy prod`  →  [deploy_command] prod
```

**`conductor/deploy.json`** — Machine-readable config:
```json
{
  "environments": {
    "prod": { "command": "[deploy_command] prod" },
    "staging": { "command": "[deploy_command] staging" }
  },
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "secrets": {
    "strategy": "[derive from secrets component]",
    "keys": []
  },
  "ci": null
}
```
Add the optional keys (`rollback`, `service`, `version`, `liveVersionUrl`) to an environment only when the person gave them.
Set `"ci": null` unless `cicd` is `true` in context (in which case add CI config block).

**`.env.example`** — Required CI env var names only, **never actual values**:
- GCP: `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT`, `GCP_REGION`
- Firebase: `FIREBASE_TOKEN` (for CI; locally use ADC)
- Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Supabase: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
Include only providers relevant to the selected components.

**`.gitignore`** — Append if not already present:
```
.env
*.tfvars
*-key.json
service-account*.json
```

**After writing all files, print:**
```
✅ Deployment stack configured!
   Deploy with: ask for `deploy prod` or `deploy staging` (the command runs only after a yes)
```
And list any credentials marked `NOT CONFIGURED` with their setup commands.
