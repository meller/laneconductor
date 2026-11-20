# Spec: Submit the base plugin to Anthropic's directory (validate, answers, review loop)

## Problem Statement

The Markdown-only base plugin `laneconductor` should be listed in Anthropic's plugin directory, for discoverability. Only the base qualifies: the portal blocks a local MCP server, scripts, package files and the agent key `isolation` for organisations that are not verified, so the two add-ons (`laneconductor-parallel`, `laneconductor-board`) stay in the owner's own marketplace `meller/laneconductor`.

The owner submits; nothing here submits, posts or answers on the owner's behalf. This track holds the checks before, the answers the portal asks for, the review loop after, and a log of what the reviewer said and which version fixed it. Split out of track 10128 (its Phase 7) on 2026-11-18 by the owner, because review feedback and re-checks will outlive that track.

## What is known

- The portal's blocking rules are emulated in `connector/test/directory-base.test.mjs`: skill frontmatter keys are limited to name, description, when_to_use and argument-hint; plain `key: value` frontmatter lines; no `.mcp.json`, scripts, package files or `isolation`; plugin.json fields the portal knows, plus a `privacyPolicyUrl`; a README, a licence and a square icon.
- The last portal Validate was on the early Markdown-only build: 0 blocking, 1 expected warning (the privacy policy URL, since added), 2 reviewer holds: a credential-read heuristic on plugin.json that looks like a false positive, and the publisher name resembling another.
- The base has grown since (skill advisor with a catalog of install commands, owner steps, bigger lane guides). The portal also runs a safety scan and a policy review that `claude plugin validate` does not.
- Open question from track 10128 (task 8.8): is 300 to 700 lines per command acceptable? The `run` command is about 67 KB and over 1,000 lines.
- A `laneconductor:laneconductor` entry shows in the `/` menu because the key that hides a skill is not on the portal's allowed list (track 10128, task 8.9).

## Requirements

- REQ-1 Before submitting, the local checks pass on the exact version to be submitted: the full connector tests, the drift check, `claude plugin validate --strict` and the directory profile on `plugins/laneconductor`, the catalog checker online, and the base README, icon, licence and privacy page present and reachable. The version is named here.
- REQ-2 The real-session check of track 10132 (setup and next show no "Allow reads outside the working directories" prompt) is done, so the first impression of a new user is clean.
- REQ-3 The portal's Validate is run (by the owner, in the portal) on the current base; its result is pasted here with the date and version: blocking items, warnings, reviewer holds. Any blocking item gets a task and a fix before submission.
- REQ-4 Written, factual answers exist for the two earlier reviewer holds and for the data-handling questions, drafted from the plugin's real behaviour (Markdown only, no network access of its own, no data collected, what the add-on pointers are, the privacy page). The owner reads, edits and pastes them; they are never sent for the owner.
- REQ-5 The owner submits and ticks the acknowledgements.
- REQ-6 Review loop: each reviewer comment becomes a line in a table here (date, comment, our answer or fix, version), and a task when a change is needed; fixes ship through the normal release method and name their version.
- REQ-7 After the listing is live: install the base from the directory in a clean profile (no marketplace of ours added), run setup and next, and record it. Only then do the README and the website mention the directory install; until then nothing says it is listed.
- REQ-8 The base text keeps its pointers to the add-ons short and relevant (the directory discourages listings that exist mainly as advertising); a reviewer comment on this gets handled under REQ-6.

## Decisions

- 2026-11-18 (owner): the submission is its own track, separate from the plugin split (10128).
- 2026-11-18: the owner submits; no automatic submission, posting or answering for the owner.
- 2026-11-18: only the base goes to the directory; the add-ons stay in the owner's marketplace.

## Acceptance criteria

- [ ] The local checks of REQ-1 pass on the named version.
- [ ] The setup check of REQ-2 is done.
- [ ] The portal's Validate result is recorded and has no blocking item (REQ-3).
- [ ] The answers of REQ-4 are written and read by the owner.
- [ ] The owner has submitted (REQ-5).
- [ ] The review table exists and every reviewer comment has an answer or a fix with a version (REQ-6).
- [ ] After the listing, the clean-profile install works and is recorded; only then is the directory install mentioned in the README and the website (REQ-7).

