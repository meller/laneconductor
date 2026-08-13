# Tests: Track 1109 — Worker Claim Allowlist

## Test Commands

```bash
# This track's suite
node --test conductor/tests/track-1109-claim-allowlist.test.mjs

# Full worker suite — baseline is 116 pass / 5 fail (pre-existing, see track 1100)
node --test conductor/tests/*.test.mjs
```

## Test Cases

### Phase 1: CLI flag
- [x] TC-1: `lc worker start --sync-and-work --only-tracks 42` forwards
      `--only-tracks 42` to the spawned worker — expected: the flag appears
      in the spawn argv.
- [x] TC-2: `--only-tracks` together with `--sync-only` exits non-zero with
      an explanatory message — expected: rejected, not silently ignored.

### Phase 2: Enforcement (the core of the track)
- [x] TC-3: allowlist parses a csv into a set — `"42, 43"` → `{42, 43}`,
      tolerating whitespace.
- [x] TC-4: **a listed queued track is claimable** — expected: not skipped
      by the gate.
- [x] TC-5: **an UNLISTED queued track is left alone** — expected: skipped.
      This is the assertion the whole track exists for; a test that only
      proves TC-4 proves nothing.
- [x] TC-6: works when `claimableSet` is null (local-fs mode) — expected:
      the allowlist alone still restricts.
- [x] TC-7: **narrows only, never widens** — a track absent from
      `claimableSet` but present in `--only-tracks` stays skipped.
- [x] TC-8: `waitingForReply` does NOT bypass the allowlist — expected: an
      unlisted track mid-conversation is still skipped, even though
      `claimableSet` is deliberately bypassed for such tracks.
- [x] TC-9: no `--only-tracks` → behaviour byte-identical to today
      (regression guard for every existing worker).

### Phase 3: `--once`
- [x] TC-10: exits once no scoped track remains claimable and nothing is
      running.
- [x] TC-11: does **not** exit while a scoped track is still running.
- [x] TC-12: without `--once`, a scoped worker keeps polling (lifecycle and
      scoping stay orthogonal).

### Phase 4: `lc worker run`
- [x] TC-13: `lc worker run 42` expands to
      `--sync-and-work --only-tracks 42 --once` — expected: exact argv.

### Phase 5: Observability
- [x] TC-14: startup log names the effective claim scope. (Collector-side
      reporting descoped 2026-08-13 — see spec.md REQ-4; no longer part of
      this criterion.)

### Phase 6: Session continuity
- [ ] TC-15: **NOT RUN** — two successive scoped runs of the same track → the second gets
      `FRESH_SESSION: false`. Requires a stable `hostname` + `worker_number`
      across runs; if identity churns, this fails and that is the point.

## Acceptance Criteria

- [x] TC-5 and TC-7 pass — the negative assertions, not just the positive
- [x] TC-9 passes — no behaviour change for unscoped workers
- [ ] Full worker suite shows no NEW failures vs. the 116/5 baseline
- [ ] `npx playwright test --project=fast` still green (10 passed)
