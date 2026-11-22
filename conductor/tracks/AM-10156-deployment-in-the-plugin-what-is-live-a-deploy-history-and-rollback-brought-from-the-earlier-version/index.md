# Track AM-10156: Deployment in the plugin: what is live, a deploy history and rollback, brought from the earlier version

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: All 11 tasks done 2026-11-22: records, status, history, rollback, the Deployment tab, base 1.9.17 pushed, this site deployed with a record and version.json; ready for review.
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: The plugin can run a deploy on the owner's yes (`/laneconductor:deploy [env]`, with `deploy.json` and `deployment-stack.md`), but it keeps no record of what was deployed, cannot say what is live in each environment or which version, and has no rollback. The earlier version of LaneConductor (git tag `v1-legacy`) had much more: a runner with per-environment config and logs, a deploy tab with dispatch history, an error-recovery loop, build artifacts and release notes. The owner wants the useful parts brought into the plugin era (files in git, Claude plus the board), so a project has its commands, its versions, its history and a rollback.
**Summary**: A deploy record per run (environment, time, commit, version, command without secrets, result, log, the previous good record), a read-only `deploy status`, a `rollback` that shows the previous good version and the exact command and runs only on the owner's yes, failure recovery that names the failed step and re-runs only that step, release notes of the tracks finished since the last deploy, and a Deployment tab on the board next to Project and What next. Base text stays Markdown only; the tab lives in the board add-on. Related, from the earlier version and not extended: 1062 and 1098 (deploy context, CI/CD tab, done), 1065 (error recovery, backlog), 1097 (build artifacts and release notes, backlog).
