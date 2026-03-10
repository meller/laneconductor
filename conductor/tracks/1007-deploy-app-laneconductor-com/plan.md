# Track 1007: lets deploy app.laneconductor.com

## Phase 1: Infrastructure & Configuration

**Problem**: We need the Firebase project configuration to support a new site and functions.
**Solution**: Update `firebase.json` and `.firebaserc` to include the new hosting target and functions config.

- [x] Task 1: Verify Firebase project and sites (`firebase hosting:sites:list`).
- [x] Task 2: Update `firebase.json` to define the `app` hosting target.
- [x] Task 3: Ensure `ui/.env.remote` is correctly configured for the remote environment.

## Phase 2: Firebase Functions Setup

**Problem**: The API/Collector needs to run in a serverless environment.
**Solution**: Adapt `cloud/functions/index.js` to wrap the existing Express app for Firebase Functions v2.

- [x] Task 1: Review `cloud/functions/package.json` and dependencies.
- [x] Task 2: Implement the bridge between the existing Express API and Firebase Functions.
- [x] Task 3: Configure CORS for the remote domain.

## Phase 3: Deployment Automation

**Problem**: Manual deployment is error-prone.
**Solution**: Add a `make` target to automate the build and deploy steps.

- [x] Task 1: Add `deploy-remote-app` to the root `Makefile`.
- [x] Task 2: Implement build steps for the UI that target the remote environment.
- [x] Task 3: Implement the `firebase deploy` command with appropriate flags (`--only hosting:app,functions`).

## Phase 4: Verification & Smoke Test

**Problem**: We need to ensure the remote app works as expected.
**Solution**: Visit the URL and check API health.

- [x] Task 1: Verify the UI loads at the remote URL.
- [x] Task 2: Verify the API `/api/health` endpoint returns 200.
- [x] Task 3: Perform a test "ping" from a local instance to the remote collector.

**Impact**: Enables testing of cloud-based features and provides a publicly accessible dashboard.

## ✅ COMPLETE

**Status**: FIXED (2026-03-03)

The critical security vulnerability has been resolved by implementing Firebase Cloud Secret Manager.

- [x] Task 1: Update cloud/functions/index.js to use defineSecret("CLOUD_DB_PASSWORD")
- [x] Task 2: Remove hardcoded credentials from source code
- [x] Task 3: Trigger forced update for re-deployment

**Review Verdict**: PASS (see conversation.md for verification details)
