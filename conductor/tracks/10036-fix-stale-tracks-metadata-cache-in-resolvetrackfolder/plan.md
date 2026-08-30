# Track AM-10036: Fix stale tracks-metadata cache in resolveTrackFolder

## Phase 1: Make the reload safe, then make it event-driven

**Problem**: `tracksMetadata` is refreshed only at
`laneconductor.sync.mjs:7437`, inside the API-mode branch of the auto-launch
interval — behind four gates (`syncOnly`, at-capacity, `local-fs`,
`pullWorkflow()` failure), any of which strands the cache indefinitely. A
long-lived worker then can't see tracks created after it started, silently
corrupting folder scaffolding, merge-mode routing, and anything else with a
null-folder fallback.

**Solution**: Mirror `workflow.json`'s watch/reload pattern for
`conductor/tracks-metadata.json` — but harden the loader *first*, because a
watch turns the loader's existing empty-object-on-parse-failure behavior from
a latent quirk into an active hazard (see spec.md's secondary-hazard section).

Ordering is deliberate: Task 1 and Task 2 must land **before** Task 3. Adding
the watch first would ship a window where a mid-write parse failure wipes the
cache entirely.

- [ ] Task 1: Add `loadTracksMetadataStrict()` next to `loadTracksMetadata()`
      (`~:1297`) that returns the parsed object on success and `null` on a
      read/parse failure, instead of silently substituting the empty
      `{ format, last_checked, tracks: {} }` default. Reimplement the
      existing `loadTracksMetadata()` as a thin wrapper over it
      (`?? defaultMetadata()`) so every current caller — `:752`, `:2322`,
      `:2479`, `:2666`, `:2795`, `:7437` — keeps its present behavior
      unchanged. (REQ-4)
- [ ] Task 2: Make `saveTracksMetadata()` (`~:1315`) atomic — write to a
      temp file in the same directory, then `renameSync` over
      `conductor/tracks-metadata.json` — so a watcher can never observe a
      half-written file. Same-directory temp matters: `rename` is only
      atomic within a filesystem. (REQ-5)
- [ ] Task 3: Add the watch alongside the existing `workflow.json` watch
      (`:2587-2588`), inside the same config-watch block, using the strict
      loader and declining to install a failed parse:
      ```js
      watch('conductor/tracks-metadata.json', { ignoreInitial: true })
        .on('change', () => {
          const next = loadTracksMetadataStrict();
          if (!next) { console.warn('[config] tracks-metadata.json reload skipped — parse failed, keeping last good cache'); return; }
          tracksMetadata = next;
          console.log('[config] tracks-metadata.json reloaded');
        });
      ```
      (REQ-1, REQ-3, REQ-6)

**Verification** — note these cannot be unit tests. `loadTracksMetadata`,
`getTrackMetadata`, and `resolveTrackFolder` are module-private and importing
`laneconductor.sync.mjs` boots the whole worker (spec.md, "Implementation
Notes"). Every task below spawns a real worker against a throwaway repo, in
the style of `conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs`.

- [ ] Task 4: Create `conductor/tests/track-10036-tracks-metadata-cache.test.mjs`.
      Fixture: a throwaway repo with `conductor/tracks-metadata.json`
      containing **no** entry for track `N`, and a real `AM-N-slug/` folder on
      disk that only the metadata fallback can resolve (a bare `N-` prefix
      scan must not find it). Spawn a real worker, let it populate its cache,
      then write the `N` entry from the test process (simulating `lc new`
      elsewhere), wait for the watcher, and assert the worker now resolves the
      track — observed through worker behavior/log output, not by calling the
      private function. (AC-1, AC-2)
- [ ] Task 5: Repeat Task 4's scenario with the worker started
      `--sync-only`. This is the load-bearing test: a sync-only worker
      returns at `:7419` and can never reach the `:7437` reload, so a pass
      here proves the watch — not the pre-existing interval — is doing the
      work. Expect this one to fail before Task 3 and pass after. (AC-3)
- [ ] Task 6: Write malformed JSON (a truncated file) to
      `tracks-metadata.json` after the cache is known-good, and assert the
      worker keeps resolving the track and does not crash — then write valid
      JSON again and assert it picks up the newer entry. Guards REQ-4's
      no-clobber rule and the "chokidar fires on a partial write" case.
      (AC-4)
- [ ] Task 7: Run the regression guards —
      `track-1119-resolve-track-folder-quarantine.test.mjs` and
      `track-1112-worktree-audit.test.mjs` — plus the wider
      `conductor/tests/` suite, and confirm no new failures against a
      pre-change baseline. Record the baseline first: this suite spawns real
      processes and is not reliably all-green, so "these specific tests
      failed before my change too" is the only meaningful claim. (AC-5)

**Impact**: A worker's track-metadata view stays correct for its entire run
regardless of its mode, its load, or how long it has been alive — closing the
root cause behind three real incidents on track 10035 instead of relying on
an interval reload that four separate conditions can switch off.
