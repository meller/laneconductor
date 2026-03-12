# Track 1061: Track 1061: CLI gaps with worker

## Phase 1: Planning & Research
- [x] Define requirements and acceptance criteria (Spec) ⏳
- [ ] Research `lc.mjs` and `laneconductor.sync.mjs` for shared logic or refactoring needs ⏳
- [ ] Plan the CLI flag parsing for `--run` and `-r` ⏳

## Phase 2: Refactoring Core Logic
- [ ] Extract `buildCliArgs`, `isProviderAvailable`, and `checkClaudeCapacity` into a shared module (or just reuse them in `lc.mjs`) ⏳
- [ ] Extract `spawnCli` or create a foreground version for the CLI ⏳

## Phase 3: Implement `--run` Flag
- [ ] Update `lc.mjs` argument parsing to detect `--run` or `-r` ⏳
- [ ] Implement the execution logic in `lc.mjs` for `plan`, `implement`, `review`, `quality-gate`, `rerun`, and `move` ⏳
- [ ] Ensure state is updated correctly in both files and DB ⏳

## Phase 4: Verification
- [ ] Test `lc plan NNN --run` ⏳
- [ ] Test `lc implement NNN --run` ⏳
- [ ] Test `lc review NNN --run` ⏳
- [ ] Test `lc quality-gate NNN --run` ⏳
- [ ] Verify background/foreground behavior ⏳
