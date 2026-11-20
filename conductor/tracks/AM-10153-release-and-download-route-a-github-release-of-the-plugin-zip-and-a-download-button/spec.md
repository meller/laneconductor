# Spec: Release and download route: a rolling latest zip (AM-10153)

Split out of track 10114 (REQ-10) on 2026-11-20. Redesigned the same day with the owner: instead of cutting a numbered GitHub release by hand each time, a GitHub Action keeps ONE zip, always the newest, at a stable address.

## Why

- Claude Code users already get the latest through the marketplace (`claude plugin marketplace update`, then `claude plugin update`); a zip adds nothing for them.
- The zip is for the "Upload plugin" route in the Claude desktop app and claude.ai, which needs a file. An uploaded plugin is a snapshot: it does not update itself, so people download it again.
- `claude plugin install` has no zip form. `claude --plugin-dir <folder or .zip>` loads a plugin for one session only (checked in the CLI help and the docs, 2026-11-20). A marketplace entry could use an `archive` source (a zip over HTTPS), but a moving "latest" URL cannot carry a pinned `sha256`, so we keep the git marketplace.
- The zip is not committed into git: every commit would add a new binary to the history, and the directory review scans the repository.

## Design

A release tagged `latest` holds one asset, `laneconductor.zip`, replaced on every change to the base plugin. Stable address: `https://github.com/meller/laneconductor/releases/download/latest/laneconductor.zip` (the tag-based address works whether or not the release is flagged Latest). The release notes carry the plugin version, the commit and the SHA-256, rewritten on every run.

## Requirements

- REQ-1 A GitHub Actions workflow, `.github/workflows/plugin-zip.yml`, runs on a push to `main` that changes `plugins/laneconductor/**`, `connector/package.json` or `scripts/make-zip.mjs`, and on manual dispatch. It checks out, sets up Node 20, runs `node scripts/build-plugin.mjs --check` (a stale generated plugin fails the run), builds the zip with `node scripts/make-zip.mjs --out "$RUNNER_TEMP/laneconductor.zip"` (the script refuses a path inside the repository), computes the SHA-256, and uploads it to the `latest` release with `--clobber`, creating the release and tag on the first run and rewriting the notes (version, commit, SHA-256, one line saying it is the Upload-plugin zip and that the marketplace route updates itself).
- REQ-2 The workflow has the smallest permissions that work (`contents: write` and nothing else), uses only `GITHUB_TOKEN` (no other secret), runs only on `main`, pins each third-party action, and builds from the repository's own files only.
- REQ-3 The zip is the base plugin `laneconductor` only (what `make-zip.mjs` builds by default); it is deterministic (the same sources give the same bytes) and passes `claude plugin validate --strict` once unzipped. The add-ons and the skill packs stay marketplace-only (open question: a board add-on zip, since the board script is found by a Glob under the plugin cache, which an uploaded plugin may not use).
- REQ-4 The landing page gets a Download button, next to the install commands, linking to the stable address, and the README gets the same route. Both say the marketplace route is the main one, that the zip is a snapshot for "Upload plugin" which does not update itself, and that it holds the base plugin only. Nothing else about versions is hard-coded (the Latest versions line is already read live).
- REQ-5 After the first run: the asset downloads from the stable address, its SHA-256 equals the one in the notes, the unzipped folder validates, and `claude --plugin-dir <the zip>` loads it in a scratch session.
- REQ-6 Truthfulness (from 10114 REQ-9): before the Download button goes live, one read of the README, the wiki and the landing page against the code and the plugin manifests, claim by claim; nothing is stated as available that is not (the directory listing, the remote connector). The wiki's deprecated-tier pages keep their `lc` text under their deprecation notice (owner decision to confirm).
- REQ-7 No other track's uncommitted drafts go into a landing change or a deploy (check `git diff` of `landing/` first). Deploy only on the owner's word.
- REQ-8 The plugin README has one named source (10114 REQ-11): say whether `connector/PLUGIN-README.md` still exists or the generator is now the one source.

## Out of scope

Submitting to Anthropic's directory (track 10148); the marketplace route; numbered per-version releases (the rolling release replaces them; a tagged release can still be made by hand later); the skill packs' own releases.

## Open questions

- Should a `laneconductor-board.zip` be published too?
- Should the workflow also run on a tag, or is every push of the base plugin enough?
