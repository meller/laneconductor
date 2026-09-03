# Track TU-10055: Waiting-for-input is a first-class status on every lane, not a done-lane special case

**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Planned
**Type**: dev
**Track Kind**: feature
**Author**: TU
**Created By**: test@example.com
**Summary**: A lane action can pause and genuinely need a human before it can continue — this happens on plan, implement, review and quality-gate, not just done. Today that state is only legible in the done lane; elsewhere a pause is silently advanced or lands at `<lane>:success`. Makes `<lane>:waiting` a first-class status with a mandatory reason, a resume path, board visibility and Inbox surfacing.
**Waiting for reply**: no
