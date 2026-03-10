# Track 1005: Multi-User Data Model & Auth Architecture

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
LaneConductor has no ownership or identity model. Three gaps:
1. **No user→project ownership** — any user can see/modify any project in the DB
2. **No worker authentication** — collector accepts writes from any process with a token, but tokens are never generated or persisted
3. **No cross-device / cross-user project routing** — two users on the same git repo write to the same rows with no coordination

## Solution
Build on the Firebase Auth layer (Track 1002) to add three-entity ownership:
- **`project_members`** — many-to-many table linking users to projects
- **`machine_token`** — stable UUID per machine stored in `.laneconductor.json`, used as worker credential
- **`git_global_id` routing** — use the stable UUID (from git remote URL) to identify a project across devices, not the local integer `id`

Local mode is completely unchanged — no tokens, no membership, all routes open.

## Phases
- [x] Phase 1: Firebase Auth backend (Track 1002)
- [x] Phase 2: React Auth UI layer (Track 1002)
- [x] Phase 3: Machine token + collector auth
- [x] Phase 4: project_members + git_global_id routing
- [x] Phase 5: Multi-device / multi-user E2E verification
