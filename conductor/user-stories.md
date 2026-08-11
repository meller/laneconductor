# User Stories

## Solo Developer — Kick off a new track from an idea
**As a** solo developer, **I want to** describe a feature in plain language, **so that** LaneConductor scaffolds a track (index.md/spec.md/plan.md) I can hand to an AI agent.

Flow:
1. Open the Kanban dashboard UI at `localhost:8090`.
2. Click the **"New Track"** button.
3. Describe the feature in the text input area.
4. LaneConductor API creates a new track record in Postgres and appends the creation request to `conductor/tracks/file_sync_queue.md`.
5. The heartbeat sync worker process reads the message queue, creates the track directory `conductor/tracks/NNN-slug/` and generates the initial `index.md`, `spec.md`, and `plan.md` files.
6. The new track appears in the `planning` lane of the dashboard, ready for a developer or AI agent.

Related tracks: [[LAN-107-user-stories-scaffold-doc]], [[008-new-track-ui-flow]]

## AI Developer Agent (The Brains) — Claiming and executing a track
**As a** developer AI agent, **I want to** claim an in-progress track, lock it, and execute it, **so that** no other worker attempts to run it concurrently and all progress is logged.

Flow:
1. The sync worker daemon polls the database and finds a track in `implement:queue` or `plan:queue`.
2. The worker claims the track by writing a git lock file to `.conductor/locks/{track_number}.lock` and committing it, preventing other worker processes from grabbing it.
3. The worker creates an isolated git worktree under `.git/worktrees/{track_number}/` to prevent workspace conflicts.
4. The AI agent starts inside the worktree, reads the track's `spec.md` and `plan.md`.
5. The agent implements the required changes in the code files, updating the task progress percentage, current phase, and summary in `conductor/tracks/NNN-slug/index.md` as it proceeds.
6. The agent commits the changes to the track's feature branch (`track-{track_number}`).
7. The agent finishes execution (exits with code 0). The sync worker cleans up the git lock, removes the worktree, and transitions the track to `review:queue` based on `workflow.json`.

Related tracks: [[1010-worker-coordination-architecture]], [[1035-persistent-worktree-lifecycle]], [[1036-worktree-lock-manager]], [[010-auto-implement-on-start]]

## Human Developer/Reviewer — Reviewing track implementation and logs
**As a** human developer or reviewer, **I want to** review the track summary, code diffs, and execution logs in the UI, **so that** I can approve the track or request changes.

Flow:
1. Open the Kanban dashboard and click on a track card in the `review` lane.
2. In the track panel, inspect the generated logs, the spec, and the code changes.
3. Click the **"Start Dev Server"** button directly in the UI to launch the application's dev server and verify the implementation visually in the browser.
4. If satisfied, click **"Approve"** in the UI to transition the track to `quality-gate:queue`.
5. If changes are needed, type feedback in the track conversation panel. The sync worker daemon writes this comment to `conductor/tracks/NNN-slug/conversation.md` and transitions the track back to `implement:queue`.

Related tracks: [[007-review-skill]], [[1014-dev-server-quick-start]], [[015-track-conversation-inbox]]

## Project Maintainer — Setting up a new repository with LaneConductor
**As a** project maintainer, **I want to** run `lc setup` inside my repository, **so that** it is scaffolded with all necessary conductor documentation files and symlinked with the global LaneConductor skill.

Flow:
1. Run the command `lc setup` in the terminal inside a repository.
2. The CLI scanner runs a brainstorm wizard to let the user describe the project, then registers the project in the local Postgres database.
3. The CLI scaffolds the `conductor/` directory structure, generating `product.md`, `tech-stack.md`, `workflow.json`, `user-stories.md`, `kpis.md`, `design-language.md`, and `deployment-stack.md`.
4. The CLI symlinks the global LaneConductor skill folder into `.claude/skills/` and `.agents/skills/`, and symlinks the workspace rules to `.agents/rules/laneconductor.md`.
5. The CLI verifies the project environment (checks git status, dependencies, and AI command reachability).

Related tracks: [[003-per-project-install-flow]], [[1030-track-1030-setup-scaffold-fix]]

## Team Leader/Founder — Multi-Project and Worker Health Monitoring
**As a** team leader or founder, **I want to** monitor the health of all sync workers and projects in one dashboard, **so that** I have immediate visibility into active tasks and agent health.

