# Spec: lets deploy app.laneconductor.com

## Problem Statement
We need a remote instance of LaneConductor to test cloud-based features like worker registration and remote project sync. This instance should be hosted on Firebase.

## Requirements
- REQ-1: Deploy the Vite UI to Firebase Hosting on a specific subdomain (e.g., app.laneconductor.com).
- REQ-2: Deploy the Express API/Collector to Firebase Functions (v2).
- REQ-3: Configure Firebase to route API requests to the Functions.
- REQ-4: Create a `make deploy-remote-app` command that:
    - Builds the UI (`npm run build`).
    - Prepares the `cloud/functions` directory.
    - Deploys both hosting and functions.
- REQ-5: Ensure the remote instance can connect to a production-grade database (likely a remote Postgres instance, or using Firebase primitives if applicable, but for now focus on the deployment of existing logic).
- REQ-6: Support remote configuration in `ui/.env.remote`.

## Acceptance Criteria
- [ ] `app.laneconductor.com` (or equivalent) loads the LaneConductor UI.
- [ ] API requests from the UI reach the Firebase Functions.
- [ ] `make deploy-remote-app` successfully completes a full deployment.
- [ ] A local LaneConductor instance can register with the remote instance (if the registration track is ready).

## API Contracts / Data Models
- The API should remain compatible with the local version.
- Environment variables for DB connection must be configurable via Firebase secrets or environment config.
