# Track AM-10071: Invite PR #1's author to continue via LaneConductor itself, not a silent maintainer merge

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Workspace**: main
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Problem**: [PR #1](https://github.com/meller/laneconductor/pull/1) is this repo's first-ever external contribution — an automated security-scanner-generated fix for the legacy `api_tokens` plaintext-storage issue (see track 10070 for the fix's own technical scope and the gap in it). The contributor never touched LaneConductor itself; the PR came in through GitHub directly, and it was closed (not merged) as a side effect of an unrelated git-history rewrite, with only a generic "please reopen against the new history" comment.

This is a real, and rare, moment: an actual external person interacting with this project for the first time. Rather than have the maintainer silently absorb the fix in the background (which is what track 10070, on its own, would amount to), the point of this track is to treat it as a genuine first external-user opportunity — reply to the PR, credit the finding, explain honestly what happened to it (closed by an unrelated history rewrite, not a rejection), and invite the author to continue it through LaneConductor's own track workflow rather than just watching the maintainer quietly finish it for him.

**Scope**: (1) post a reply on PR #1 — drafted and shown to the human for approval before it goes out, since this is a public message to a real external person — crediting the report, explaining the history-rewrite closure honestly, and inviting him to open a track in LaneConductor (or otherwise engage with the tool) to carry the fix (including the missing migration-for-already-stored-tokens piece track 10070 identifies) the rest of the way, rather than treating this as a dead end; (2) if he engages, that becomes the actual continuation of the fix — track 10070 should be treated as a fallback (the vulnerability still needs fixing eventually) rather than the default path, and should be put on hold or explicitly deprioritized once outreach happens, not run in parallel racing to merge first; (3) no email or other contact channel should be assumed or guessed — the PR/GitHub thread is the only channel we actually have consent to use.
**Summary**: Our first external contributor never touched the tool at all — he opened a GitHub PR directly. Reach out and invite him to use LaneConductor's own track workflow to finish it, as a real first…
