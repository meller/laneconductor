# Tests: Track 1095 — /laneconductor plan doesn't reliably populate test.md

## Test Commands
```bash
# Run all vitest tests
npm test

# Run a specific test file
npx vitest conductor/tests/auto-launch.test.mjs
```

## Test Cases

### Phase 1: Update Instructions in SKILL.md
- [ ] TC-1: Verify that `SKILL.md` contains the new `/laneconductor plan` instructions to fully populate `test.md` using the templates.
- [ ] TC-2: Verify that `SKILL.md` contains the self-healing instruction in `/laneconductor implement` to generate `test.md` if it's missing or a stub.

### Phase 2: Update sync worker scaffolding in laneconductor.sync.mjs
- [ ] TC-3: Create a test track via the file sync queue and verify that a structured `test.md` is immediately created by the queue processor.
- [ ] TC-4: Delete `test.md` for an existing track, trigger sync/pull, and verify that the fallback stub created is structured (contains proper template sections) instead of a bare stub.

### Phase 3: Verification
- [ ] TC-5: Run a mock plan action on a track with a stub `test.md` and verify that the planning agent writes actual test cases mapped to the plan phases.
- [ ] TC-6: Run a mock implement action on a track with a stub `test.md` and verify that the implementation agent self-heals by drafting the test cases in `test.md` first.

## Acceptance Criteria
- [ ] All unit tests pass.
- [ ] The sync worker creates a structured `test.md` at track creation.
- [ ] The fallback sync `test.md` is a fully structured template.
