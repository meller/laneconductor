**Phase**: Collector API Auth
# Track 1002: GitHub OAuth + Collector Auth + Supabase Sync

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
The UI and collector API are open to anyone. Developers need an identity layer so only authenticated GitHub users can access the dashboard, projects can authenticate their sync workers, and cloud sync to Supabase is verified end-to-end.

## Solution
Add GitHub OAuth to the Express server (session cookies + `users` table), gate the React dashboard behind a login page, require per-project bearer tokens on the collector API, update `laneconductor.sync.mjs` to send auth headers, and verify Supabase dual-sync with an automated script.

## Phases
- [x] Phase 1: GitHub OAuth Backend (express-session + passport-github2 + users table + requireAuth middleware)
- [x] Phase 2: React Auth UI Layer (AuthContext + LoginPage + header avatar/logout)
- [x] Phase 3: Collector API Auth (per-project api_token + requireToken middleware + sync.mjs update)
- [x] Phase 4: Supabase Dual-Sync Verification (background fire-and-forget + verify script + make target)
- [x] Phase 5: E2E Flow Verification (all 10 ACs confirmed + full test suite green)
