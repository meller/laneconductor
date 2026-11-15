# Spec: Restructure the laneconductor skill (split by lane, fix frontmatter, drop Postgres-era weight)

## Problem Statement

`.claude/skills/laneconductor/SKILL.md` is one 2,392-line / 129,829-byte file (about 32k
tokens) with no supporting files. Every invocation loads all of it, including setup
templates, the Postgres schema (twice), daemon commands and a duplicated `remote-sync`
section. The lane commands start at line 1,411. After compaction Claude Code re-attaches
only the first 5,000 tokens of an invoked skill, so the lane rules (the part that matters
during a run) are exactly the part that gets dropped. The frontmatter carries an
undocumented `parameters` block of about 80 lines and a description that only fires on
explicit slash commands and advertises "local Postgres".

The skill is symlinked from the install path into every project, so a change reaches every
project at once. The daemon and the `lc` CLI call it with fixed command strings.

## Investigation results (verified against the code on 2026-11-15)

### 1. Everything that depends on the skill file, its headings or its command names

| Where | What it does | Breaks if... |
|---|---|---|
| `conductor/laneconductor.sync.mjs:7869-7872` (`buildCliArgs`) | Builds `Skill definition is at: ./.claude/skills/laneconductor/SKILL.md` (install-path fallback) and the prompt `/laneconductor <cmd> <n>`. Maps `quality-gate` -> `qualityGate` (7880) and `done` -> `merge` (7881). | `SKILL.md` is renamed or moved; the `qualityGate` or `merge` command names disappear from the skill. Headings are **not** read. |
| `conductor/laneconductor.sync.mjs:8548` | Brainstorm replies call `buildCliArgs('laneconductor','brainstorm',...)`. | `brainstorm` command removed. |
| `conductor/laneconductor.sync.mjs:8530-8543` | Conversation replies are a custom prompt that tells the agent to use `/laneconductor comment N` and `/laneconductor move N implement:queue`. | `comment` or `move` is removed or moved out of reach of the index. |
| `conductor/laneconductor.sync.mjs:8862`, `:10732` | Queue claim and manual dispatch pass the lane or `entry.action` as the command. | Any lane command name changes. |
| `conductor/laneconductor.sync.mjs:9242-9243` (create-project) | Prompt `/laneconductor setup scaffold generate`, pointing at the **install path's** `SKILL.md`. | `setup scaffold generate` is moved to another skill, or `SKILL.md` moves. |
| `conductor/laneconductor.sync.mjs:6318` | Comment only: "SKILL.md is too large to inject into every prompt." | Nothing. |
| `bin/lc.mjs:444-456` (`runAIAgent`) | Reads `<project>/.claude/skills/laneconductor/SKILL.md` and **inlines its full text** into the prompt for non-Claude CLIs (agy, gemini->agy, other). It does not pass the skill directory. | After the split the inlined text is only the index. The agent must still find `lanes/<x>.md`, so the index has to name the default directory (`.claude/skills/laneconductor/`) as a fallback. |
| `bin/lc.mjs:1448`, `:1705` | `runAIAgent(cfg, '/laneconductor setup scaffold generate')`, `'/laneconductor setup-deploy generate'`. | Those command names change. |
| `bin/lc.mjs:3300-3303` (`lc <lane> N --run`) | Builds `/laneconductor qualityGate N` for quality-gate (alias again). | The alias is lost. |
| `bin/lc.mjs:100-105` (`getInstallPath`) | Reads `~/.laneconductorrc` (the skill **directory**) and resolves the repo root as `../../..`. | The skill directory moves (it will not). |
| `bin/lc.mjs:1180-1200`, `Makefile:1,55` | `lc setup` symlinks the whole skill **directory** into `.claude/skills/laneconductor` and `.agents/skills/laneconductor`. `make install` writes the directory path to `~/.laneconductorrc`. | Nothing. A directory symlink carries the new subfolders. A second skill would need a second symlink in every project (see decision 4). |
| `conductor/services/claude-dir-copy.mjs` (`copyClaudeDir`, `cpSync` recursive) | Copies the primary `.claude/` into each new worktree. It copies whole subtrees, and a symlinked skill dir stays a symlink (`cpSync` does not dereference). | Nothing, but this is not tested today for a skill subfolder (see test.md). |
| `conductor/services/slash-commands.mjs` | Static list of 25 commands for the UI composer. Its comment says it is sourced from SKILL.md's Quick Reference. | Nothing at runtime. Every name listed must still resolve in the new command table (test). |
| `conductor/tests/track-10097-scaffold-gitignore.test.mjs:139-167` | **The only test that reads skill text.** It reads `SKILL.md`, finds the marker ``Ensure `.gitignore` covers the sync-only runtime files``, compares the next fenced block with `RUNTIME_STATE_PATTERNS`, and requires the text ``Do **not** add`` plus `index.md`. | Both tests fail as soon as the scaffold section leaves `SKILL.md`. They must be retargeted to `setup/scaffold.md`. |
| `conductor/agent-runtime.mjs:268` | Builds a skill path, but the file is marked UNUSED (imported by nothing, track 10062). | Nothing. |
| `.agents/rules/laneconductor.md` | Antigravity workspace rule, symlinked into projects. It does not reference SKILL.md, but it is stale (it writes `**Status**` and names a `ready` lane). | Nothing. Out of scope; noted as a follow-up. |
| Code comments that say "SKILL.md step N" or "SKILL.md's marker table" (`sync.mjs:2493,5625,9058,10173`, `claim-scope.mjs:89`, `marker-ownership.mjs:52`, `waiting-state.mjs:92`, `ui/server/index.mjs:2574`, `WorktreesPanel.jsx:697`, several tests) | Prose only. | Nothing at runtime. They may go stale; that is acceptable. |

