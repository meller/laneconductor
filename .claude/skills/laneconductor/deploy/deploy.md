# deploy `[env]`, `status [env]`, `history [env]`, `rollback [env] [version]`

Run only when the user asks for it by name. A deploy or a rollback changes something live, so say which environment, which version and
which command you are about to run, and wait for a yes that names them. `status` and `history` only read. Nothing here runs from a build
step. Never write a secret into a record, a log or a message: a secret stays in the environment or in the provider login.

Before step 1, offer the stack's deploy pack if it is missing (usually silent, never blocking):

<!-- generated: skill offers for this lane -->

1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `defaultEnvironment`, else `prod`).
3. Show the environment (say so when it is production), the local build version, the commit, the exact command and "Shipped since the last deploy" (below), and ask. Uncommitted changes: say so first.
4. After the yes, run the command in the terminal and show its output.
5. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.
6. Write the record (below), also when the run failed. When it failed, follow "When a deploy fails".

## The record

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

## status `[env]`

Read only: no file changes and nothing is deployed. With no environment, cover every environment in `deploy.json`.

1. Local build version and short commit, as above.
2. Last record: the newest record of the environment with `result: success` (a good rollback counts). Name its version, commit, time, how long ago and who approved it. When a newer run failed, say it failed and is not live.
3. Live version: only when the environment sets `liveVersionUrl`, one read-only GET (for example `curl -fsS <url>`) and the field named by `liveVersionField`. When it cannot be read, say so. Without `liveVersionUrl`, say "the live version is not checked".
4. Commits ahead: `git rev-list --count <recorded commit>..HEAD`.
5. Compare, in this order: drift when the live version differs from the recorded version (someone deployed outside the records: change nothing, offer to look into it); else ahead when the local copy has commits since the record or its build version differs from the recorded one ("the local copy is ahead of the last deploy by N commits"); else in sync. Without a live version, in sync only means the local copy matches the last record: say the live server was not checked.
6. No record for the environment: say "No deploy recorded for <env>" and offer `deploy <env>`.

End with the next step as a command, not run: `deploy <env>` when ahead, `deploy rollback <env>` when the newest run failed or drift was found.

## history `[env]`

Read only. List the records of the environment, newest first, as a table: time, version, commit, result, who approved it, and a mark on the
live one (the newest with `result: success`). A rollback is an entry too (kind `rollback`), and a failed run is listed as failed. The
history is the list of versions: a version deployed twice appears twice.

## rollback `[env] [version]`

A rollback is a deploy of an older version, with its own record. Never `git reset` or a force push on main.

1. Read `deploy.json` and the records of the environment. With no version: list the versions as `history` does, only the ones with `result: success` (a failed run is not a version to go back to), mark the live one, and ask which version. Stop until the answer comes.
2. With a version (a version, a commit of at least 7 characters or a record file name): find the newest record with `result: success` that has it. None: say so, name the versions recorded and stop. Already live: say so and stop.
3. Show the exact command before anything runs. The strategy is: the environment's `rollback` command, with `{service}`, `{version}` and `{commit}` filled in (stop when it needs `service` and none is set); else, the default that is always available, redeploy that record's commit from a clean checkout: `git worktree add --detach /tmp/deploy-<env>-<commit> <commit>`, then in it the environment's deploy command, then `git worktree remove --force /tmp/deploy-<env>-<commit>`.
   Hints for the `rollback` key, labelled by what was checked: Cloud Run: `gcloud run services update-traffic <service> --to-revisions=<revision>=100` moves traffic to a named revision (verified in its help). Firebase Hosting: redeploy the older commit (the default), or `firebase hosting:clone <site>:<channel> <site>:live` when a channel holds the older version (the command exists; a console rollback was not verified).
4. Show the environment (production marked), the version, the commit and the command, and ask. Wait for a yes that names the environment, the version and the command, for example "yes, roll back prod to 1.0.0 with <command>". A bare "yes" is not enough: ask again naming them.
5. Run it, log it, write the record (`kind: rollback`, `restored record`), then show `status`. Ask whether to open a track for the cause with `new`; do not open one unasked.

## When a deploy fails

Nothing changes without a yes.

1. Read the last 40 lines of the log (`tail -n 40`) and the exit status. Name the failed step (the build, the login, the upload, a check after it) and the likely cause in a line or two, quoting only the log lines that show it, never one that looks like a secret.
2. Write the record with `result: failed` and say the live version did not change.
3. Offer a fix: what to change and the command. After a yes, apply it and re-run only the failed step, not the steps before it that succeeded; when the command is one script that cannot run a step alone, say so before re-running it whole.
4. When it works, finish the remaining steps and write a new record. When it does not, stop after one more attempt, show the log tail again and offer `rollback`.

## Shipped since the last deploy

Plain Markdown, no model. Take the time of the newest record of the environment with `result: success` (none: every finished track). For each
folder in `conductor/tracks/` whose `**Lane**` is `done`, take the date of the last dated line of its `history.md` (`- YYYY-MM-DD` or
`- YYYY-MM-DD HH:MMZ`; a date alone counts to the end of that day). List the tracks after that time, oldest first, as `- <id>: <title> (<date>)`
under `## Shipped since the last deploy`; a done track with no dated line is named apart, not guessed. Show it before the yes and keep it
under the record's header, so the history keeps what each version carried.
