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
- REQ-1 Deploy record: every deploy and every rollback writes one small record, `conductor/deploys/<env>-<timestamp>.md` (or the format settled in Phase 1): environment, time, commit, version (package version, tag or plugin version when found), the command from `deploy.json` (never a secret), result, the log path, who said yes, and the previous good record. Tracked in git so the history is shared; the secret scan applies.
- REQ-2 `/laneconductor:deploy status [env]`: read only; what is live per environment (last successful record, its commit, version and age) and how many commits main is ahead of it.
- REQ-3 `/laneconductor:deploy rollback [env]`: shows the previous good record and the exact command, runs only after the owner's yes naming the environment and command. Strategies per environment in `deploy.json` (new optional `rollback` key): a hosting rollback command, or redeploy the previous good commit from a clean checkout; never `git reset` or a force push on main.
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
- D3 `deploy.json` gains optional keys per environment: `rollback` (a command) and `service` (the name a provider command needs). The default rollback strategy, always available, is to redeploy the previous good record's commit from a clean checkout. Provider hints, labelled by what was verified: Cloud Run traffic to the previous revision (verified in gcloud help); Firebase Hosting: redeploy the previous commit, or clone a channel that holds the previous version to live (the clone command exists; a console rollback is not verified here). Never `git reset` or a force push on main.
- D4 What comes from the earlier version: records and status (new), rollback (new), failure recovery (the 1065 idea in plain steps: read the log tail, name the failed step, offer a fix, re-run only that step after a yes), release notes (the 1097 idea, as Markdown from the tracks finished since the previous good record, no model, no JSON artifact), and a Deployment tab. What stays in the tag: the daemon, the database, the dispatch queue, the deploy UI server, the build artifact JSON files (replaced by the records) and the `deploy.sh` builder.
- D5 Version: from `package.json`, a git tag or the plugin version when one is found; otherwise the short commit.
- D6 Approvals: every deploy and every rollback needs the owner's yes naming the environment and the exact command; production is marked in the record; nothing runs from a build step.
- D7 The base text changes (deploy.md and setup-deploy.md) ship as one base release; the Deployment tab is a board add-on release.
- D8 The first real use is this site's Firebase Hosting deploys (`firebase deploy --only hosting --project laneconductor-site` from a clean copy of main): write their records, answer `status`, and show the rollback prompt without running it.

## Needed from the owner (plan task 2)
- Confirm D1 (records tracked in git) and D2 (subcommands of `deploy`).
- Confirm the scope of D4: what is brought and what stays in the tag.

## Decisions still open
- Whether a rollback should also open a track for the cause.
- How many environments this project has (the site has one, production).

## Out of scope
A daemon or dispatch queue, a deploy UI server, CI runners, automatic deploys, dollar costs, secrets handling.

## Open questions
- Which environments does this project really have (this site has one production hosting target)?
- Should a rollback also create a track for the cause?