**No code parses SKILL.md headings.** The runtime contract is: the file path
`.claude/skills/laneconductor/SKILL.md`, the skill name `laneconductor`, and these command
strings: `plan`, `brainstorm`, `implement`, `review`, `qualityGate` (plus `quality-gate`),
`merge`, `comment`, `move`, `setup scaffold generate`, `setup-deploy generate`, and every name
in `SLASH_COMMANDS`.

### 2. How split files resolve when the skill is symlinked

- `lc setup` and the scaffold step symlink the **directory**
  (`ln -sf "$SKILL_DIR" .claude/skills/laneconductor`), so `lanes/`, `ops/`, `setup/`,
  `deploy/` and `legacy/` travel with it. The official docs confirm that a skill entry may be
  a symlink to a directory: Claude Code reads `SKILL.md` from the target.
- Relative links in `SKILL.md` (`lanes/plan.md`) resolve against the skill directory. When
  Claude Code invokes the skill it supplies the skill's base directory. In daemon prompts the
  `Skill definition is at:` path supplies it. `${CLAUDE_SKILL_DIR}` exists, but it is only
  substituted for Claude Code, and the agy path would see it as literal text, so it is **not**
  used.
- Worktrees: in this repo the skill is tracked in git, so a worktree checks out the branch's
  own copy. In other projects the symlink is copied as a symlink by `copyClaudeDir`. Both
  cases carry the subfolders.
- Weak spot: `lc.mjs runAIAgent` inlines the text with no path. Fix with one index line:
  "Supporting files sit next to this SKILL.md; in a project that is
  `.claude/skills/laneconductor/`." No code change.
- Skill-only users who copy files by hand (Windows, Claude Desktop) must copy the whole
  folder. The install note says so.
- Substitution hazard (MEMORY.md, already happened once): Claude Code substitutes `$0`,
  `$1` and `$ARGUMENTS` in the rendered `SKILL.md`. Supporting files read with the Read tool
  are not substituted. So the index must contain no `$<digit>` or `$ARGUMENTS`. The SQL with
  `$1` can live in `legacy/`.

