# Track 1096: Choose/change a worker's CLI + model from the UI

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: New — reported, not yet investigated or planned
**Type**: dev
**Summary**: No UI exists to choose a worker's CLI/model when starting one, or to change an existing worker's model assignment afterward — today it's CLI-only, via .laneconductor.json's primary/secondary config and lc worker start flags.

## Problem

Raised while reviewing track 1091 (Manager Worker Type & New-Project Flow)
— out of scope there, since 1091 is specifically about the manager worker
type and new-project flow, not general worker configuration; applies to
every worker, not just manager workers.

Today, a worker's CLI (`claude`/`antigravity`/etc.) and model come from
`.laneconductor.json`'s `project.primary`/`project.secondary` config,
set only via `lc setup`'s CLI wizard or by hand-editing the file. There's
no UI path to:
1. Choose which CLI/model a *new* worker should use when starting one
   from the app.
2. Change an *existing* worker's model assignment afterward, without
   editing `.laneconductor.json` directly and restarting the worker.

Not yet investigated: how per-lane model overrides (`workflow.json`'s
`primary_model` per lane) interact with a worker-level default, and
whether "worker's model" should mean the whole worker's default or
something that can vary in-flight.

## Depends on

Possibly related to [1089](../1089-remote-worker-provisioning/index.md)
(activating a worker on a remote machine from the app) and
[1091](../1091-manager-worker-and-new-project-flow/index.md) (new-worker
creation flow) — worth checking during planning whether this should be a
shared step in both rather than fully separate.
