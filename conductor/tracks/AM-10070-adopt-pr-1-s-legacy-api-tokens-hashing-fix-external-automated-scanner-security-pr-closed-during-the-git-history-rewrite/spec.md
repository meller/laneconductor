# Spec: Adopt PR #1's legacy `api_tokens` hashing fix

## Problem Statement

`api_tokens` stores worker credentials in plaintext. `auth()` in
`cloud/functions/index.js` looks a bearer token up by comparing the raw incoming
value directly against the stored column, so the column has to hold the raw
value for the comparison to work. Anything that can read one row of that table —
SQL injection, stolen database credentials, an exposed backup, a support query
pasted into a log — walks away with credentials it can authenticate with. The
newer `api_keys` table already got this right: it stores `key_hash`, a SHA-256
digest, and compares digests.

[PR #1](https://github.com/meller/laneconductor/pull/1) reported this. Its diff
hashed the *incoming* token before the lookup, which is the right shape for the
read path but is not, on its own, a fix — and the maintainer's review said so:
merged as submitted it would break every already-issued token, because a digest
never equals the plaintext already sitting in the column.

Two further gaps were not in the report at all. The write path
(`POST /auth/token`) still inserted the raw token, so the submitted diff would
have broken *newly minted* tokens too and never actually closed the
vulnerability. And `req.api_token` — the caller's live bearer — was being written
into a second table as a `file_sync_queue` worker label, so the same credential
was at rest in two places.

This is not a hypothetical class of bug for this repo. Its own history contains
two commits titled "security: remove remaining scratch files with hardcoded Neon
credentials", which record rotating a Neon credential *and revoking a leaked
`lc_live_` token* — the exact token shape this table stores.

## Root Causes (verified against current code)

Line numbers are as of `HEAD` before this track's changes.

| # | Where | What is wrong |
|---|-------|---------------|
| RC1 | `cloud/functions/index.js:234` | `SELECT workspace_id FROM api_tokens WHERE token = $1` binds the raw bearer. The comparison only works if the column holds plaintext, so the read path is what *forces* plaintext storage. |
| RC2 | `cloud/functions/index.js:439` | `INSERT INTO api_tokens (token, …)` stores the freshly minted raw token. The write path, which PR #1 never touched — so hashing only the lookup breaks new tokens as well as old ones. |
| RC3 | stored rows | Every row already in `api_tokens` is plaintext. Independent of any code change, those rows are the leak. Fixing RC1/RC2 without touching them means the read path stops matching them. |
| RC4 | `cloud/functions/index.js:1674` | `[projectId, req.api_token \|\| 'machine', limit]` writes the live bearer into `file_sync_queue.worker_id`. Same vulnerability class, second table, and `file_sync_queue` rows outlive the request. |
| RC5 | `cloud/functions/reader.js:67`, `cloud/functions/reader.mjs:77` | Both compare plaintext. Neither is deployed (`cloud/functions/package.json` sets `main: index.js`, `firebase.json` only rewrites to the `api` function, and `index.js` requires neither), so this is latent rather than live — but after RC3 is fixed they would be broken, and they encode the wrong assumption for whoever deploys them next. |
| RC6 | `cloud/functions/index.js:244` vs `:365` | `auth()` computed `keyHash` for `api_keys` while `api_tokens` used the raw value, i.e. the same digest logic existed in two places with two different meanings. PR #1's diff added a third copy (`legacyHash`) twelve lines from the second. |
| RC7 | `cloud/functions/index.js:433-443` + `ui/src/contexts/AuthContext.jsx:76` | `POST /auth/token` mints unconditionally, and the UI calls it on every Firebase `onAuthStateChanged` and discards the response body. The table gains one live, unusable credential per sign-in, forever. Once only a digest is stored, a repeat caller cannot be handed the earlier token back either, so unconditional minting has to go. |

### Why in-place rehash rather than forced reissue

This is the maintainer's review question, and it has a definite answer.

- **Clients already hold the raw token outside the database.** Resolution order
  is in `bin/lc.mjs:27-51` (`getCollectorToken`): `.env` `COLLECTOR_<n>_TOKEN`,
  inline `collectors[].token` in `.laneconductor.json`, or GCP Secret Manager.
  The database only ever needs the digest. So rehashing the stored value keeps
  every existing worker authenticating with **no client change and no downtime**.
- **Reissue is impractical today.** There is no `lc login` or refresh, no list or
  revoke endpoint for `api_tokens`, and `POST /auth/token`'s minted token is
  discarded by its only caller (RC7). The only redelivery path is manual
  re-entry per target (`lc install`, `lc add-target --key`) plus manual GCP
  secret rotation.
- **The idempotency guard is exact, not heuristic.** Every plaintext token starts
  `lc_`; a lowercase hex digest can never contain `l`. So `left(token, 3) = 'lc_'`
  selects precisely the un-migrated rows, and re-running the migration is a
  no-op.
- **No collision or referential risk.** `token` is the PRIMARY KEY, so plaintexts
  were already unique and distinct plaintexts give distinct digests. Nothing has
  an inbound foreign key to `api_tokens.token`; the only FK points outward, to
  `workspaces`.

**Caveat, stated plainly:** rehashing *preserves* the tokens. It stops future
database reads from yielding credentials; it does not revoke anything an existing
leak already exposed. Rotation remains an operator decision, and given the
`lc_live_` revocation already in this repo's history it is one worth making
separately.

### Why deploy ordering forces a dual-read

`scripts/deploy.sh:89` applies migrations; `scripts/deploy.sh:96` leaves the
function deploy to a manual command. So the two halves of this change land at
different times, in an order nobody controls, and *either* order has a window
where every `lc_` credential fails:

- migrate first → old code compares raw values against hashed rows;
- deploy first → new code compares hashes against plaintext rows.

Reading `WHERE token = $hash OR token = $raw`, plus a fire-and-forget rehash of
any plaintext row that comes through, removes the window in both directions and
makes the table converge even if the bulk migration is never run.

## Requirements

- REQ-1: `POST /auth/token` stores only a SHA-256 digest of the minted token. The
  raw value is returned to the caller and never persisted.
- REQ-2: `POST /auth/token` mints at most one token per `(workspace_id,
  created_by)`. A caller who already has one gets `{ workspace_id }` with no
  `token` field and no new row.
- REQ-3: `auth()` authenticates an `lc_` bearer by comparing digests, computing
  the digest exactly once for both the `api_tokens` and `api_keys` lookups.
- REQ-4: `auth()` still authenticates a row left in the pre-migration plaintext
  form, and rehashes that row in place as a side effect that cannot fail or delay
  the request.
- REQ-5: A migration rehashes every existing plaintext row in place, is
  idempotent, and requires no Postgres extension.
- REQ-6: No raw token is written to any other table. `file_sync_queue.worker_id`
  gets a non-credential label that still identifies the caller.
- REQ-7: `reader.js` and `reader.mjs` compare digests, with the same plaintext
  fallback (read-only, so no rehash).
- REQ-8: An unknown `lc_` token is still rejected with 401, and the `api_keys`
  path is behaviourally unchanged.
- REQ-9: The declarative schema (`prisma/schema.prisma`, `cloud/schema.sql`)
  documents that the column holds a digest. The column keeps its name and type,
  so there is no DDL change and no Atlas drift.
