# Spec: Plugin-only setup: no lc CLI, no old scheme, setup offers the recommended plugins

## Problem Statement

The owner's decision (2026-11-18): the `lc` command line and the old scheme (daemon, database, `make install`, rc file, `lc` subcommands, `.laneconductor.json` as a control file) do not exist any more. LaneConductor is the plugins plus files in git. Everything that still assumes the old scheme must change to the plugin architecture.

Seen on 2026-11-18 in the Fiti PLUG first run of `/laneconductor:setup`: the session ran `which lc`, found `/usr/local/bin/lc` (the old daemon CLI, still on this machine), and probed `.laneconductor.json`. Setup must never look for or depend on `lc`.

The owner added the same day: a separate LaneConductor REMOTE plugin or tier will later hold the remote LaneConductor, the workers architecture, Jira and everything remote. It is NOT part of the base or of the new way. Its code must not be lost: the git tag `v1-legacy` keeps it. So this track only removes old-scheme text and tools from what the three plugins ship; it deletes no daemon code.

The original scope (kept from the track's index.md):
1. Inventory every shipped text and tool that still names `lc`, `lc board`, `lc new`, `lc update-track`, `lc track-dir`, `lc worktrees`, `lock.mjs`, `measure.mjs`, `make install`, `laneconductorrc`, or `.laneconductor.json`; replace each with the plugin way (connector tools when the parallel add-on is installed, direct file edits otherwise, the board add-on's own script), or delete it.
2. Decide what `.laneconductor.json` is now, write it down in the reference, and make setup, the board commands and the connector agree.
3. Setup recommends and offers the plugins and skills that fit THIS project, with each install command in its own bash fence (shown, never run, never installed without a yes). One catalog is the source: `connector/plugin-extras/recommended-plugins.json`.
4. Update docs and the landing/wiki text that still describe the old scheme (list the files; do not deploy the landing; do not touch the other session's uncommitted landing edits).
5. Tests: base stays free of daemon-era words, a new test for `lc` subcommands and `make install`, a setup walk-through on a scratch repo with no `lc` on PATH.

Out of scope: deleting the legacy daemon code or the `v1-legacy` tag; removing `bin/lc.mjs` from this repository; changing the `/usr/local/bin/lc` link on this machine (tell the owner it exists).

## The need

A person who installs the plugins and runs `/laneconductor:setup` meets a product that still talks as if a command-line tool, a daemon and a database existed. Claude follows that text: on 2026-11-18 it ran `which lc`, found the old CLI on the machine, and probed `.laneconductor.json`. A person on a machine without the old install would instead be told to run commands that do not exist. The product is three plugins and files in git; every shipped sentence must say so, and setup must also tell the person which of the other two plugins would help THIS project, instead of leaving them to find out.

## Who it is for

- A person adding LaneConductor to a project for the first time (the Fiti PLUG case): setup must work on a machine that has never had the old install.
- A person who still has the old install on the machine (`/usr/local/bin/lc`, `~/.laneconductorrc`): setup must ignore it completely.
- The directory reviewer of the base plugin, who reads the shipped text.
- The owner, who will build a separate Remote tier later and wants the base free of it.

## Inventory (measured on the sources at commit 3d0dc37; the full per-file list with the replacement for each is in plan.md)

| Where | Files naming an `lc` subcommand or a daemon script | Lines | Files naming `.laneconductor.json` |
|---|---|---|---|
| Base plugin as shipped (`plugins/laneconductor`, generated) | 13 | 47 | 9 (20 files in all with any of: `lc`, `lc-*.mjs`, `.laneconductor.json`, daemon scripts) |
| Source skill `.claude/skills/laneconductor` without `legacy/` | 11 | 46 | 6 |
| `laneconductor-parallel` add-on (generated) | 4 | 7 | 8 |
| `laneconductor-board` add-on (generated) | 2 | 6 | 3 |
| Generator and catalog sources (`connector/src`, `connector/bin`, `connector/plugin-extras`, `scripts/*`) | 11 | 34 | 12 |
| Connector README and ARCHITECTURE | 2 | 14 | (counted above) |
| Root README and `docs/*.md` | 2 | 9 | 2 |
| Landing and wiki (read only here) | 3 | 39 | 2 |

"Daemon scripts" are `lock.mjs`, `unlock.mjs`, `measure.mjs`, `init-tracks-summary.mjs`, plus `make install` and `laneconductorrc`. `legacy/` of the source skill (5 files) names `lc` throughout; the plugin build does not ship it and the track leaves it alone (it belongs to what the Remote tier will inherit). `plugins/**` is generated and only checked, never edited by hand.

## Wanted outcome

1. No text or script that the three plugins ship names an `lc` subcommand, `which lc`, `make install`, `~/.laneconductorrc`, `lock.mjs`, `unlock.mjs`, `measure.mjs`, `init-tracks-summary.mjs` or `lc track-dir`. Each former mention says what to do now: use the connector's tool when the parallel add-on is installed, edit the track files directly otherwise, run the board add-on's script for the board, or the sentence is gone.
2. `.laneconductor.json` is an optional settings file, written down in one reference (`ops/settings.md`, see D1). Setup never creates it, never probes it, never needs it. The connector, the board script, the scaffold and the board commands all agree on the same keys.
3. `/laneconductor:setup` ends with a short "what else fits this project" step built from the catalog: which of `laneconductor-parallel` and `laneconductor-board` are not installed and fit, why, and the install commands, each command alone in its own bash fence, with the reload step. Nothing is installed without the person's yes, and Claude runs none of the commands. A slot stays for the skill advisor (track 10124).
4. The root README, the connector README and architecture notes, the plugin READMEs and the privacy page describe the plugin way only. A list of the landing and wiki changes is ready for the owner; the landing is not edited here.
5. Tests keep it true: no `lc` subcommand or `make install` in shipped text, the base stays free of daemon-era words, and a walk-through of setup on a scratch repository with no `lc` on PATH.

## Requirements

- REQ-1: The replacement rule for every mention is one of four, in this order: (a) the parallel add-on's connector tool, when its tools exist (never assumed); (b) a direct file edit following `ops/tracks.md`; (c) the board add-on's script, found by the Glob in the catalog; (d) delete the sentence, when it described a worker, lock, daemon or database that does not exist. Never "run `lc ...` if it exists".
- REQ-2: Setup, new-project and scaffold text never contain `lc` as a command, `which lc`, `command -v lc`, `.laneconductor.json`, `~/.laneconductorrc` or `make install`. Claude does not look for them, whatever exists on the machine.
- REQ-3: The source skill is rewritten in place (D4). The base-only rewordings in `scripts/plugin-texts.mjs` (`DAEMON_FREE_EDITS`, parts of `skillEdits`) that exist only to hide daemon-era source text are removed together with the source text they hid; the generator keeps only the add-on aware edits. A missing anchor still throws, so a half-done change fails the build.
- REQ-4: `.laneconductor.json` follows D1: optional; keys `connector.state_branch`, `connector.push`, `board.artifact_url`, `board.include_docs`, `board.include_conversation`, `project.name`; unknown keys, including the old `mode`, `collectors`, `worker`, `project.id`, are ignored without error or warning and are never rewritten. The one reference lists these keys, and a test checks that every key the code reads is listed there.
- REQ-5: The new-project scaffold no longer creates `.laneconductor.json`. The state branch resolves without it (`origin/HEAD`, else `main` or `master`), which is already how the connector works.
- REQ-6: The setup recommendation step is generated from `connector/plugin-extras/recommended-plugins.json` (new field `setup_fit`, one line per entry: when this project calls for it). It lists only entries not installed (by the entry's own `detect`), only those that fit what setup read, at most one short paragraph each: why, what it installs (the catalog already says plainly when it installs code), the two install commands, each in its own ```bash fence, then `/reload-plugins`. It never runs a command, never installs without a yes, never repeats itself in the same session, and asks nothing when nothing fits.
- REQ-7: The skill advisor's hook (`<!-- Starter set: reserved for the skill advisor (track 10124) -->`) stays in `setup/setup.md` and `ops/new-project.md`, directly after the new step, so track 10124 adds generic-skill entries to the catalog and they flow into the same step. This track adds no skill entries (D5).
- REQ-8: No daemon, worker, database or `lc` code is deleted. `bin/lc.mjs`, `conductor/`, `ui/`, `cloud/`, `migrations/`, `legacy/` and the tag `v1-legacy` stay as they are.
- REQ-9: Files of other sessions stay untouched: the uncommitted tracks AM-10107, 10108, 10110-10113 and everything under `landing/` are not edited by this track until their owner commits them; the landing changes wait for the owner's go (Phase 7).

## Decisions for the owner (proposals; each has a default so the work can start)

- **D1. What `.laneconductor.json` is.** Proposal: an optional, personal settings file. Not created by setup, not required, not probed. Keys exactly: `connector.state_branch`, `connector.push` (`ask` default, `auto-state`), `board.artifact_url`, `board.include_docs`, `board.include_conversation`, `project.name`. Everything else in an old file is ignored. It is added to `.gitignore` (setup adds the line when it is first written, and the board command adds it before storing a URL), because it holds the private board URL. Alternative: delete the file and move the few keys into `conductor/workflow.json` under `settings`; cleaner (one control file) but it changes the connector, the board script and every existing project. Default if no answer: the proposal.
- **D2. Where the board URL lives.** Proposal: `board.artifact_url` stays in `.laneconductor.json` (gitignored, per D1), so a private URL is never committed. Today the scaffold writes the file committed while this repository's own `.gitignore` ignores it and `ops/board.md` says it is gitignored: the three disagree, which D1 fixes.
- **D3. Script file names `lc-board.mjs`, `lc-scaffold.mjs`, `lc-connector.mjs`.** Proposal: keep them. They are plugin-internal paths found by Glob (also in the published catalog `detect` field and in already installed plugins), never on PATH, and `lc` is also the connector's MCP server key and tool prefix. Renaming breaks detection between an old base and a new add-on and touches about 20 files. What changes is prose: say "the board script" and "the scaffold script", and the stderr prefix `lc board:` becomes `board:`. Alternative: rename to `board.mjs` and so on, as a separate track.
- **D4. Rewrite the source skill in place (and drop the base-only rewordings), or keep two texts.** Proposal: rewrite in place. The daemon is stopped and its text lives at `v1-legacy` and in the unlinked `legacy/` folder. Keeping two texts is what let `lc new` stay in the base for months.
- **D5. Starter skills in setup.** Proposal: this track makes the step work for any catalog entry but ships only the two add-ons; the Superpowers and other skill entries come with track 10124, which must verify each source exists. Alternative: add one or two entries here.
- **D6. Landing and wiki.** Proposal for the list in plan.md Phase 7: relabel the whole "Legacy tier" part of the wiki as "LaneConductor Remote (separate, planned)", delete the two CLI reference sections (a CLI that does not exist), and move `landing/docs/jira-integration.md` under that heading. The owner decides the wording and the timing.
- **D7. Deploy and KPI text.** `lc deploy` and the `lc setup-deploy` wizard, and `node conductor/measure.mjs` (KPI measurement) have no plugin equivalent. Proposal: `deploy/setup-deploy.md` becomes a chat procedure (Claude does the scan and the questions the wizard did, writes `conductor/deploy.json`, runs the deploy command only after a yes); the quality gate reads the KPI number from its named source by hand or asks the person, and records it. Alternative: remove `deploy` from the base and plan a deploy track.
- **D8. Merge lane text.** Proposal: replace `lc worktrees merge` and `lc worktrees create-pr` with the plain git and `gh` steps, written out, each asked about before a push (the lane already says so), and drop the daemon-era wording found in the same file (global main-mode lock, reconciler, DB `merge_mode` column).

## Acceptance criteria

- [ ] On a scratch repository with no `lc` on PATH and no `~/.laneconductor.json`-style file, `/laneconductor:setup` runs to the end: the `conductor/` folder and the first tracks exist, and the session never ran or mentioned `which lc` or any `lc` command and never read `.laneconductor.json` (checked by reading the transcript).
- [ ] On a machine that still has the old `lc` and `~/.laneconductorrc` (this one), the same run behaves the same: they are not looked for.
- [ ] After the project is read, setup says which of the two add-ons are not installed and fit this project, why, and shows each install command in its own fence; nothing is installed, and a plugin that is already installed is not recommended.
- [ ] `grep` for an `lc` subcommand, `which lc`, `make install`, `laneconductorrc`, `lock.mjs`, `unlock.mjs`, `measure.mjs` or `track-dir` over the three generated plugins, the source skill (without `legacy/`), the root README, `docs/*.md` (without `docs/superpowers/`) and the connector docs finds nothing.
- [ ] A project that still has an old `.laneconductor.json` (with `mode`, `collectors`, `project.id`) works unchanged: the connector, the board script and setup give no error or warning about it.
- [ ] The board still publishes and refreshes with the board add-on alone (no `lc`), and `show-board` still reads the stored URL.
- [ ] `bin/lc.mjs`, the daemon folders and the `v1-legacy` tag are untouched; `git diff --stat` shows no deletion under `bin/`, `conductor/*.mjs`, `ui/`, `cloud/`, `migrations/`.
- [ ] The landing and wiki change list is written down, and no file under `landing/` was edited by this track before the owner's go.

## Out of scope

- Deleting daemon, worker, database, `ui/`, `cloud/` code or the tag `v1-legacy`; removing `bin/lc.mjs`.
- Changing `/usr/local/bin/lc` (a symlink to `/home/meller/Code/laneconductor/bin/lc.mjs`, created 2026-03-03) or `~/.laneconductorrc` on this machine: the owner is told they exist.
- Building the Remote tier or its plugin; Jira.
- Renaming the `lc-*.mjs` script files, the MCP server key `lc` or the tool prefix (D3).
- Writing the skill advisor's catalog entries (track 10124).
- Deploying the landing, or editing it before the owner's go.
- Adjacent daemon-era residue that the base test does not name (`tracks-metadata.json`, `file_sync_queue.md`, `.conductor/locks`, `FRESH_SESSION`, `last_run.log`: about 38 lines in 15 files). The edits of this track remove the ones inside lines it already rewrites; a full sweep is a follow-up.

## Decision recorded 2026-11-18

The board add-on is offered once in setup, next and new-project, instead of being detected, because an installed plugin cannot be detected without reading outside the project (track 10132 made those commands read-free). This knowingly replaces the detection wording of REQ-6 and TC-17 for the board add-on.
