# Track 10132: Plugin reads its own files without a confusing permission prompt

Written during implementation (the track went from a stub straight to work at the owner's request). Evaluation first, then the parts that need no real session.

## Phase 1: Evaluate the four options

- [x] Task 1.1: Option 1, `allowed-tools: Read, Grep, Glob` in the frontmatter of the skill and the commands. Evaluated on a scratch copy of the base: `claude plugin validate --strict` passes for `Read, Grep, Glob`, for a path-scoped `Read(~/.claude/plugins/cache/**)` and even for `Bash` (so the local validator does not model the directory portal's allowed-tools rule; the repository's own record of the portal's report says only Read, Grep, Glob and LS are accepted). NOT shipped: an unscoped `Read` pre-approves reads of any path while the skill is active, not only the plugin's own folder, which is a wider grant than the problem needs; the scoped form is not known to pass the portal; and whether either removes the prompt can only be seen in a real session. Owner decision (below).
- [x] Task 1.2: Option 2, inline texts. First tried by a generator experiment and reverted, only because `plugin-coverage.test.mjs` kept every command body under 40 lines. Superseded by Phase 4 after the headless finding of 2026-11-18: a command that points at a skill file prompts interactively and is denied headless, so commands now carry their text (the line limit is relaxed for exactly those commands, each with a stated reason).
- [x] Task 1.3: Option 3, the connector serves guides (`get_context`): already true for people with the parallel add-on; the base stays Markdown only. Nothing to do.

## Phase 2: What shipped

- [x] Task 2.1: The one-line note (choose the option that allows it this one time; the "keep allowing" and "block from now on" options change a permanent setting; never ask anyone to change permission settings) in the base README, `setup/setup.md`, `ops/new-project.md` and the generated `setup` command.
- [x] Task 2.2: The setup interview reworded as ONE message, everything pre-filled (name, what it is for, stack, test, lint, typecheck, build commands with the reason for each one left out, where each fact came from, the tracks folder with a "private" option for a public repository), ending "Reply ok, or tell me what differs", nothing written until the reply: `ops/new-project.md` (existing repository path), `setup/setup.md` step 1, the `setup` command step 1.
- [x] Task 2.3: Tests: `connector/test/permission-note.test.mjs`.

## Phase 3: Needs a real session (not done)

- [ ] Task 3.1: In a real Claude Code session run `/laneconductor:setup` and record whether the "Allow this read outside the working directories?" prompt still appears, and for which file.
- [ ] Task 3.2: If the owner wants option 1, apply `allowed-tools: Read, Grep, Glob` to the generated skill and commands (one generator edit), run the portal's Validate, and repeat Task 3.1.

## Phase 4: Commands carry their procedure (2026-11-18, headless finding)

Finding: `claude -p "/laneconductor:setup"` with the installed 1.2.0 stopped: the model could not find the plugin's install path and the read of `ops/new-project.md` was denied. Reproduced again on a scratch copy of the project.

- [x] Task 4.1: `scripts/plugin-inline.mjs` builds the bodies of `setup` (setup/setup.md + the existing-repository path of ops/new-project.md + the generated recommendation block), `next` (ops/next.md + the statuses, the two meanings of done and the transition grammar of ops/lanes-and-statuses.md) and `new-project` (ops/new-project.md) from the shipped skill text, at build time. Links between skill files become skill-relative paths; the scaffold script (an add-on file, found by a Glob under the plugin cache) is not searched for: the scaffold is done by hand; the board add-on's "installed when a Glob under the plugin cache finds it" is replaced by "offer once".
- [x] Task 4.2: `plugin-coverage.test.mjs` exempts only the commands that carry text from the 40-line limit (reason per command in `scripts/plugin-references.mjs`); `connector/test/inlined-commands.test.mjs` checks the key sections, that every state row of next.md is copied, that every skill file a command names is carried, and that no plugin-folder path, plugin Glob or link to a skill file is left to read.
- [x] Task 4.3: Verified headless with the build (`claude --plugin-dir ... -p`): setup, next (with and without a conductor folder) and new-project.
- [x] Task 4.4 (owner decision, done): `scripts/plugin-references.mjs` appends, under "Reference", the text each other command names, cut from the shipped skill (whole file or only the sections it uses): the lane guide and the status, transition, move, pulse, comment and finding sections for plan, brainstorm, implement, review, quality-gate, merge and run (run carries the five guides); the search-first, newTrack and bug/feature form sections for new, bug, feature, repair-duplicates; the board, settings and deploy files for the board and deploy commands. setup and new-project also carry `setup/scaffold.md` and the file templates, so nothing is read after the reply "ok". The one read left outside the project is the board script of the separate board add-on (a Glob), by design.
- [x] Task 4.5: `next`: a missing `plan.md` or `test.md` counts as a stub (S17) and a plan with real content (phases, checkboxes, prose, ticks) is not (S16): wording in `ops/next.md` step 8 and the S17 row; fixtures F16c, F16d, F17b. The 2026-11-18 scratch result ("only index.md") was a thin fixture, not a misfire; the rule is now explicit about it.
- [x] Task 4.6: Verified headless with the build: setup including the step after "ok" (no read outside the project; stopped at the first write), next (S16 with a realistic plan), plan, implement, review.
