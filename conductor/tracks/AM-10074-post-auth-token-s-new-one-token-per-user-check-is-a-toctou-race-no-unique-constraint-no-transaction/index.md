# Track AM-10074: POST /auth/token's new one-token-per-user check is a TOCTOU race — no unique constraint, no transaction

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Workspace**: branch
**Merge Mode**: pr
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: [PR #25](https://github.com/meller/laneconductor/pull/25) (track 10070, merged as `bac2902`) fixed plaintext `api_tokens` storage and, along the way, added a "mint at most one token per user" guarantee to `POST /auth/token` — new logic, not present before the PR. Found during that PR's 7-angle code review, independently by three separate review angles (line-by-line, altitude, efficiency), which is itself a signal of how easy the bug is to spot once you're looking at that function.

`cloud/functions/index.js` (around what was line 471-482 in the PR): the check is `SELECT 1 FROM api_tokens WHERE workspace_id = $1 AND created_by = $2 LIMIT 1`, followed — as a separate statement, no transaction — by `INSERT INTO api_tokens (...)`. `cloud/schema.sql`'s `api_tokens` table has no unique index on `(workspace_id, created_by)`, only `token` as the primary key. So the "at most one" guarantee is enforced entirely at the application level via check-then-act, which is a classic TOCTOU (time-of-check to time-of-use) race.

The UI's own comment on this code path says `POST /auth/token` fires "on every `onAuthStateChanged`" (`ui/src/contexts/AuthContext.jsx:76`) — meaning two browser tabs open at once, or a fast reload, or any other double-fire of that Firebase callback, is a realistic way to trigger two concurrent calls for the same `(workspace_id, created_by)` pair. Both can pass the SELECT before either INSERT commits, producing two live, valid, unrevoked tokens for one user — exactly the "one live credential per sign-in forever" problem this whole PR was written to close, reintroduced under concurrency. Worth being clear about what this is NOT: it doesn't let anyone unauthorized in — it just means the already-authenticated legitimate user's own client can end up holding more live credentials than intended, which matters because there's still no list/revoke endpoint for `api_tokens` to clean that up afterward.

**Fix**: add a unique index on `api_tokens(workspace_id, created_by)`, then replace the SELECT-then-INSERT with a single `INSERT ... ON CONFLICT (workspace_id, created_by) DO NOTHING RETURNING token` (or equivalent upsert) so the database enforces "at most one" atomically instead of the application racing against itself. Add a regression test that fires two concurrent calls and asserts exactly one row exists afterward — the current test suite (`cloud/functions/test/api-tokens-hashing.test.js`) tests the sequential case only.
**Summary**: Found during PR #25's code review (track 10070, merged as bac2902). SELECT-then-INSERT with no unique index on (workspace_id, created_by) in api_tokens lets two concurrent calls both mint a token…
