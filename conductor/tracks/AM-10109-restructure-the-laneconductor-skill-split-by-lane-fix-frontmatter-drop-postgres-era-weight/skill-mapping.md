# Skill restructure mapping (track 10109)

Every heading (levels 1-3, outside code fences) of the pre-restructure SKILL.md (commit 20843334,
2,392 lines) and where its content went. Checked by the heading-coverage case in
`conductor/tests/track-10109-skill-structure.test.mjs`: each old heading must appear below, and
each named destination file must exist.

Frontmatter (lines 1-84): the `parameters` block is deleted (not a documented field);
`user-invocable: true` is dropped (the default); `description` is rewritten and `when_to_use` and
`argument-hint` added. The superpowers MIT attribution comment (line 85) is kept in `SKILL.md`.

| Old line | Old heading | What happened | Where it is now |
|---|---|---|---|
| 87 | LaneConductor Skill | rewritten | `SKILL.md` (one-line purpose; the Postgres tagline is deleted) |
| 91 | Modes of Operation | deleted | `SKILL.md` says it works with or without a worker |
| 98 | Universal CLI (`lc`) | moved, pruned | `legacy/worker.md` (kept: `worker run` vs `--sync-and-work` warning, Auto Run gate, add-target syntax); `lc track-dir`/`lc new`/`lc move`/`lc status` are in `SKILL.md` and `ops/tracks.md` |
| 102 | Installation | deleted | `lc` install line; the install is in `setup/setup.md` |
| 108 | Core Commands | moved, pruned | `legacy/worker.md` |
| 145 | Installation (one-time, per machine) | moved | `setup/setup.md` (adds: copy the whole folder for non-symlink installs) |
| 165 | Architecture | deleted | stale Postgres architecture diagram; `conductor/product.md` is the architecture source |
| 193 | Protocol: conversation.md Format (required for sync) | condensed | `SKILL.md` (conversation.md format) |
| 234 | Protocol: Session Continuity (skip re-reading context on resume) | condensed | `SKILL.md` (Session continuity) |
| 288 | Protocol: Locating Tracks | condensed | `SKILL.md` (Finding a track) |
| 322 | Core Commands | deleted | container heading only |
| 324 | `/laneconductor setup` | moved | `setup/setup.md` |
| 349 | `/laneconductor setup scaffold generate` | moved | `setup/scaffold.md` (templates in `setup/templates.md`) |
| 561 | `/laneconductor setup scaffold` | moved | `setup/scaffold.md` (`.gitignore` fence word-for-word) |
| 768 | `/laneconductor setup collection` | moved, pruned | `setup/setup.md` (dated model names deleted; LC-cloud 10052 warning kept; schema SQL in `legacy/db-schema.md`) |
| 965 | Lane Action State Machine & Dynamic Boundaries | split | `SKILL.md` (Lanes and transitions) and each lane's own boundary in `lanes/*.md` |
| 969 | 🛑 CRITICAL: Boundary Rules | split | `SKILL.md` (Lanes and transitions) and each `lanes/*.md` |
| 985 | `/laneconductor activate` (or `start`) [--sync-and-work] | moved | `legacy/worker.md` (activate / start) |
| 1003 | `/laneconductor deactivate` (or `stop`) | moved | `legacy/worker.md` (kill script replaced by `lc worker stop`) |
| 1020 | `/laneconductor status` | moved, pruned | `ops/tracks.md` (status; ASCII board deleted) |
| 1054 | `/laneconductor workflow` | moved, pruned | `ops/tracks.md` (workflow; ASCII table deleted, lane names corrected) |
| 1077 | `/laneconductor workflow set [lane] [key] [value]` | moved | `ops/tracks.md` (workflow set; valid lane names and `lane:status` corrected) |
| 1101 | `/laneconductor setup-deploy generate` | moved | `deploy/setup-deploy.md` |
| 1217 | `/laneconductor deploy [env]` | moved | `deploy/deploy.md` |
| 1229 | The Filesystem-as-API Interface | condensed | `SKILL.md` (Markers in index.md); `**Status**` row deleted; per-lane marker detail in `lanes/plan.md`, `lanes/review.md`, `lanes/quality-gate.md`, `lanes/merge.md` |
| 1250 | Completion Comment Convention | condensed | `SKILL.md` (Completion comment) and each lane's own completion comment |
| 1269 | `/laneconductor qualityGate [track_number]` | deleted | stale short duplicate (it said PASS -> `done` + `success`); `qualityGate` is now an alias row routing to `lanes/quality-gate.md` |
| 1288 | `/laneconductor move [track-number] [lane:status]` | moved | `ops/tracks.md` |
| 1306 | `/laneconductor pulse [track-number] [status] [progress%] [summary?]` | moved | `ops/tracks.md` (no longer writes `**Status**`) |
| 1322 | `/laneconductor newTrack [name] [description]` | moved | `ops/tracks.md` |
| 1380 | `/laneconductor lock [track-number]` | moved | `legacy/worker.md` (lock / unlock; pseudo-code replaced by `conductor/lock.mjs`) |
| 1394 | `/laneconductor unlock [track-number]` | moved | `legacy/worker.md` (lock / unlock) |
| 1411 | `/laneconductor plan [track-number]` | moved | `lanes/plan.md` (step 6 pulse deleted) |
| 1517 | `/laneconductor brainstorm [track-number]` | moved | `lanes/brainstorm.md` |
| 1542 | `/laneconductor implement [track-number]` | moved | `lanes/implement.md` (duplicate background rule merged; `**Status**: implement` write deleted) |
| 1668 | `/laneconductor review [track-number]` | moved | `lanes/review.md` |
| 1707 | `/laneconductor quality-gate [track-number]` | moved | `lanes/quality-gate.md` |
| 1836 | `/laneconductor merge [track-number]` | moved | `lanes/merge.md` |
| 1928 | `/laneconductor remote-sync [track-number?]` | deleted | duplicate first copy of remote-sync |
| 1940 | `/laneconductor comment [track-number] [body]` | moved | `ops/tracks.md` |
| 1949 | `/laneconductor delete [track-number]` | moved | `ops/tracks.md` (lock path corrected to `.conductor/locks/`) |
| 1964 | `/laneconductor revert [track] [phase] [task?]` | moved | `ops/tracks.md` |
| 1974 | `/laneconductor syncdb [--source <url>] [--target <url>]` | moved | `legacy/syncdb.md` |
| 2014 | `/laneconductor remote-sync [track-num?]` | moved | `legacy/remote-sync.md` |
| 2055 | `/laneconductor init-tracks-summary` | reduced | `ops/tracks.md` (one paragraph; output example and benefits deleted) |
| 2111 | Track File Templates | moved | `lanes/plan.md` (spec, plan, test templates) and `lanes/implement.md` (test.md template) |
| 2113 | `plan.md` | moved | `lanes/plan.md` |
| 2129 | `spec.md` | moved | `lanes/plan.md` |
| 2146 | `index.md` | deleted | its template wrote `**Status**: backlog`; `newTrack` in `ops/tracks.md` has the real index.md template |
| 2163 | `test.md` | moved | `lanes/plan.md` and `lanes/implement.md` |
| 2169 | Run all tests | moved | inside the test.md template in `lanes/plan.md` and `lanes/implement.md` |
| 2172 | Run specific test file | moved | inside the test.md template in `lanes/plan.md` and `lanes/implement.md` |
| 2189 | DB Schema Reference | moved | `legacy/db-schema.md` (Copy B) |
| 2226 | Status Badges → Lane Mapping | deleted | heuristic fallback that only applies when `**Lane**` is missing; every lane writes `**Lane**`; the `## ✅ REVIEWED` and similar headings stay in their lane files |
| 2243 | Multi-Project Notes | deleted | Postgres-era; one `.laneconductor.json` per repo is in `setup/setup.md` |
| 2253 | Commit Convention | condensed | `SKILL.md` (one line) |
| 2264 | Handling Automation Failures | moved | `legacy/worker.md` (corrected to `workflow.json` `max_retries`) |
| 2280 | Dev Logging (Worker + API) | moved | `legacy/worker.md` (port 6201 rule kept) |
| 2322 | Best Practices | deleted | #2 names a command that does not exist (`summarize`); #3 (progress from plan.md checkboxes) is a `SKILL.md` marker-table line |
| 2328 | Quick Reference | replaced | the routing table in `SKILL.md` |
| 2366 | Operating Mode Configuration | moved | `setup/setup.md` (Operating modes) |
| 2370 | 1. local-fs (pure filesystem) | moved | `setup/setup.md` (Operating modes) |
| 2376 | 2. local-api (local Postgres + Kanban UI) | moved | `setup/setup.md` (Operating modes) |
| 2382 | 3. remote-api (cloud / self-hosted) | moved | `setup/setup.md` (Operating modes) |
| 2387 | Auto-detection Rules | moved | `setup/setup.md` (mode inference rules) |
