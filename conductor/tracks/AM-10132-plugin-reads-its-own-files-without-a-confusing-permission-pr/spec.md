# Spec: Plugin reads its own files without a confusing permission prompt

## Problem Statement

When a user runs `/laneconductor:setup` (or any command that reads a file from the plugin's own install folder, `~/.claude/plugins/cache/...`), Claude Code asks "Allow this read outside the working directories?" with four options. Two of them change a permanent, global setting ("keep allowing any reads outside the working directories" / "block reads outside the working directories from now on"). A new user cannot tell what the question means, and one wrong answer (block) would break every LaneConductor command in every project. Seen on 2026-11-18 in the Fiti PLUG first run of setup; the user called the questions "very unclear".

Goal: a plugin command should be able to read its own files without any prompt, or with at most a clear one.

- Symptom: the "Allow this read outside the working directories?" prompt on a plugin command's first read of its own folder.
- Steps to reproduce: run `/laneconductor:setup` in a project with the plugin installed from the cache.
- Headless finding (2026-11-18): `claude -p "/laneconductor:setup"` with the installed 1.2.0 stopped: the model could not find the plugin's install path and the read of `ops/new-project.md` was denied. Reproduced again on a scratch copy of the project.
- Suspected area: commands and the skill that point at files in the plugin install folder, outside the project.

## Requirements

- REQ-1 A plugin command reads its own files without any prompt, or with at most a clear one.
- REQ-2 The four options are evaluated in this order and each result is recorded: (1) `allowed-tools: Read, Grep, Glob` in the skills' and commands' frontmatter (the directory portal must still validate it); (2) inline the small amount of text a command needs into the command or skill body (setup.md, ops/new-project.md, lane guides first); (3) the connector (laneconductor-parallel) serves the guides, which it already does through `get_context`, while the base plugin stays Markdown-only; (4) README and setup message: one line saying which option to choose if the prompt still appears (allow once, not the permanent ones).
- REQ-3 The one-line note (choose the option that allows it this one time; the "keep allowing" and "block from now on" options change a permanent setting) is in the base README, `setup/setup.md`, `ops/new-project.md` and the generated `setup` command. Nothing asks a user to change their permission settings for LaneConductor.
- REQ-4 The setup interview is ONE message with everything pre-filled and detected (name, what it is for, stack, test, lint, typecheck and build commands with the reason for each one left out, where each fact came from, the tracks folder with a "private" option for a public repository), ending "Reply ok, or tell me what differs"; nothing is written until the reply. Applies to `ops/new-project.md` (existing repository path), `setup/setup.md` step 1 and the `setup` command step 1.
- REQ-5 Commands carry their procedure: `setup`, `next` and `new-project` are built at generation time from the shipped skill text (`scripts/plugin-inline.mjs`), so none reads outside the project. The other commands carry, under "Reference", the text they name, cut from the shipped skill (`scripts/plugin-references.mjs`): the lane guide and the status, transition, move, pulse, comment and finding sections for plan, brainstorm, implement, review, quality-gate, merge and run (run carries the five guides); the search-first, newTrack and bug/feature form sections for new, bug, feature, repair-duplicates; the board, settings and deploy files for the board and deploy commands. `setup` and `new-project` also carry `setup/scaffold.md` and the file templates, so nothing is read after the reply "ok". Links between skill files become skill-relative paths; the scaffold is done by hand, not by searching for the add-on's script.
- REQ-6 `next`: a missing `plan.md` or `test.md` counts as a stub (S17); a plan with real content (phases, checkboxes, prose, ticks) is not a stub (S16). The wording is in `ops/next.md` step 8 and the S17 row.
- REQ-7 The base plugin stays Markdown-only and passes the directory-portal emulation. The line limit on a command body (40 lines, `plugin-coverage.test.mjs`) is relaxed only for the commands that carry skill text, each with a stated reason in `scripts/plugin-references.mjs`.

## Decisions

- Option 1 (`allowed-tools`) is evaluated and NOT shipped. On a scratch copy of the base, `claude plugin validate --strict` passes for `Read, Grep, Glob`, for a path-scoped `Read(~/.claude/plugins/cache/**)` and even for `Bash` (the local validator does not model the directory portal's allowed-tools rule; the repository's record of the portal's report says only Read, Grep, Glob and LS are accepted). An unscoped `Read` pre-approves reads of any path while the skill is active, not only the plugin's own folder, a wider grant than the problem needs; the scoped form is not known to pass the portal; whether either removes the prompt can only be seen in a real session. Open for the owner (TC-5, TC-6).
- Option 2 (inline texts) was first tried by a generator experiment and reverted, only because `plugin-coverage.test.mjs` kept every command body under 40 lines; it was superseded by REQ-5 after the headless finding (a command that points at a skill file prompts interactively and is denied headless), with the line limit relaxed for exactly those commands.
- Option 3 (the connector serves guides through `get_context`) is already true for people with the parallel add-on; the base stays Markdown only. Nothing to do.
- Owner decision (done): every other command carries the text it names, under "Reference" (REQ-5). The one read left outside the project is the board script of the separate board add-on (a Glob), by design.
- The board add-on is offered once in setup, next and new-project instead of being detected (see "Decision recorded 2026-11-18" below).

## Acceptance criteria

- [x] The README, `setup/setup.md`, `ops/new-project.md` and the `setup` command carry the one-line note and the "never ask to change permission settings" rule (REQ-3; `connector/test/permission-note.test.mjs`, which ran and passed in this checkout).
- [x] The setup interview is one pre-filled message ending "Reply ok, or tell me what differs", with the private tracks option, writing nothing before the reply (REQ-4; `permission-note.test.mjs`).
- [x] No shipped skill or command declares `allowed-tools` (REQ-2, option 1 not shipped; `connector/test/plugin-build.test.mjs` asserts the generated skill declares none).
- [x] The generated `setup`, `next` and `new-project` bodies contain their key sections and name no plugin-folder path, no plugin Glob and no link to read; every skill file a command names is carried under its Reference (REQ-5; `connector/test/inlined-commands.test.mjs`, which ran and passed in this checkout).
- [x] A missing `plan.md` or `test.md` counts as a stub and a realistic plan is not (REQ-6; `connector/test/next.test.mjs`, fixtures F16c, F16d, F17b).
- [x] Only the commands that carry skill text are exempt from the 40-line limit, each with a stated reason (REQ-7; `scripts/plugin-references.mjs`, `scripts/plugin-inline.mjs`, `plugin-coverage.test.mjs`).
- [ ] TC-5, a real session on 1.2.2: `/laneconductor:setup` and `next` in a project; record whether the client still asks "Allow this read outside the working directories?" and for which file. Not verified; needs a real session (owner).
- [ ] TC-6, only if option 1 is chosen: with `allowed-tools: Read, Grep, Glob` the prompt does not appear and the directory portal's Validate accepts it. Not verified; only if a prompt still shows (owner).

## Risks and limits

- The skill still has residual reads for natural-language triggers (open: TC-5 will show).
- The board add-on's script is read by a Glob under the plugin cache, by design; that read can still prompt.
- Commands now carry their reference text, so they are larger (10 to 26 KB each for the lane commands) and must be regenerated whenever the skill text changes.
- `claude plugin validate --strict` does not model the directory portal's allowed-tools rule, so a local pass says nothing about portal acceptance.

## Out of scope

- Asking users to change their permission settings.
- Shipping `allowed-tools` unless the owner chooses option 1 after TC-5.
- Detecting an installed plugin (it needs a read outside the project).

## Decision recorded 2026-11-18

The board add-on is offered once in setup, next and new-project instead of being detected, because an installed plugin cannot be detected without reading outside the project; this track made those commands read-free, so detection would bring the permission prompt back. The skill still has residual reads for natural-language triggers (open: TC-5 will show).
