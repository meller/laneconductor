# Spec: Track 1034: Windows Parity

## Problem Statement
LaneConductor was primarily developed and tested on Linux/macOS. While some Windows support exists (e.g., `winmake.ps1`), there are several gaps in parity, including background process management, CLI installation, symlink handling in setup, and hardcoded shell commands that assume a POSIX environment or the `main` branch.

## Requirements
- **REQ-1: Background Process Management**: `winmake.ps1` must support `api-start`, `api-stop`, `ui-start`, `ui-stop` using PID files (`.api.pid`, `.ui.pid`, `.sync.pid`) to allow background execution without visible terminal windows.
- **REQ-2: Cross-Platform CLI**: `bin/lc.mjs` must detect Windows and use `.cmd` extensions for global tools (e.g., `npx.cmd`) and avoid hardcoded `bash` calls for verification scripts.
- **REQ-3: Native API Sync**: `lock.mjs` and `unlock.mjs` must use Node's native `http`/`fetch` modules instead of `curl` for API synchronization.
- **REQ-4: Branch Detection**: Avoid hardcoding `main` as the primary branch; detect it from the remote or local git config.
- **REQ-5: Windows Symlinks**: `setup scaffold` must use directory junctions (`fs.symlinkSync(..., 'junction')`) on Windows to avoid the need for elevated "Developer Mode" privileges required for standard symlinks.
- **REQ-6: Robust Status**: `lc status` should handle Windows path normalization correctly when querying Postgres.

## Acceptance Criteria
- [ ] `winmake.ps1` can start/stop API and UI independently using PID files.
- [ ] `lc start` and `lc ui start` on Windows run in the background (no persistent window).
- [ ] `lock` and `unlock` commands work without `curl` and detect the default branch.
- [ ] `lc setup scaffold` successfully creates a `.claude/skills/laneconductor` junction on Windows.
- [ ] `lc status` works on Windows with a local Postgres installation.
