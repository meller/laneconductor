# Spec: deployment in the plugin (AM-10156)

## Problem Statement
Deploying is the riskiest thing a project does, and the plugin treats it as one command with a yes. After it runs, nothing says what is live, which version, since when, or how to go back. The earlier version had a lot of this; the plugin era needs it as plain files plus Claude plus the board, not as a daemon and a database.

## What exists today (verified 2026-11-22)
- Base plugin: `/laneconductor:deploy [env]` and `setup-deploy`: `conductor/deploy.json` (a command per environment), `conductor/deployment-stack.md` (the topology), a log in `conductor/logs/deploy-<env>-<timestamp>.log`, run only on the owner's yes, never from a build step.
- Board: the Project button has a Deployment tab built from `deployment-stack.md`.
- No deploy history, no version per environment, no rollback, no failure help.

## What the earlier version had (git tag `v1-legacy`, read only)
- A shared runner of the configured command per environment with a log (`conductor/deploy-runner.mjs`, `deployConfig.mjs`), tested.
- A CI/CD tab: deploy config, dispatch history, a `deploy.sh` builder (tracks 1092, 1098, done).
- An AI error-recovery loop for a failed deploy, re-running only the failed step (track 1065, backlog).
- Build artifacts and release notes made from the finished tracks (track 1097, backlog).
- Not brought: the daemon, the database, the dispatch queue, the UI server.

## Requirements
- REQ-1 Deploy record: every deploy and every rollback writes one small record, `conductor/deploys/<env>-<timestamp>.md`: environment, time, commit, the local build version at that moment (package version, tag or plugin version when found, else the short commit), the command from `deploy.json` (never a secret), result, the log path, who said yes, and the previous good record. Tracked in git so the history is shared; the secret scan applies.
- REQ-2 `/laneconductor:deploy status [env]`: read only; compares three versions per environment: the local build version (what the working copy would deploy now), the last recorded deploy (its commit, version and age), and, when the environment names a live version address, the version the live server reports. It says whether they are in sync, how many commits the local copy is ahead of the last deploy, or whether the live version differs from the record (someone deployed outside the records).
- REQ-3 `/laneconductor:deploy rollback [env] [version]`: with a version it goes back to that version's record (any good record, not only the previous one); without one it lists the versions (the history) and asks which. It shows the exact command first and runs it only after the owner's yes naming the environment, version and command. Strategies per environment in `deploy.json` (optional keys, see D3): a rollback command, or redeploy the chosen version's commit from a clean checkout; never `git reset` or a force push on main.
- REQ-3b `/laneconductor:deploy history [env]`: the history is the list of deployed versions, newest first: time, version, commit, result, who said yes, and which one is live now.
- REQ-4 Failure recovery: when a deploy fails, read the tail of its log, name the failed step and the likely cause, offer a fix; after a yes and the fix, re-run only the failed step. Nothing is changed without a yes.
- REQ-5 Versions and release notes: the record carries the version; "shipped since the last deploy" lists the tracks finished since the previous good record, from the tracks' history, as plain Markdown with no model.
- REQ-6 Board: the Deployment tab (Project button) shows, per environment, the live version, time, result, the history and a Copy button for the next step (deploy, rollback), like the other cards. Board add-on only.
- REQ-7 Safety: every deploy or rollback needs the owner's yes naming environment and command; production is marked; nothing runs from a build step; secrets are never written into records, logs shown or the board.
- REQ-8 Where it lives: command text in the base plugin (Markdown only, no scripts); the tab in the board add-on. Every base text change makes another version for the Anthropic review, so the base changes ship as one release.

