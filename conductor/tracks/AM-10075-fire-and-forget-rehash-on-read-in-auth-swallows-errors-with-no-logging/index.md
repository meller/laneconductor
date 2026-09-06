# Track AM-10075: Fire-and-forget rehash-on-read in auth() swallows errors with no logging

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
**Problem**: [PR #25](https://github.com/meller/laneconductor/pull/25) (track 10070, merged as `bac2902`) closed the plaintext `api_tokens` vulnerability with, among other things, a self-healing mechanism: when `auth()` finds a row still in its old plaintext form, it rehashes it in place on the way through, fire-and-forget, so the table converges to all-hashed over time even for a deployment that never runs the bulk migration. Found during that PR's 7-angle code review, independently by two review angles (line-by-line, altitude/conventions).

`cloud/functions/index.js`, in `auth()`: `query('UPDATE api_tokens SET token = $1 WHERE token = $2', [tokenHash, bearer]).catch(() => {});` — the catch handler is empty. Any failure of this UPDATE (a permission error, lock contention, a transient connection blip, or a future schema change that rejects the write) is silently discarded. There is no `console.error`, no metric, no alert — nothing that would ever tell an operator this happened.

This directly undermines the PR's own stated safety argument: the entire "deploy-ordering doesn't matter, the table converges on its own" design depends on this UPDATE actually succeeding over time. Right now the only way to check whether it's working is the manual SQL query documented in the migration file (`SELECT count(*) FROM api_tokens WHERE left(token,3)='lc_'`) — nothing surfaces this proactively. It also violates this repo's own `conductor/code_styleguides/javascript.md` Error Handling section: "Don't swallow errors silently" / "Log errors with context."

**Fix**: replace the empty catch with `.catch(err => console.error('[auth] rehash failed:', err.message))` at minimum (matching the existing pattern already used a few lines above for `api_keys`'s `last_used_at` update, which is NOT silent). Consider also: a periodic health check (or extending track 10067's manager health-sweep, once it exists) that runs the "any plaintext rows left?" query and surfaces it as a finding rather than requiring a human to remember to check manually.
**Summary**: Found during PR #25's code review (track 10070, merged as bac2902). The self-healing plaintext-to-hash rehash in cloud/functions/index.js's auth() uses .catch(()=>{}), so a failing rehash leaves a…