### 3. Target layout

```
.claude/skills/laneconductor/
├── SKILL.md                 index: frontmatter, routing table, shared protocols (<=200 lines, <=20,000 bytes)
├── lanes/
│   ├── plan.md              /laneconductor plan
│   ├── brainstorm.md        /laneconductor brainstorm
│   ├── implement.md         /laneconductor implement
│   ├── review.md            /laneconductor review
│   ├── quality-gate.md      /laneconductor quality-gate | qualityGate
│   └── merge.md             /laneconductor merge (the done lane)
├── ops/
│   └── tracks.md            newTrack, move, pulse, comment, delete, revert, status, workflow [set],
│                            updateTrack, reportaBug, featureRequest, init-tracks-summary
├── setup/
│   ├── setup.md             setup, install, setup collection, operating modes
│   ├── scaffold.md          setup scaffold, setup scaffold generate (holds the .gitignore fence)
│   └── templates.md         design-language, kpis, quality-gate, user-stories, workflow.md templates
├── deploy/
│   ├── setup-deploy.md      setup-deploy [generate]
│   └── deploy.md            deploy [env]
└── legacy/                  parked daemon/DB-era material, never linked from lane files
    ├── worker.md            lc worker CLI, activate/start, deactivate/stop, lock/unlock, retries, logging
    ├── db-schema.md         both CREATE TABLE copies, merged, with the differences noted
    ├── syncdb.md            syncdb
    └── remote-sync.md       remote-sync (one copy)
```

`ops/` is not in the index.md outline. It is added because `comment`, `move`, `pulse` and
`newTrack` are live, not legacy: the daemon's conversation-reply prompt calls `comment` and
`move`. They are too long for the 200-line index.

#### Section-by-section disposition (current line numbers)

The Pruning rule applies: keep a line only if it carries a project-specific fact or a lesson
from a real incident. Generic advice is deleted, not moved.