## Draft answers for the portal (for the owner to read, edit and paste; written 2026-11-19 from the repository, version 1.9.9)

Each sentence below can be checked against the repository. The two holds below use the portal's own wording from the run of 2026-11-19.

Data handling:
- What does it access? Only your own project's files: the track folders under `conductor/tracks/`, the other files in `conductor/` and the optional personal settings file `.laneconductor.json`. Claude reads and writes them in your session with your normal permission prompts. It does not read files elsewhere.
- What is collected or sent anywhere? Nothing. The plugin makes no network requests of its own, has no analytics, telemetry or tracking, and stores nothing about you outside your project's files (docs/privacy.md).
- Third parties? None. The two optional add-ons are separate plugins in a separate marketplace and are not part of this submission.
- Credentials and secrets? It never asks for, reads or stores them, and its text tells Claude never to put secrets in track files.
- Code it runs? None ships: the plugin is Markdown only (one skill, slash commands, and one read-only agent whose tools are Read, Grep and Glob). A command may ask Claude to use git or a shell command in your own session, under your own permission prompts. It never runs an install by itself: it shows the install commands for you to run.
- Privacy policy: https://github.com/meller/laneconductor/blob/main/docs/privacy.md

Reviewer hold 1, "Uses a credential from the user's machine" (code MCP_FORWARDS_CREDENTIAL_ENV, reported against plugin.json; the portal's own detail, read 2026-11-19): "Across its surfaces this plugin reads the installer's .vercel (command deploy body) and can send data off the machine (command board body: https://github.com/meller/laneconductor). Read together that is a credential leaving the machine in two steps; held for review." Both pieces are false positives: `.vercel` appears in the deploy guide only in a list of lines the guide appends to the project's `.gitignore`, so the folder is NOT committed (nothing reads it, and the guide says it never asks for or reads a secret); the board command's URL is a plain "More: <repository>" documentation link, and the command sends nothing to it (the board is published as a private artifact only when the person approves, after a secret and personal-data scan). The plugin has no MCP server, no environment forwarding and no credentials.

Reviewer hold 2, "Publisher name may be confused with another": "This repository's GitHub owner, 'meller', resembles directory connector publisher 'Relier' (look-alike characters). Held for review." The publisher is an individual, Asaf Meller (https://github.com/meller); the repository github.com/meller/laneconductor and the homepage laneconductor.com are the same project; there is no connection to a publisher named Relier.

## Portal Validate result (run 2026-11-19 in the owner's signed-in browser, at the owner's request, nothing submitted)

Repository https://github.com/meller/laneconductor, plugin path `plugins/laneconductor`, `main @ 06b8f55` (plugins 1.9.9): "Validation passed: 1 warning, 2 policy holds", 7 checks. Passed: repository fetched; 58 files, 616.1 kB, within the size limits; plugin.json found and valid; 1 skill, 1 agent, 23 commands; no MCP servers. Passed with warnings: directory lints; name and publisher checks. Warning: the field `privacyPolicyUrl` is unrecognised by Claude Code, which ignores it at load time, and the directory reads it for the listing ("No action needed"). Note: icon.png passed without a code check. Nothing blocks submission. Two policy holds, which a reviewer must release before a held version goes live: (1) uses a credential from the user's machine (see the draft answers); (2) the publisher name "meller" resembles the directory connector publisher "Relier".

Second run, the same day, after plugins 1.9.10 (the `.vercel` line removed from the deploy guide's `.gitignore` list), `main @ a631a12`: "Validation passed: 1 warning, 1 policy hold". Directory lints now pass with no warning. The credential hold is GONE. What remains: the publisher-name hold ("meller" resembles the directory connector publisher "Relier"), which only a reviewer can release, and the `privacyPolicyUrl` warning ("No action needed").

## Risks and limits

- The portal's safety scan and policy review are not visible to us until the owner runs Validate or submits; a surprise there costs a release cycle.
- Review time is unknown, and whether an update needs a new review is unknown; plan for the first listed version to stay stable.
- The size of the carried command text may draw a comment; task 8.7 of track 10128 is the lever.
- Do not say the plugin is listed anywhere until it is.

## Out of scope

- Submitting, answering or posting for the owner; the add-ons' own distribution; changing the plugin's behaviour beyond what a reviewer asks.

## The plugin work in one place (this is the main plugin track; written 2026-11-20)

Everything about LaneConductor's plugins, how they are built, validated, submitted and kept, starts here. Lane and status are as of 2026-11-20; open a track for the current state.

| Track | What it holds | Lane |
| --- | --- | --- |
| **10148** (this track) | This track: the directory submission of the base plugin, the portal steps and answers, the review loop | review / waiting |
| [10145](../AM-10145-epic-plugin-era-hardening-and-what-s-next-one-place-for-the/index.md) | The epic for plugin-era hardening and what's next | quality-gate / waiting |
| [10106](../AM-10106-laneconductor-connector-git-backed-mcp-server-local-stdio-first-then-remote-via-github-api/index.md) | The connector: the git-backed MCP server behind the parallel add-on | done / success |
| [10127](../AM-10127-laneconductor-lite-a-markdown-only-plugin-for-the-anthropic/index.md) | The first Markdown-only plugin (Lite), the shape the directory accepts | done / success |
| [10128](../AM-10128-split-the-plugin-in-three-base-directory-parallel-worktrees/index.md) | The split into the base, the parallel add-on and the board add-on, and the one generator | review / queue |
| [10133](../AM-10133-plugin-only-setup-no-lc-cli-no-old-scheme-setup-offers-the-r/index.md) | Plugin-only setup: no old command line, setup offers the recommended plugins | quality-gate / waiting |
| [10116](../AM-10116-command-catalog-as-mcp-prompts-and-bug-feature-forms/index.md) | The command catalog as MCP prompts, and the bug and feature forms | quality-gate / success |
| [10117](../AM-10117-new-project-flow-guided-interview-recipe-recommendations-sca/index.md) | The new-project flow | quality-gate / success |
| [10144](../AM-10144-what-s-next-a-state-aware-command-that-names-the-next-step-a/index.md) | The `next` command: name the one next step | quality-gate / waiting |
| [10146](../AM-10146-track-file-roles-plan-spec-test-a-tracked-history-md-for-the/index.md) | Track file roles: plan, spec, test and a tracked history | review / queue |
| [10147](../AM-10147-owner-steps-a-track-that-stops-at-a-real-world-action-runs-a/index.md) | Owner steps: a track that stops at a real-world action and closes with a result | review / queue |
| [10124](../AM-10124-skill-advisor-recommend-the-right-skill-at-the-right-lane-in/index.md) | The skill advisor: recommend the right skill at the right lane | review / queue |
| [10115](../AM-10115-plugin-v2-lane-end-prompts-commands-plan-review-agent-card-actions/index.md) | The board add-on: card actions, partial publish, auto-refresh, a self-updating view | done / success |
| [10129](../AM-10129-public-generic-version-of-the-homebrew-skills-no-private-nam/index.md) | The skills library and the five skill packs | done / success |
| [10150](../AM-10150-next-base-release-advisor-catalog-for-the-skill-packs-settings-row-and-skill-from-code-pointer/index.md) | The next base release: catalog entries for the packs and other base changes held back during the review | plan / waiting |
| [10151](../AM-10151-board-page-follow-ups-desktop-app-checks-phone-and-dark-theme-review-the-plan-button/index.md) | Board page follow-ups (backlog) | backlog / queue |
| [10120](../AM-10120-orchestrator-plugin-run-queued-tracks-unattended-the-heartbe/index.md) | An orchestrator plugin to run queued tracks unattended (backlog) | backlog / queue |
| [10134](../AM-10134-remote-tier-a-separate-laneconductor-remote-plugin-for-the-o/index.md) | A Remote plugin for the old remote, workers and Jira code (backlog) | backlog / queue |

How to do the same for another project: the skill `plugin-from-skills` (in the pack `laneconductor-skill-from-code`, source `skills/plugin-from-skills/`) carries the layout, a tested generator template, the checks, the portal steps and the pitfalls from this track. Its outcome section is updated when the review is decided (Phase 6, task 6.2).