## Probe findings (2026-11-22, plan lane, read only)
- The earlier `conductor/deploy.json` is `{ "defaultEnvironment": "...", "environments": { "<env>": { "command": "...", "description": "..." } } }`; its providers were Firebase Hosting (`firebase deploy --only hosting --project <slug>-<env>`) and GCP Cloud Run (`gcloud run deploy <slug>-<env> --source . --region ...`); track 1065 also handled a `commands` list per environment.
- The earlier build artifact (track 1097, `conductor/builds/<id>.json`) held id, time, git commit and branch, the track numbers, and a release-notes Markdown grouped into features, fixes and improvements.
- Track 1065 (error recovery) asked for: the output of each failed step captured, recovery opt-in and never implicit, retry inside the step loop, only the failed step re-run, non-interactive safety.
- Today's base `deploy` text logs to `conductor/logs/deploy-<env>-<timestamp>.log` and nothing else: no record, no version, no rollback.
- Rollback tools on this machine (their own help output): `gcloud run services update-traffic SERVICE --to-revisions=REVISION=100` moves Cloud Run traffic back to a named revision; the Firebase CLI here has `hosting:clone <site>:<channel> <site>:live` (copies a channel's content to live) and channels, but no rollback command in its help; the rollback of a Hosting release in the console was not checked.

## Decisions (2026-11-22, plan lane; proposed defaults, the owner confirms in task 2)
- D1 Records are Markdown files `conductor/deploys/<env>-<UTC timestamp>.md` with a short header of `key: value` lines (environment, time, commit, version, command, result, log, approved by, previous good record), tracked in git so the history is shared. Secrets are never written; the command is the one in `deploy.json`.
- D2 One command, subcommands: `/laneconductor:deploy [env]`, `deploy status [env]`, `deploy rollback [env]`, `deploy history [env]`. No new command files: only the `deploy` text grows, which keeps the base change small.
- D3 `deploy.json` gains optional keys per environment: `rollback` (a command), `service` (the name a provider command needs), `version` (how to read the local build version) and `liveVersionUrl` (where the live version is reported). The default rollback strategy, always available, is to redeploy the previous good record's commit from a clean checkout. Provider hints, labelled by what was verified: Cloud Run traffic to the previous revision (verified in gcloud help); Firebase Hosting: redeploy the previous commit, or clone a channel that holds the previous version to live (the clone command exists; a console rollback is not verified here). Never `git reset` or a force push on main.
- D4 What comes from the earlier version: records and status (new), rollback (new), failure recovery (the 1065 idea in plain steps: read the log tail, name the failed step, offer a fix, re-run only that step after a yes), release notes (the 1097 idea, as Markdown from the tracks finished since the previous good record, no model, no JSON artifact), and a Deployment tab. What stays in the tag: the daemon, the database, the dispatch queue, the deploy UI server, the build artifact JSON files (replaced by the records) and the `deploy.sh` builder.
- D5 Version: from `package.json`, a git tag or the plugin version when one is found; otherwise the short commit.
- D6 Approvals: every deploy and every rollback needs the owner's yes naming the environment and the exact command; production is marked in the record; nothing runs from a build step.
- D7 The base text changes (deploy.md and setup-deploy.md) ship as one base release; the Deployment tab is a board add-on release.
- D8 The first real use is this site's Firebase Hosting deploys (`firebase deploy --only hosting --project laneconductor-site` from a clean copy of main): write their records, answer `status`, and show the rollback prompt without running it.

## Confirmed by the owner (2026-11-22, plan task 2)
- D1 confirmed: the records are kept in git, which is new (there were none).
- D2 confirmed: one command with subcommands (`deploy`, `deploy status`, `deploy rollback`, `deploy history`).
- D4 confirmed: the scope of what is brought from the earlier version and what stays in the tag ("this is what I want").
- D9 (owner) The rollback chooses the version: `rollback [env] [version]`; without a version it lists the versions and asks. The history is the list of versions (REQ-3b); a deploy of a version is an entry in it, a rollback is an entry too.
- D10 (owner) The local build version is kept and compared with the deployed one: a `version` setting per environment in `deploy.json` says how to read the local build version (a command; default the package version or the short commit), and an optional `liveVersionUrl` says where the live server reports its version (a read-only GET of a version file or health answer; the field to read is named). `deploy status` shows local, last recorded and live side by side and flags drift. For a static site the deploy copy gets a small `version.json` (commit and time) at deploy time so the live site can answer.

## Decisions still open
- Whether a rollback should also open a track for the cause.
- How many environments this project has (the site has one, production).

## Out of scope
A daemon or dispatch queue, a deploy UI server, CI runners, automatic deploys, dollar costs, secrets handling.

## Open questions
- Which environments does this project really have (this site has one production hosting target)?
- Should a rollback also create a track for the cause?

## Details chosen while implementing (2026-11-22, implement lane; the owner may change them)
- D11 The record file name is `<env>-<YYYYMMDDTHHMMSSZ>.md` (no colons). Beyond the nine header lines of REQ-1 a record may carry `production: yes`, `kind: rollback` and `restored record: <file>`; a rollback record holds the restored version and commit, so the live version after a rollback is that version. `deploy.json` also reads `liveVersionField` (the field of the live answer that holds the version; default `version`), because D10 says the field is named: a fifth optional key. A date-only line in a track's history counts to the end of that day for "shipped since the last deploy". The default rollback strategy checks the commit out with `git worktree add --detach /tmp/deploy-<env>-<commit>` and removes it afterwards with `git worktree remove --force`. After a rollback the text asks whether to open a track for the cause (it opens none); that was an open question, so the owner decides whether the question stays.
- The Deployment tab reads the records when the board is built and never asks the live server (that is `deploy status`).