| Lines | Current section | Goes to | Pruning notes |
|---|---|---|---|
| 1-84 | Frontmatter incl. `parameters` | SKILL.md (rewritten) | `parameters` deleted (not a documented field). `user-invocable: true` dropped (it is the default). |
| 85 | superpowers MIT attribution | SKILL.md | Kept (license notice). |
| 87-89 | Title + "local Postgres... port 8090" tagline | deleted | Replaced by a one-line purpose that names files, not Postgres. |
| 91-95 | Modes of Operation | deleted | Covered by the index line "works with or without a worker". |
| 98-141 | Universal CLI (`lc`) | legacy/worker.md | Keep the `lc worker run` vs `--sync-and-work` warning (incident: it claims anything queued), the `--only-tracks` and Auto Run gate facts, and the `add-target` syntax. The index keeps only `lc track-dir`, `lc new`, `lc move` and `lc status`. |
| 145-161 | Installation | setup/setup.md | Keep the symlink-propagation fact and add "copy the whole folder". |
| 165-191 | Architecture (Postgres diagram) | deleted | Stale. `product.md` is the architecture source. |
| 193-232 | Protocol: conversation.md format | SKILL.md | Condensed to the format, the long-material rule, and the reason (the parser silently drops anything else). |
| 234-286 | Protocol: session continuity | SKILL.md | Condensed: `FRESH_SESSION` meaning, "on-disk wins" (AM-1020/AM-10090 incident, one line), digest backstop named. |
| 288-318 | Protocol: locating tracks | SKILL.md | Condensed: `lc track-dir`, both naming conventions, the scan fallback, and never scaffolding a duplicate (10040 Finding 6). |
| 322-345 | `setup` | setup/setup.md | as is |
| 349-557 | `setup scaffold generate` + its templates + symlink block | setup/scaffold.md, with templates in setup/templates.md | Quality-gate template kept verbatim (updated by commit 50b1b613). |
| 561-727 | `setup scaffold` (foreign-track import, env check, .gitignore fence) | setup/scaffold.md | The `.gitignore` fence and the `Do **not** add ... index.md` text stay word-for-word (test-locked). |
| 730-764 | workflow.md template + workflow.json copy | setup/templates.md | as is |
| 768-925 | `setup collection` | setup/setup.md | Delete the dated model names "Claude 3.5 Haiku / 3.7 Sonnet". Keep the alias facts and the LC-cloud "not fully supported (10052)" warning. |
| 927-961 | DB schema creation (local-api) | legacy/db-schema.md | Merged with 2189-2222. The two copies differ; record both and the differences, without picking a winner. |
| 965-976 | Lane state machine / boundary rules | SKILL.md (one rule) + each lane file (its own boundary) | |
| 978-981 | Orphaned psql snippet | legacy/db-schema.md | |
| 985-1016 | `activate`/`start`, `deactivate`/`stop` | legacy/worker.md | The `.sync.pid` kill script is replaced by `lc worker stop`. |
| 1020-1050 | `status` | ops/tracks.md | ASCII board deleted. "run `lc status`; without `lc`, read Lane/Progress from each index.md". |
| 1054-1097 | `workflow`, `workflow set` | ops/tracks.md | The stale lane names (`planning`, `in-progress`) in "valid values" are corrected to the real lanes and `lane:status` form. |
| 1101-1213 | `setup-deploy generate` | deploy/setup-deploy.md | as is |
| 1217-1225 | `deploy [env]` | deploy/deploy.md | as is |
| 1229-1248 | Filesystem-as-API marker table | SKILL.md (compact, one line per marker) + detail into the lane that writes the marker | The `**Status**` row is deleted (legacy back-compat only, track 1102 F3; `parseStatus` reads `**Lane**` first). Verdict detail goes to review/quality-gate; Track Kind/Workspace to plan; Merge Mode/PR URL to merge; Depends On/Waiting On Tracks stay in the index (any lane can park). |
| 1250-1267 | Completion comment convention | SKILL.md | Condensed. Every lane uses it. |
| 1269-1284 | `qualityGate` (stale short duplicate) | **deleted** | It contradicts the real `quality-gate` section (it says PASS -> `done` + `success`). The daemon invokes `qualityGate`, so it becomes an **alias row** that routes to lanes/quality-gate.md. |
| 1288-1302 | `move` | ops/tracks.md | |
| 1306-1318 | `pulse` | ops/tracks.md | Stop writing `**Status**`. Keep Progress/Phase/Summary/`**Step**` (still parsed, `sync.mjs:2662`) and the Waiting-for-reply rule. |
| 1322-1376 | `newTrack` | ops/tracks.md | Prefer `lc new`. Keep the initials rule, the default `direct`/`yes` change (2026-09-08), and the file_sync_queue entry. |
| 1380-1407 | `lock`/`unlock` (JS pseudo-code) | legacy/worker.md | Pseudo-code replaced with the real `conductor/lock.mjs` / `unlock.mjs` usage. |
| 1411-1513 | `plan` | lanes/plan.md | Step 6 "pulse NNN planning 0%" deleted ("planning" is not a lane; step 0 already claims). Spec/plan/test templates copied in. |
| 1517-1538 | `brainstorm` | lanes/brainstorm.md | |
| 1542-1664 | `implement` | lanes/implement.md | The "never end on a background command" rule appears twice (1613-1621, 1625-1635); keep one. "Update index.md to `**Status**: implement`" deleted (step 0 writes `**Lane**`). The lock pseudo-call is replaced by: "a worker/runner already holds the lock and put you in the worktree; by hand, use `conductor/lock.mjs`". test.md template copied in (self-healing needs it). |
| 1668-1703 | `review` | lanes/review.md | "see implement's step 0 for why" replaced by the one-line reason inline. |
| 1707-1832 | `quality-gate` | lanes/quality-gate.md | Same inline replacement. |
| 1836-1924 | `merge` | lanes/merge.md | |
| 1928-1934 | `remote-sync` (first copy) | **deleted** | Duplicate. |
| 1936-1938 | stray double `---` | deleted | |
| 1940-1945 | `comment` | ops/tracks.md | |
| 1949-1960 | `delete` | ops/tracks.md | The lock path disagrees (`conductor/.locks/` here vs `.conductor/locks/` in `lock.mjs`); implement must check `lock.mjs` and write the real one. |
| 1964-1970 | `revert` | ops/tracks.md | |
| 1974-2010 | `syncdb` | legacy/syncdb.md | |
| 2014-2051 | `remote-sync` (second copy) | legacy/remote-sync.md | |
| 2055-2107 | `init-tracks-summary` | ops/tracks.md | Reduced to "run `conductor/init-tracks-summary.mjs` from the install path"; the output example and benefits list are deleted. |
| 2111-2185 | Track file templates | lanes/plan.md (spec/plan/test), lanes/implement.md (test only) | The `index.md` template (it writes `**Status**: backlog`) is deleted; newTrack's template is the real one. |
| 2189-2222 | DB schema reference | legacy/db-schema.md | |
| 2226-2239 | Status badges -> lane mapping | deleted | Heuristic fallback in `parse-status.mjs` that only applies with no `**Lane**`; every lane writes `**Lane**`. The `## ✅ REVIEWED` etc. headings stay in their lane files. |
| 2243-2249 | Multi-project notes | deleted | Postgres-era. The one fact (one `.laneconductor.json` per repo) already sits in setup. |
| 2253-2260 | Commit convention | SKILL.md (one line) | |
| 2264-2276 | Handling automation failures | legacy/worker.md | "configured in workflow.md" corrected to workflow.json `max_retries`. |
| 2280-2318 | Dev logging (Pino, port 6201) | legacy/worker.md | Keep the port-6201-never-6200 rule. |
| 2322-2326 | Best practices | deleted | #2 names a command that does not exist (`summarize`). #3's fact (progress from plan.md checkboxes) moves to one index line. |
| 2328-2362 | Quick reference | SKILL.md routing table | |
| 2366-2391 | Operating mode configuration | setup/setup.md + one index line | |

