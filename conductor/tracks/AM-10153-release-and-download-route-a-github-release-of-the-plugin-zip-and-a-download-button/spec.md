# Spec: Release and download route (AM-10153)

Split out of track 10114 on 2026-11-20 (owner). 10114 closed with this left open.

## Requirements

- REQ-1 A GitHub release of the plugin zip: the version in `connector/package.json` is the one to release (the base plugin `laneconductor`); `node scripts/make-zip.mjs --out <dir>` builds the deterministic zip of `plugins/laneconductor` and prints its file count and SHA-256; the tag is `v<version>`; the release notes are short and carry the checksum.
- REQ-2 Each outward step needs the owner's yes, asked one at a time: pushing the tag, `gh release create`, and any later edit of the release. Nothing is created, tagged or published before that.
- REQ-3 The landing page gets a Download button that links to the latest release asset, next to the install commands; the README download route links to the same release and still says the marketplace route is the main one. Both say what the zip is for ("Upload plugin" in the Claude desktop app or claude.ai) and that it holds the base plugin only.
- REQ-4 Truthfulness (from 10114, REQ-9): before the release, one read of the README, the wiki and the landing page against the current code and plugins, claim by claim; nothing is stated as available that is not (the directory listing, the remote connector). The wiki's deprecated-tier pages keep their `lc` command text under their deprecation notice (owner decision to confirm).
- REQ-5 No other track's uncommitted drafts go into a landing change or a deploy (check `git diff` of `landing/` first). Deploy only on the owner's word.
- REQ-6 The connector README and the plugin README stay in sync from one source (10114 REQ-11): find out whether `connector/PLUGIN-README.md` still exists or the generator is now the one source, and say which.

## Out of scope

Submitting to Anthropic's directory (track 10148); the marketplace route; the skill packs' own releases.
