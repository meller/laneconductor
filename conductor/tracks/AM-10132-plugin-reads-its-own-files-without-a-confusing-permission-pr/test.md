# Tests: Track 10132 - Plugin reads its own files without a confusing permission prompt

Test command: `cd connector && node --test test/permission-note.test.mjs test/inlined-commands.test.mjs` (the whole suite: `cd connector && npm test`); `node scripts/build-plugin.mjs --check`; `claude plugin validate --strict` on the three plugins and the root.

- [x] TC-1 (regression, text level): the README, `setup/setup.md`, `ops/new-project.md` and the `setup` command carry the one-line note and the "never ask to change permission settings" rule (`permission-note.test.mjs`).
- [x] TC-2: the setup interview is one pre-filled message ending "Reply ok, or tell me what differs", with the private tracks option, and writes nothing before the reply, in the command, `setup/setup.md` and `ops/new-project.md`.
- [x] TC-3: no shipped skill or command declares `allowed-tools` (evaluated, not shipped; see the plan).
- [x] TC-4: `claude plugin validate --strict` passes on the base, with and without `allowed-tools` variants (scratch copies; the local validator does not model the portal's rule).
- [ ] TC-5 (real session): `/laneconductor:setup` in a project: does the client still ask "Allow this read outside the working directories?" and for which file.
- [ ] TC-6 (real session, only if option 1 is chosen): with `allowed-tools: Read, Grep, Glob` the prompt does not appear, and the directory portal's Validate accepts it.
- [x] TC-7: the generated `setup`, `next` and `new-project` bodies contain their key sections (setup: interview, existing-repository path, recommendation block; next: every state row S01 to S21, rank, card, levels, transition grammar; new-project: steps 1 to 6) and name no plugin-folder path, no plugin Glob and no link to read (`inlined-commands.test.mjs`).
- [x] TC-8: only these three commands are exempt from the 40-line limit, and each is built from the skill source (`plugin-coverage.test.mjs`, `inlined-commands.test.mjs`).
- [x] TC-9 (headless, real): `claude --plugin-dir <build> -p "/laneconductor:setup"` in a scratch copy of a real project ends at the one pre-filled confirmation message with no read-denied complaint; the installed 1.2.0 on the same project is denied (control).
- [x] TC-10 (headless, real): `/laneconductor:next` names one next step in a project with a conductor folder (plan AM-2) and without one (setup), `/laneconductor:new-project` asks its first question; no read outside the project.
