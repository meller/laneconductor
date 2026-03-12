# Track 1061: CLI gaps with worker

## Phase 1: Planning & Research
- [x] Define requirements and acceptance criteria (Spec)
- [x] Research `lc.mjs` and `laneconductor.sync.mjs` for shared logic or refactoring needs
- [x] Plan the CLI flag parsing for `--run` and `-r`

## Phase 2: Implementation Decision
- [x] Assessed full `agent-runtime.mjs` extraction — deferred (spawnCli too entangled with sync.mjs state: runningPids, providerStatusCache, updateWorkerHeartbeat, etc.)
- [x] Chose pragmatic approach: implement `--run` directly in `lc.mjs` with self-contained config read + spawnSync foreground spawn
- [x] This satisfies all acceptance criteria without a risky refactor of sync.mjs

## Phase 3: Implement `--run` Flag in `lc.mjs`
- [x] Strip `--run` / `-r` from args before positional arg parsing
- [x] After writing index.md, detect `runFlag` and branch to foreground execution
- [x] Mark `**Lane Status**: running` before spawn
- [x] Read primary CLI/model from `.laneconductor.json`
- [x] Build correct command for claude / gemini / other CLIs
- [x] Spawn with `stdio: 'inherit'` (foreground, terminal output visible)
- [x] On exit: update `**Lane Status**: success` or `failure` based on exit code
- [x] Map `quality-gate` → `qualityGate` for skill invocation
- [x] Updated help text to document `--run` flag on all transition commands

## Phase 4: Verification
- [ ] Test `lc plan NNN --run`
- [ ] Test `lc implement NNN --run`
- [ ] Test `lc review NNN --run`
- [ ] Test `lc quality-gate NNN --run`
- [ ] Verify `--run` without flag still behaves identically (no regression)

## ✅ COMPLETE
