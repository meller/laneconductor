# Track 10132: Plugin reads its own files without a confusing permission prompt

Written during implementation (the track went from a stub straight to work at the owner's request). Evaluation first, then the parts that need no real session.

## Phase 1: Evaluate the four options

- [x] Task 1.1: Option 1, `allowed-tools: Read, Grep, Glob` in the frontmatter of the skill and the commands. Evaluated on a scratch copy of the base: `claude plugin validate --strict` passes for `Read, Grep, Glob`, for a path-scoped `Read(~/.claude/plugins/cache/**)` and even for `Bash` (so the local validator does not model the directory portal's allowed-tools rule; the repository's own record of the portal's report says only Read, Grep, Glob and LS are accepted). NOT shipped: an unscoped `Read` pre-approves reads of any path while the skill is active, not only the plugin's own folder, which is a wider grant than the problem needs; the scoped form is not known to pass the portal; and whether either removes the prompt can only be seen in a real session. Owner decision (below).
- [x] Task 1.2: Option 2, inline texts. A generator experiment inlined the lane guide (or setup + new-project) into each command: it works mechanically (commands become 8 to 23 KB) but breaks the standing rule, enforced by `plugin-coverage.test.mjs`, that a command body stays under 40 lines because the skill is the single source, and it duplicates every guide. Not shipped. What IS inlined, in the `setup` command body itself: the one-message interview and the permission note (Phase 2), the two things a first-run user meets before any file is read.
- [x] Task 1.3: Option 3, the connector serves guides (`get_context`): already true for people with the parallel add-on; the base stays Markdown only. Nothing to do.

## Phase 2: What shipped

- [x] Task 2.1: The one-line note (choose the option that allows it this one time; the "keep allowing" and "block from now on" options change a permanent setting; never ask anyone to change permission settings) in the base README, `setup/setup.md`, `ops/new-project.md` and the generated `setup` command.
- [x] Task 2.2: The setup interview reworded as ONE message, everything pre-filled (name, what it is for, stack, test, lint, typecheck, build commands with the reason for each one left out, where each fact came from, the tracks folder with a "private" option for a public repository), ending "Reply ok, or tell me what differs", nothing written until the reply: `ops/new-project.md` (existing repository path), `setup/setup.md` step 1, the `setup` command step 1.
- [x] Task 2.3: Tests: `connector/test/permission-note.test.mjs`.

## Phase 3: Needs a real session (not done)

- [ ] Task 3.1: In a real Claude Code session run `/laneconductor:setup` and record whether the "Allow this read outside the working directories?" prompt still appears, and for which file.
- [ ] Task 3.2: If the owner wants option 1, apply `allowed-tools: Read, Grep, Glob` to the generated skill and commands (one generator edit), run the portal's Validate, and repeat Task 3.1.
