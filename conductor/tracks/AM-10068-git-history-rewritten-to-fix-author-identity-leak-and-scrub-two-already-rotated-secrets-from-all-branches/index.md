# Track AM-10068: Git history rewritten to fix author identity leak and scrub two already-rotated secrets from all branches

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Complete
**Type**: dev
**Track Kind**: chore
**Workspace**: main
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: All commits authored under the local git identity were previously attributed to a placeholder identity (`Test User <test@example.com>`, plus one stray `t@t`), which meant every commit's real author/committer email field carried the operator's personal address in a public repository instead. Root cause: the checkout's local `user.email`/`user.name` had never been set, so git fell back to the placeholder baked into an earlier scaffold/template. Separately, GitHub's secret scanner flagged a live-looking Neon Postgres connection string and two `lc_live_` API tokens still reachable in old pre-cleanup commits under `scratch/*.cjs` (e.g. `scratch/fix_user_access.cjs`) — those specific files had been deleted from the tree by two earlier "security: remove remaining scratch files with hardcoded Neon credentials" commits, whose own message states the credential was already rotated in Neon and the token already revoked at that time, but deleting a file does not remove its content from history, so the dead secret kept resurfacing on every fresh scan of the branch history.

**Fix — identity**: Set the checkout's local git identity to the real name with a GitHub-noreply-style email (`<github-user-id>+<username>@users.noreply.github.com`, GitHub's own "keep email private" convention) going forward, then rewrote all repository history with `git filter-repo --mailmap <file>` to remap every commit authored under either placeholder identity to that same real-name/noreply-email pair. Verified zero remaining instances of both placeholder identities across all 1934 commits and 34 branches before pushing.

**Fix — secrets**: Ran a second `git filter-repo --replace-text <rules>` pass over the same history to blot out the exposed connection string and both API tokens from every commit that ever contained them (literal-string replacement with a `***REMOVED-SECRET-*` placeholder), then re-verified zero remaining occurrences before pushing.

**Rollout**: Both passes were done in an isolated `--mirror` clone (never the live working copy), each verified clean, then force-pushed to all 34 branches on `origin`. The two open PRs at the time (a re-land of track 10039's executor seam, and an external contributor's security fix for the legacy API-token hashing) were closed first with a note asking their authors to reopen against the new history if the work should still land, since their branches no longer share history with the rewritten `main`. The primary checkout's `main` and one active worktree branch were reconciled onto the new history (rebase where local-only commits existed on top of the pushed point, otherwise a verified-identical-content reset); branches with real in-progress uncommitted work were deliberately left untouched. Two long-stale worktrees/branches uncovered during reconciliation (one already merged via an earlier PR, one for a track that had never actually left `backlog`) were removed as part of the same cleanup.

**Known residual limitation**: GitHub's `refs/pull/<n>/head` refs are managed by GitHub itself and are not affected by force-pushing branches or tags — every historical PR's original commits (not just the two closed above) remain visible via those refs and via GitHub's own PR diff/API views, including the already-rotated secret. There is no git-level fix for this; full removal from GitHub's cached views would require a support request to GitHub referencing the specific commit SHAs. Given the credential was already rotated before this track, this was treated as low urgency, but the credential's rotation status should be independently re-confirmed in the Neon console rather than taken on faith from the old commit message.
**Summary**: Rewrote all git history (mailmap identity fix + secret-string scrub) across every branch and force-pushed; reconciled the primary checkout and idle worktrees onto the new history; closed the two PRs…
