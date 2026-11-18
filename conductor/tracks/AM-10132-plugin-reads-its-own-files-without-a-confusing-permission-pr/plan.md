# Track 10132: Plugin reads its own files without a confusing permission prompt

Written during implementation (the track went from a stub straight to work at the owner's request). Evaluation first, then the parts that need no real session.

## Phase 1: Evaluate the four options

- [x] Task 1.1: Option 1, `allowed-tools: Read, Grep, Glob` in the frontmatter of the skill and the commands. Evaluated on a scratch copy of the base: `claude plugin validate --strict` passes for `Read, Grep, Glob`, for a path-scoped `Read(~/.claude/plugins/cache/**)` and even for `Bash` (so the local validator does not model the directory portal's allowed-tools rule; the repository's own record of the portal's report says only Read, Grep, Glob and LS are accepted). NOT shipped: an unscoped `Read` pre-approves reads of any path while the skill is active, not only the plugin's own folder, which is a wider grant than the problem needs; the scoped form is not known to pass the portal; and whether either removes the prompt can only be seen in a real session. Owner decision (below).
- [x] Task 1.2: Option 2, inline texts. First tried by a generator experiment and reverted, only because `plugin-coverage.test.mjs` kept every command body under 40 lines. Superseded by Phase 4 after the headless finding of 2026-11-18: a command that points at a skill file prompts interactively and is denied headless, so the front-door commands now carry their text (the line limit is relaxed for exactly those three).
- [x] Task 1.3: Option 3, the connector serves guides (`get_context`): already true for people with the parallel add-on; the base stays Markdown only. Nothing to do.

## Phase 2: What shipped

- [x] Task 2.1: The one-line note (choose the option that allows it this one time; the "keep allowing" and "block from now on" options change a permanent setting; never ask anyone to change permission settings) in the base README, `setup/setup.md`, `ops/new-project.md` and the generated `setup` command.
- [x] Task 2.2: The setup interview reworded as ONE message, everything pre-filled (name, what it is for, stack, test, lint, typecheck, build commands with the reason for each one left out, where each fact came from, the tracks folder with a "private" option for a public repository), ending "Reply ok, or tell me what differs", nothing written until the reply: `ops/new-project.md` (existing repository path), `setup/setup.md` step 1, the `setup` command step 1.
- [x] Task 2.3: Tests: `connector/test/permission-note.test.mjs`.

## Phase 3: Needs a real session (not done)

- [ ] Task 3.1: In a real Claude Code session run `/laneconductor:setup` and record whether the "Allow this read outside the working directories?" prompt still appears, and for which file.
- [ ] Task 3.2: If the owner wants option 1, apply `allowed-tools: Read, Grep, Glob` to the generated skill and commands (one generator edit), run the portal's Validate, and repeat Task 3.1.

## Phase 4: Front-door commands carry their procedure (2026-11-18, headless finding)

Finding: `claude -p "/laneconductor:setup"` with the installed 1.2.0 stopped: the model could not find the plugin's install path and the read of `ops/new-project.md` was denied. Reproduced again on a scratch copy of the project.

- [x] Task 4.1: `scripts/plugin-inline.mjs` builds the bodies of `setup` (setup/setup.md + the existing-repository path of ops/new-project.md + the generated recommendation block), `next` (ops/next.md + the statuses, the two meanings of done and the transition grammar of ops/lanes-and-statuses.md) and `new-project` (ops/new-project.md) from the shipped skill text, at build time. Links between skill files become skill-relative paths; the scaffold script (an add-on file, found by a Glob under the plugin cache) is not searched for: the scaffold is done by hand; the board add-on's "installed when a Glob under the plugin cache finds it" is replaced by "offer once".
- [x] Task 4.2: `plugin-coverage.test.mjs` exempts exactly these three commands from the 40-line limit (reason in the test); `connector/test/inlined-commands.test.mjs` checks the key sections, that every state row of next.md is copied, and that no plugin-folder path, plugin Glob or link to a skill file is left to read.
- [x] Task 4.3: Verified headless with the build (`claude --plugin-dir ... -p`): setup, next (with and without a conductor folder) and new-project.
- [ ] Task 4.4 (owner decision): after the reply "ok" the write step still points at `setup/scaffold.md` and `setup/templates.md` (16 KB more), a read of a plugin file; the lane commands (plan, implement, review, quality-gate, merge, brainstorm, run) point at lane guides and `ops/tracks.md` and fail headless (observed for `plan`). The same generator can inline them (about 10 to 26 KB each).