### 4. One skill or two (laneconductor + laneconductor-setup)

**Recommendation: keep one skill now.** Put setup/deploy in `setup/` and `deploy/` and
re-evaluate after tracks 10106/10107 replace `lc setup`.

- The token saving comes from splitting files, not from splitting skills. With routing, a lane
  run never reads `setup/` anyway.
- A second skill means every existing project needs a second symlink (`lc setup`,
  scaffold, `.agents/skills`), and `~/.laneconductorrc` holds only one directory. Projects that
  are not re-set-up would silently lose `setup scaffold`.
- Three call sites name `/laneconductor setup scaffold generate` / `setup-deploy generate`
  (`sync.mjs:9243`, `lc.mjs:1448`, `lc.mjs:1705`), plus `setup-gaps.mjs:125,135` remedies.
  All would change, which breaks the "command names never change" rule.
- Accidental model invocation of setup is guarded in text: the routing table marks setup,
  deploy and delete as "only when the user names the command", and `when_to_use` says so.
  `disable-model-invocation` can be revisited if a two-skill split happens later.

### 5. Frontmatter (final text; description + when_to_use = 829 characters, cap 1,536)

```yaml
---
name: laneconductor
description: Plan, implement, review, quality-gate and merge LaneConductor tracks - the folders under conductor/tracks/ holding index.md, spec.md, plan.md, test.md and conversation.md - and create, move, update or comment on them. Use for any work on a LaneConductor track or any /laneconductor command.
when_to_use: Use when the user says things like "plan track 10109", "plan this", "write the spec for track N", "implement track N", "review track N", "run the quality gate on N", "merge track N", "create a track for ...", "file a bug as a track", "move N to implement", "comment on track N" or "what is the status of track N", and for the worker's automated prompts "/laneconductor plan|implement|review|qualityGate|merge N". Setting up LaneConductor in a repo (setup, setup scaffold, setup-deploy, deploy) runs only when the user asks for it by name.
argument-hint: "[command] [track-number] [args]"
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---
```

