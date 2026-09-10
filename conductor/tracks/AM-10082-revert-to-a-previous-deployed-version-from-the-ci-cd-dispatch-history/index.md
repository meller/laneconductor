# Track AM-10082: Revert to a previous deployed version from the CI/CD dispatch history

**Lane**: done
**Merge Mode**: direct
**Lane Status**: success
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Planned (5 phases)
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Add a "Redeploy this version" action on past entries in the CI/CD Release tab's deployment dispatch history, so a bad deploy can be rolled back to a known-good prior commit without hand-editing…

## Problem

Today `conductor/deploy.json`'s deploy always targets whatever is at
`Workspace HEAD` (or a manually-selected Build Artifact) at dispatch time —
there is no one-click way to go back to a previous release after a bad
deploy. Verified live 2026-09-08 running a real production deploy through
the UI: the mechanism (worker_dispatch → deploy-runner.mjs, same as `lc
deploy`) works end-to-end, but "undo" doesn't exist anywhere in it.

The foundation already exists, just not wired to "revert":
- **Build artifacts** (track 1097, `conductor/builds/<id>.json`) already
  record the exact git commit a release was built from
  (`git.commit`/`shortCommit`/`branch`), plus which tracks shipped in it
  and AI-synthesized release notes. Two real build artifacts exist in this
  repo right now (`conductor/builds/build-20260810-*.json`).
- **Dispatch history** (tracks 1085/1092/1098, `DispatchHistory` in
  `CICDView.jsx`) already lists every past deploy dispatch with its
  environment, worker, and timestamp.
- The CI/CD Release tab's `Workspace HEAD` / `Build Artifact` toggle
  (verified live) already supports deploying a specific artifact instead
  of HEAD — the missing piece is surfacing "deploy this specific past
  one again" as a direct action on a history row, not just via the
  artifact picker.

## Important asymmetry to design around, not assume away

Reverting the **hosting** half of a deploy is safe and straightforward:
redeploy the old commit's built static assets (or, better, use Firebase
Hosting's own native version history/rollback — `firebase hosting:clone`
or the console's "rollback" — since Hosting already keeps every prior
release immutable and instantly reactivatable, likely cheaper and safer
than rebuilding from an old commit).

Reverting the **database migration** half is NOT generally safe or
symmetric. `scripts/deploy.sh`'s `[1/4]` step runs `atlas migrate apply`
forward-only; there is no down-migration path verified anywhere in this
repo, and even if one existed, rolling a schema back after real production
writes have landed against the new schema can lose or corrupt data (e.g.
track AM-10074's migration, applied live during this session's own deploy
test, de-duplicates rows in `api_tokens` before adding a unique index —
that dedup is not reversible). "Revert to version" must not silently
imply "and undo the migration too" — scope this explicitly: hosting
rollback is the safe, buildable v1; DB rollback (if ever attempted) needs
its own explicit, separately-confirmed path, likely requiring a human to
decide per-migration whether reverting is even safe.

## Scope

1. **"Redeploy this version" action on each dispatch-history row** (or
   each build artifact) that ran a successful deploy — dispatches a new
   deploy targeting that entry's recorded git commit instead of current
   HEAD.
2. **Investigate Firebase Hosting's native rollback** (`firebase
   hosting:clone`, or the equivalent gcloud/console action) as the actual
   mechanism for the hosting half, rather than rebuilding from an old
   commit — likely faster, cheaper, and exactly what Hosting's own
   versioning model is for.
3. **Database rollback is explicitly OUT of scope for this track — decided, not deferred.** "Redeploy this version" only re-runs the hosting half; it must never touch `atlas migrate apply` or attempt to undo a migration. Make this obvious in the UI itself (e.g. the action's own label/tooltip says "hosting only" and, if the target commit's deploy included a migration, a visible note that the DB is not being rolled back). If DB rollback is ever wanted, it needs its own separate track — the per-migration reversibility judgment call is a different, harder problem than this one.
4. **Surface this for every deploy-history entry that has a recorded
   commit**, not just ones explicitly tagged as a "build artifact" — a
   plain `Workspace HEAD` deploy's dispatch history row should ideally
   also record the commit it ran against (check whether it already does;
   if not, that's a small addition needed here) so revert isn't limited to
   only the two tracks that happened to use the build-artifact picker.

## Depends on
[1085](../1085-manual-worker-dispatch/index.md) — the dispatch mechanism this reuses.
[1092](../1092-deploy-config-ui/index.md), [1098](../1098-targeted-build-deployment/index.md) — the Release tab / dispatch history UI this adds an action to.
[1097](../1097-build-artifact-system/index.md) — the git-commit-per-build tracking this builds on.
**Auto Run**: yes
