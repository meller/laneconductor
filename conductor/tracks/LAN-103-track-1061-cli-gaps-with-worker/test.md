# Test: Track 1061: CLI gaps with worker

## Automated Checks
- [ ] `lc status` reflects the correct lane and status after a `--run` command.

## Test Commands
- [ ] `lc plan 1061 --run` (should trigger planning logic)
- [ ] `lc review 1061 --run` (should trigger review logic)
- [ ] `lc quality-gate 1061 --run` (should trigger quality gate logic)
- [ ] `lc status` (check if 1061 transitions through running states)

## Acceptance Criteria Checklist
- [ ] Flag `--run` is detected for `plan`.
- [ ] Flag `-r` is detected for `implement`.
- [ ] Agent is spawned and output is visible.
- [ ] Track transitions to `success` on agent exit 0.
