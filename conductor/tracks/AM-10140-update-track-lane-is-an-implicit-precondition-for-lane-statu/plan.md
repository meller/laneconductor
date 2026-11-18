# Track 10140: update_track: Lane is an implicit precondition for Lane Status, leaving done needs reopen

In `connector/src/tools/update-track.mjs` and `connector/src/errors.mjs`; tests in `connector/test/update-track-guards.test.mjs`.

- [x] 1. When `Lane Status` is set and `Lane` is not, `Lane` is compared against `base.markers` too: a stale `success` after a human move is a CONFLICT on Lane and writes nothing.
- [x] 2. Leaving done: when the index before has lane done and the one written has another lane (markers, `files.index` or `repair_index`), refuse with VALIDATION_FAILED unless `reopen: true`. It runs after the conflict check, so a stale base is still a CONFLICT first. The hint tells the agent to ask the human.
- [x] 3. CONFLICT carries `error.base`: the current head and markers with empty `files` (nothing was read), so a retry with the same old base is not the only path; file replacements still need `get_track`. A new optional `base` on `ConnectorError`.
- [x] 4. `reopen` is a bare boolean in the input schema (no description: KC-8 has no room); the plan guide says to pass it only after the human's yes. The lane-guide advice "a human's manual move wins" is unchanged and now enforced by item 1.
- [x] 5. Daemon-era lane rank and unknown-lane-fails-closed guard: not ported (validateIndex already refuses unknown lanes; ranks do not exist in the workflow file).
