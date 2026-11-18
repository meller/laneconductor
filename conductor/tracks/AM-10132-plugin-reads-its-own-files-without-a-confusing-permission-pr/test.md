# Tests: Track 10132 - Plugin reads its own files without a confusing permission prompt

Test command: `cd connector && node --test test/permission-note.test.mjs` (the whole suite: `cd connector && npm test`); `node scripts/build-plugin.mjs --check`; `claude plugin validate --strict` on the three plugins and the root.

- [x] TC-1 (regression, text level): the README, `setup/setup.md`, `ops/new-project.md` and the `setup` command carry the one-line note and the "never ask to change permission settings" rule (`permission-note.test.mjs`).
- [x] TC-2: the setup interview is one pre-filled message ending "Reply ok, or tell me what differs", with the private tracks option, and writes nothing before the reply, in the command, `setup/setup.md` and `ops/new-project.md`.
- [x] TC-3: no shipped skill or command declares `allowed-tools` (evaluated, not shipped; see the plan).
- [x] TC-4: `claude plugin validate --strict` passes on the base, with and without `allowed-tools` variants (scratch copies; the local validator does not model the portal's rule).
- [ ] TC-5 (real session): `/laneconductor:setup` in a project: does the client still ask "Allow this read outside the working directories?" and for which file.
- [ ] TC-6 (real session, only if option 1 is chosen): with `allowed-tools: Read, Grep, Glob` the prompt does not appear, and the directory portal's Validate accepts it.
