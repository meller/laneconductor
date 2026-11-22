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

## Decisions to settle in the plan lane
- Which legacy pieces are worth bringing, and which stay in the tag (the list above is a proposal).
- Record format and place (Markdown with a small header, or JSON lines), tracked or git-ignored.
- Rollback strategies per stack (Firebase Hosting release rollback, Cloud Run revisions, redeploy of a previous commit); what `deploy.json` gains (`rollback`, `version`).
- Subcommands of `deploy` (`status`, `rollback`, `history`) or separate commands, given that every new command adds base text.
- Whether `status` needs a script (a read of the records may be enough).

## Out of scope
A daemon or dispatch queue, a deploy UI server, CI runners, automatic deploys, dollar costs, secrets handling.

## Open questions
- Which environments does this project really have (this site has one production hosting target)?
- Should a rollback also create a track for the cause?
