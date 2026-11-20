# Spec: Docs truth pass; one constant install one-liner, no zip (AM-10153)

Started as REQ-10 of track 10114 (a release and a Download button). Replanned twice on 2026-11-20 and finished as a smaller track by the owner's decision: there is no zip.

## Decision (owner, 2026-11-20)

The install route is the one-liner on the landing page: `claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor@laneconductor && ...`. It has no version in it and always takes the newest plugins from the repository, so a release needs no extra work. **No zip is published, no release is made, no GitHub Action, no Download button.**

Why this is enough (checked in the CLI help and the Claude Code docs, 2026-11-20): Claude Code installs from marketplaces (`claude plugin install` has no zip form); `claude --plugin-dir <folder or .zip>` loads a plugin for one session only; the "Upload plugin" button of the desktop app and claude.ai is the only place a zip is needed, and an uploaded plugin is a snapshot that does not update itself. Updating an installed plugin stays `claude plugin marketplace update laneconductor`, then `claude plugin update <name>@laneconductor`, or the marketplace's auto-update toggle in `/plugin`.

## What is left (the smaller track)

- REQ-1 Truthfulness (from 10114 REQ-9): one read of the README, the wiki and the landing page against the code and the plugin manifests, claim by claim; nothing is stated as available that is not (the directory listing, the remote connector, an uploaded zip). The wiki's deprecated-tier pages keep their `lc` text under their deprecation notice (owner decision to confirm). Known wrong today: the base README says hooks "are planned as a separate opt-in extension and are not available yet", but the board add-on ships hooks.
- REQ-2 The README's "Other ways to get it" section describes a zip built with `make-zip.mjs` and the "Upload plugin" route, with "No release zip has been published yet". With no zip planned, that section goes, or says only what is true: no zip is published and the marketplace one-liner is the install route. The README is a base file, so the change ships with the next base version (bundle it; do not release a base version for this alone). `scripts/make-zip.mjs` stays in the repository as a tool for anyone who wants a zip for "Upload plugin".
- REQ-3 The plugin README has one named source (10114 REQ-11): say whether `connector/PLUGIN-README.md` still exists or the generator is now the one source.
- REQ-4 A landing or wiki change from this track holds only this change (check `git diff` of `landing/` for another track's drafts) and is deployed only on the owner's word.

## Out of scope

A zip, a release, a GitHub Action or a Download button (dropped by the owner); submitting to Anthropic's directory (track 10148).