Flow:
1. Launch the UI by running `lc ui start` or loading `localhost:8090`.
2. Toggle the dashboard to **"All Projects"** mode.
3. View the unified Kanban board containing cards from all registered repositories.
4. Go to the **"Workers"** view to check active heartbeat processes, their registered PIDs, last active timestamps, and their current assigned tasks.
5. Review the system logs for sync activities, API connection attempts, and warning indicators.

Related tracks: [[014-worker-registration-and-ui]], [[1029-machine-workers-view-in-all-projects-mode]], [[009-verify-file-sync-heartbeat]]

## AI Quality-Gate Agent — Automatic validation and branch merge
**As a** quality-gate AI agent, **I want to** execute the test suite, linting, and build commands specified in `quality-gate.md`, **so that** only fully validated tracks are merged.

Flow:
1. The sync worker daemon sees a track in the `quality-gate:queue` lane.
2. The worker claims the track, locks it, and runs the commands defined in the project's `conductor/quality-gate.md` (e.g., `npm run lint`, `npm run test`, `npm run build`).
3. If all validation checks exit with code 0:
   - The worker merges the track's feature branch (`track-{track_number}`) to the main branch (`main` or `master`) via `--no-ff`.
   - The worker removes the track's git worktree.
   - The worker transitions the track to `done:success`.
4. If any check fails (exit code > 0):
   - The worker marks the track's quality-gate status as failed.
   - The worker returns the track to the `planning` lane or `implement` lane for remediation as specified in `workflow.json`.

Related tracks: [[012-the-laneconductor-setting-if-the-collector-should-also-create-default-quiality-gate-md]], [[1020-workflow-standardization-enhanced-transitions]]

## Founder/Product Owner — Closed-loop non-dev tracking (marketing, sales, support)
**As a** founder, **I want to** run campaigns or support initiatives as marketing/sales tracks and automatically measure their KPIs, **so that** failed experiments are automatically replanned.

Flow:
1. Open the UI, click **"New Track"** and select the track type as `marketing` or `sales`.
2. The AI agent claims the track in the `planning` lane, drafts the required copy or sequence in the track directory, and moves the track to the `review` lane.
3. The human founder reviews the copy, publishes it to the external platform (Hacker News, Reddit, Twitter/X, cold email tool), and clicks **"Published"** in the UI.
4. The track moves to the `quality-gate` lane, where it waits for the configured measurement window to close (e.g., 24 hours).
5. Once the window closes, the sync worker executes a measurement script that fetches the KPI results (Hacker News score, upvotes, or reply rates) and attaches them to the track's files.
6. If the target KPI threshold is reached, the track moves to `done:success`. If missed, the worker schedules a retry, attaches the failure metrics, and transitions the track back to `planning` or `implement` for AI replanning.

Related tracks: [[013-planning-lane]], [[1052-show-hn-post]], [[1053-reddit-launch-posts]]

## Sync Worker Daemon (The Plumbing) — Multi-Target Synchronization
**As a** sync worker daemon, **I want to** watch the filesystem and pull from multiple database endpoints, **so that** local markdown files and databases are kept perfectly in sync.

Flow:
1. Run `lc worker start` to initiate the background sync daemon.
2. The sync worker uses `chokidar` to listen to changes under `conductor/tracks/`.
3. When a file is modified (e.g., a developer updates `index.md` or `plan.md`), the worker parses the markers and calls the PATCH API to update all enabled collectors.
4. Every 5 seconds, the worker queries each enabled collector (local Postgres or remote cloud API) for any database-side updates.
5. Using `last_file_update` and `last_db_update` timestamps, the worker performs conflict resolution: the version with the newer timestamp overrides the older one, either writing DB changes back to the local files or pushing local changes up to the database.

Related tracks: [[1027-file-sync-queue]], [[1017-three-operating-modes]], [[1042-lc-start-in-sync-mode-only]]

## Developer/Admin — Secure dynamic credential management
**As a** developer or admin, **I want to** configure sync targets with secret managers like GCP Secret Manager, **so that** tokens are resolved dynamically at runtime and never committed to version control.

Flow:
1. Add a target via the CLI: `lc add-target --url https://app.laneconductor.com --store-type gcp-secret --secret-name LC_PROD_KEY`.
2. The CLI writes the target configuration to `.laneconductor.json` without any hardcoded credentials.
3. When the worker starts up, it detects the `gcp-secret` storage type.
4. The worker uses the authenticated `gcloud` identity to dynamically fetch the secret from Google Cloud Secret Manager.
5. The worker initializes the sync loop with the retrieved token, keeping the workspace secure.

Related tracks: [[017-laneconductor-cloud]], [[1046-cloud-api-keys-endpoints]]
