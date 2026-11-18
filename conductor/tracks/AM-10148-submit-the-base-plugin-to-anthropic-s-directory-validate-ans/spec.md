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

## Risks and limits

- The portal's safety scan and policy review are not visible to us until the owner runs Validate or submits; a surprise there costs a release cycle.
- Review time is unknown, and whether an update needs a new review is unknown; plan for the first listed version to stay stable.
- The size of the carried command text may draw a comment; task 8.7 of track 10128 is the lever.
- Do not say the plugin is listed anywhere until it is.

## Out of scope

- Submitting, answering or posting for the owner; the add-ons' own distribution; changing the plugin's behaviour beyond what a reviewer asks.