- Removed: `parameters` (undocumented), `user-invocable: true` (default).
- Added: `when_to_use`, `argument-hint`.
- Deliberately **not** added:
  - `model` / `effort`: they would override the per-lane / per-track model resolution in
    `workflow.md` "Model Overrides".
  - `context: fork`: it would break the daemon's per-track session resume (track 1086). The
    choice belongs to 10108.
  - `disable-model-invocation`: see decision 4.
  - `paths`.
- **Deviation from the index.md outline:** "run track N" is left out of the triggers. It is the
  trigger of the `lane-runner` skill (track 10108), which runs a track through all lanes. Two
  skills claiming one phrase would make invocation ambiguous. `laneconductor` owns single-lane
  and track-ops phrasing.
- No angle brackets (rendered as `&lt;`). The YAML must parse; a test checks this.

### 6. Index content (SKILL.md body, <=200 lines)

In order, so the protocols are in the first 5,000 tokens:

1. A one-line purpose, plus "Paths below are relative to this file's directory (in a project:
   `.claude/skills/laneconductor/`)".
2. **How to run a command.** Take the first argument and find it in the table. Read the named
   file in full before doing anything else. That file plus this index is the whole
   instruction set. After compaction, read the lane file again, because a Read result is not
   re-attached the way the skill is. Unknown command: say so and stop; do not improvise.
3. **Routing table:** command + aliases -> file, plus a "model may invoke unprompted?" column
   (no for setup*, deploy, delete, syncdb). `qualityGate` and `quality-gate` -> lanes/quality-gate.md;
   `done` -> lanes/merge.md; `start`/`activate`/`stop`/`deactivate`/`lock`/`unlock` -> legacy/worker.md;
   `updateTrack`/`reportaBug`/`featureRequest` -> ops/tracks.md (which says to run
   `lc update-track` / `lc report-bug` / `lc feature-request`, `bin/lc.mjs:2944,2998`. Today
   these commands have no body in SKILL.md at all).
4. Shared protocols: conversation.md format; session continuity; locating tracks; workflow.json
   is the only transition authority (`lane:status` form); the human-move-wins re-read before
   any transition; completion comment convention; parking with `**Waiting On Tracks**`.
5. Compact marker table (Lane, Lane Status, Progress, Phase, Summary, Step, Waiting for reply,
   Workspace, Track Kind, Auto Run, Merge Mode, PR URL, Verdict, Depends On, Waiting On
   Tracks), one line each.
6. Commit convention (one line) and "progress is derived from plan.md checkboxes".

## Requirements

- REQ-1: `SKILL.md` is at most 200 lines and at most 20,000 bytes, so the whole index survives
  compaction's 5,000-token re-attach. The hard ceiling from the docs is 500 lines.
- REQ-2: The frontmatter is exactly the block in section 5: only documented fields, no
  `parameters`, description + `when_to_use` <= 1,536 characters, and the key use case first.
- REQ-3: Every command name the daemon, the CLI or the UI can send resolves through the
  routing table to an existing file. That covers every name in `SLASH_COMMANDS` plus
  `qualityGate`, `quality-gate`, `done`, `merge`, `brainstorm`, `comment`, `move`,
  `setup scaffold generate` and `setup-deploy generate`. No command name is renamed.
- REQ-4: Each lane file plus `SKILL.md` is enough to run that lane. A lane file does not refer
  to another lane file or to `ops/`, `setup/`, `deploy/` or `legacy/`. It does not say "see
  <other command>'s step N".
