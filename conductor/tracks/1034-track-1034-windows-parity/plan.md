# Track 1034: Windows Parity

## Phase 1: Planning (Completed)
- [x] Research existing Windows parity gaps in `winmake.ps1` and `lc` CLI.
- [x] Define requirements and acceptance criteria in `spec.md`.

## Phase 2: Background Process Management (`winmake.ps1`)
- [ ] Update `winmake.ps1` to support individual `api-start`, `api-stop`, `ui-start`, `ui-stop` commands.
- [ ] Implement PID file writing/reading in `winmake.ps1`.
- [ ] Use `Start-Process -WindowStyle Hidden` for background Node processes.
- [ ] Replace "kill-all" logic with surgical PID-based stopping.

## Phase 3: CLI & Script Portability
- [ ] Update `bin/lc.mjs` to use `npx.cmd` and `npm.cmd` where appropriate on Windows.
- [ ] Refine `lc status` path normalization for Windows Postgres queries.
- [ ] Add support for `.ps1` fallbacks in `lc verify` and `lc quality-gate`.
- [ ] Fix `lc start` detached behavior on Windows to ensure it doesn't hang the parent shell.

## Phase 4: Native API Sync & Branch Detection
- [ ] Replace `curl` in `lock.mjs` and `unlock.mjs` with Node's `http` or `fetch`.
- [ ] Implement default branch detection (e.g., `git remote show origin`) instead of hardcoded `main`.
- [ ] Ensure `git worktree` paths are handled correctly in PowerShell/CMD environments.

## Phase 5: Cross-Platform Symlinks
- [ ] Update the `setup scaffold` logic in the Claude skill (and any supporting scripts) to use `junction` type for `fs.symlinkSync` on Windows.
- [ ] Verify `lc install` and `lc setup` path handling for Windows.
