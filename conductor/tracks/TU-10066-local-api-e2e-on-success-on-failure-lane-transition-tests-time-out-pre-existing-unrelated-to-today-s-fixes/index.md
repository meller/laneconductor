**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Summary**: Root cause found during planning — both subtests are fixture defects, not worker bugs. `on_success` competes with three tracks the previous subtest left in the shared sandbox; `on_failure` asserts a status its own fixture makes reachable only via a three-lane cascade. Both are amplified by a hardcoded 5s auto-launch loop with no test override. 4-phase plan written.
**Merge Mode**: direct