- REQ-5: Lane and marker semantics are unchanged. Each lane keeps:
  - its claim step (`**Lane**: <lane>` + `**Lane Status**: running`);
  - its re-read-before-transition rule;
  - its `workflow.json` transition key;
  - its `**Verdict**` writes (review and quality-gate) and Verdict clearing at claim;
  - its completion comment emoji;
  - the done-gate and stub scan (quality-gate);
  - direct/pr/conflict handling with `lc worktrees merge` / `create-pr` and
    `**Lane Status**: waiting` (merge);
  - Track Kind classification and the fundamentals-conflict guardrail (plan, implement);
  - KPI and Draft handling (plan, implement, quality-gate);
  - the FRESH_SESSION skip rules.

  The exact strings are frozen in Phase 1 (`invariants.json`) and checked by a test.
- REQ-6: The only intended behaviour corrections (each called out in the commit message):
  - `qualityGate` routes to the full quality-gate procedure instead of the stale short
    section;
  - lane files no longer write the legacy `**Status**` marker;
  - plan no longer pulses "planning";
  - the duplicate remote-sync section is removed;
  - stale facts are corrected (model names, `workflow.md` -> `workflow.json`, valid lane
    names, the lock path).
- REQ-7: Legacy material is kept in `legacy/` and is reachable only through the routing table.
- REQ-8: `track-10097-scaffold-gitignore.test.mjs` reads `setup/scaffold.md`, and its fence is
  word-for-word what it is today.
- REQ-9: A per-lane run loads `SKILL.md` plus one lane file, at most 32,000 bytes (about 8k
  tokens, at most 25% of today's 129,829 bytes). Target: 15%.
- REQ-10: No `$<digit>` or `$ARGUMENTS` literal in `SKILL.md` (argument substitution hazard).

## Acceptance Criteria

- [ ] AC-1: A real `claude -p "/laneconductor plan <n>"` run on a throwaway track moves it to
      `plan:success`, writes real spec/plan/test, and posts `✅ Plan complete`. Its transcript
      shows it read `lanes/plan.md` and nothing under `setup/` or `legacy/`.
- [ ] AC-2: The transcript of a `/laneconductor qualityGate <n>` invocation (the exact
      string the daemon sends) on a throwaway track shows `lanes/quality-gate.md` read first
      and the claim written as `**Lane**: quality-gate` / `**Lane Status**: running` with
      `**Verdict**` cleared. The run may be stopped after the claim; a full gate run is not
      required.
- [ ] AC-3: In a fresh session with no slash command, "plan track <n>" and "create a track
      for X" each invoke the laneconductor skill (spot-check recorded in conversation.md).
- [ ] AC-4: The daemon's mock-CLI suites listed in test.md pass with the same results as on
      `main` (diff-confirmed, not assumed).
- [ ] AC-5: In a temp project whose `.claude/skills/laneconductor` is a symlink to the skill
      dir, every relative link in SKILL.md opens; a worktree copy made with `copyClaudeDir`
      also has `lanes/plan.md`.
- [ ] AC-6: Measured sizes: SKILL.md <= 200 lines / 20,000 bytes; SKILL.md + any one lane
      file <= 32,000 bytes. A before/after table is recorded in plan.md.
- [ ] AC-7: The skill structure test (`track-10109-skill-structure.test.mjs`) passes,
      including frontmatter validity, routing completeness, self-containment and the frozen
      invariants.

## Out of scope / follow-ups

- `.agents/rules/laneconductor.md` (Antigravity rule) is stale: it writes `**Status**` and names
  a `ready` lane. A separate track.
- Changing `lc.mjs runAIAgent` to pass the skill path or inline the lane file. Not needed
  because of the index fallback line. Revisit with 10106.
- Removing legacy commands from `SLASH_COMMANDS` / the UI. That belongs to 10106/10107.
- Two-skill split. Revisit after 10106/10107.
