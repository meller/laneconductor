# Spec: Test-Driven Track Files (Track 1043)

## Problem Statement

LaneConductor currently structures each track with three files: `index.md` (status), `spec.md` (requirements), and `plan.md` (implementation phases). There is no dedicated place for test definitions, meaning:

- The `plan` phase produces no test artifacts — the AI has nothing to check against during `implement`
- The `review` and `quality-gate` phases have no structured test list to run or verify
- Tests are either embedded ad-hoc in `plan.md` or entirely absent
- Context-driven development (spec → plan → implement) misses the TDD loop (spec → tests → implement → verify)

## Requirements

- REQ-1: Every track folder gains a fourth file `test.md` alongside `index.md`, `spec.md`, `plan.md`
- REQ-2: `test.md` is scaffolded during the `plan` phase (after spec is written, before implement)
- REQ-3: `test.md` defines: what to test, how to run tests, expected outcomes per requirement
- REQ-4: The `implement` phase reads `test.md` and writes/runs tests as part of each phase
- REQ-5: The `review` phase checks `test.md` — all tests must pass before PASS verdict
- REQ-6: The `quality-gate` phase runs the commands in `test.md` as its primary automated check
- REQ-7: The sync worker watches `test.md` for changes (same as plan.md/spec.md)
- REQ-8: The UI shows a "Tests" tab in `TrackDetailPanel` rendering `test.md` content
- REQ-9: SKILL.md is updated with the new file in all command descriptions and templates
- REQ-10: `newTrack` does NOT create `test.md` upfront — only `plan` scaffolds it (test definition requires spec context)

## Acceptance Criteria

- [ ] `conductor/tracks/NNN-*/test.md` is created by `/laneconductor plan NNN`
- [ ] `test.md` follows the template (see below)
- [ ] `/laneconductor implement NNN` reads `test.md` and verifies tests pass per phase
- [ ] `/laneconductor review NNN` includes test results in its verdict
- [ ] `/laneconductor quality-gate NNN` runs test commands from `test.md`
- [ ] Sync worker (`laneconductor.sync.mjs`) watches `test.md` and syncs changes
- [ ] `TrackDetailPanel.jsx` has a "Tests" tab that renders `test.md`
- [ ] SKILL.md updated: templates, plan/implement/review/quality-gate sections

## `test.md` Template

```markdown
# Tests: [Track Title]

## Test Strategy
[Unit / Integration / E2E — what level and why]

## Requirements Coverage
| Req | Test | Command | Expected |
|-----|------|---------|----------|
| REQ-1 | Description of what is tested | `npm test -- --grep "..."` | passes / specific output |

## Test Cases

### TC-1: [Name]
**Requirement**: REQ-N
**Type**: unit | integration | e2e
**File**: `path/to/test.spec.js`
**Command**: `npm test path/to/test.spec.js`
**Expected**: [what passing looks like]

### TC-2: [Name]
...

## Run All Tests
\`\`\`bash
npm test
\`\`\`

## Pre-conditions
- [Any setup needed before running tests]
```

## Data Model Changes

None — `test.md` is a filesystem file only. The DB tracks `test_content` as a new optional column in the `tracks` table for caching (similar to `plan_content`, `spec_content`, `index_content`).

### DB migration needed:
```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS test_content TEXT;
```

## API Changes

- `GET /api/projects/:id/tracks/:num` — include `test_content` in response
- Sync worker PATCH endpoint — accept `test_content` field
