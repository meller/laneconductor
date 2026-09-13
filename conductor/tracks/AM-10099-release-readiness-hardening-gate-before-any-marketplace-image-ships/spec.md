# Spec: `lc <subcommand> --help` — stop swallowing `--help` as data

## Problem Statement

`bin/lc.mjs` handles `--help` in exactly one place (line 648) and only when it is
the **command** — i.e. `args[0]`. Every subcommand therefore treats a trailing
`--help` as ordinary input. For subcommands that accept free text, that input is
*written somewhere*: the flag becomes a track title, a comment body, or a plan
entry.

**This track is itself the artifact of that bug.** Track AM-10099 is titled
`--help`, has no description, no summary and no author-written body, and was
created 2026-09-13 20:24. Running `lc new --help` reproduces it exactly.

### Confirmed defects (all reproduced against the real CLI, not inferred)

Probe: a throwaway `local-fs` project, real `node bin/lc.mjs`.

| # | Invocation | Actual behavior | Expected |
|---|---|---|---|
| D1 | `lc new --help` | Creates track `AM-1000-help`, title `--help` | Print `new` help, exit 0, create nothing |
| D2 | `lc new "My Title" "My desc" --merge-mode pr` | Title becomes `My Title My desc --merge-mode pr`, **description lost**, folder `AM-1001-my-title-my-desc-merge-mode-pr` | Title `My Title`, desc `My desc`, merge mode `pr` |
| D3 | same as D2 | Prints `⚠️ Multiple unquoted words detected — did you forget to quote the title?` even though the title *was* quoted correctly | No warning |

**Root cause of D2/D3** — `lc new` collects positionals with only `--type` as a
boundary:

```js
const typeIdx = args.indexOf('--type');
const rawPositional = typeIdx !== -1 ? args.slice(1, typeIdx) : args.slice(1);
```

The code comment above it claims "Collect all args after 'new' up to the first
`--flag`", but `--type` is the only flag it actually stops at. So
`--workspace`, `--merge-mode` and `--auto-run` — all documented in the command's
own usage string and in the skill — fall into `rawPositional`. With >2 raw args
and no bracket notation, the "unquoted title" heuristic then joins the whole
phrase (flags included) into the title and discards the description.

Note the flags still *function*: they are read separately via
`args.indexOf('--merge-mode')` etc. Only the title, description and folder slug
are corrupted — which is what makes this quiet rather than loud.

### Blast radius across subcommands

Free-text subcommands write the flag as data. Track-number/enum subcommands fail
safe (validation error / "not found"), so they are out of scope as *defects*
while still in scope for the help behavior:

| Subcommand | `--help` effect today | Severity |
|---|---|---|
| `new` | Creates a junk track (**confirmed**) | High — pollutes board + DB |
| `reportaBug` / `report-bug` / `featureRequest` / `feature-request` | `desc = args.slice(1).join(' ')` → creates a junk bug/feature track | High |
| `comment NNN --help` | Appends `> **human**: --help` to `conversation.md`, syncs to DB | Medium |
| `updateTrack NNN --help` | Appends `--help` to `plan.md` **and moves the track back to backlog** | Medium |
| `brainstorm`, `track-dir`, `move`, `status`, … | "Track `--help` not found" / validation error, exits non-zero | Low (fails safe) |

### Why existing tests did not catch D2

`conductor/tests/track-10035-new-track-flags.test.mjs` already exercises
`lc new 'Direct Auto Track' 'desc' --merge-mode direct --auto-run yes` — i.e. the
exact broken shape. It passes anyway, because it locates the created folder with
`readdirSync(...).find(d => d.includes('direct-auto-track'))` and then asserts
only the `**Merge Mode**` / `**Auto Run**` marker regexes. The corrupted folder
name still *contains* the expected fragment, and the markers are genuinely
correct. This is a coverage gap in assertion strength, not missing coverage.

## Requirements

- **REQ-1**: `lc <subcommand> --help` and `lc <subcommand> -h` print help for
  that subcommand and exit 0, for every subcommand in `bin/lc.mjs`, with **no
  side effects** — no track created, no file written, no DB row, no lane move.
- **REQ-2**: `lc new` must not absorb any `--`-prefixed flag into the title or
  description. `--type`, `--workspace`, `--merge-mode` and `--auto-run` all
  behave as boundaries, not as text.
- **REQ-3**: The "Multiple unquoted words detected" warning must fire only for
  genuinely unquoted multi-word input, never merely because a documented flag was
  used.
- **REQ-4**: Existing `lc new` input shapes keep working unchanged — quoted
  `"title" "description"`, bracket notation `[title] [desc]`, the unquoted-phrase
  fallback (with its warning), and `--type` placement anywhere.
- **REQ-5**: `lc help <subcommand>` is accepted as an alias for
  `lc <subcommand> --help`.
- **REQ-6**: An unrecognized subcommand combined with `--help` falls back to the
  existing top-level help rather than erroring.
- **REQ-7**: `--` terminates option parsing, so free-text subcommands can still
  submit a literal flag-looking string (`lc comment 123 -- --help`).
- **REQ-8**: `track-10035-new-track-flags.test.mjs` is strengthened to assert the
  exact title and exact folder slug, so D2 cannot silently return.

## Acceptance Criteria

Each criterion is a user-observable outcome. None is satisfiable by a stub.

- [ ] AC-1: `lc new --help` prints `new` usage, exits 0, and
      `conductor/tracks/` gains no folder and `file_sync_queue.md` no entry.
- [ ] AC-2: `lc new -h` behaves identically to AC-1.
- [ ] AC-3: `lc new "My Title" "My desc" --merge-mode pr` creates a track whose
      title is exactly `My Title`, description exactly `My desc`, folder slug
      `<INITIALS>-<NNN>-my-title`, and `**Merge Mode**: pr`.
- [ ] AC-4: The same command prints no "unquoted words" warning.
- [ ] AC-5: `--workspace main` and `--auto-run no` behave like AC-3 — markers
      applied, title/description intact.
- [ ] AC-6: `lc reportaBug --help` prints help and creates no track.
- [ ] AC-7: `lc comment <NNN> --help` prints help and appends nothing to that
      track's `conversation.md`.
- [ ] AC-8: `lc updateTrack <NNN> --help` prints help, appends nothing to
      `plan.md`, and leaves the track's lane unchanged.
- [ ] AC-9: Every subcommand in `bin/lc.mjs` returns exit 0 and non-empty help
      for `--help`, verified by a table-driven test over the dispatch list, not
      spot checks.
- [ ] AC-10: `lc help new` prints the same text as `lc new --help`.
- [ ] AC-11: `lc comment <NNN> -- --help` appends the literal text `--help`
      (escape hatch works).
- [ ] AC-12: `lc new "T" "D"`, `lc new [T] [D]`, the unquoted-phrase fallback and
      `--type` placement all still behave as they do today (regression).
- [ ] AC-13: The full existing CLI test suite passes unchanged.

## Non-Goals / Decisions

- **Not renaming this track.** The title `--help` and folder `AM-10099-help` are
  kept as the reproduction artifact; renaming mid-flight would churn folder
  resolution for no benefit.
- **Not restructuring the top-level help.** The existing template literal stays;
  per-subcommand help is added alongside it.
- **Not adding a CLI framework** (commander/yargs). Out of proportion to the fix
  and would touch all ~36 dispatch branches.
- **Accepted trade-off (REQ-7 covers it):** a bare `--help` token after a
  free-text subcommand is always read as a help request, so posting the literal
  string `--help` requires the `--` separator. A quoted string that merely
  *contains* `--help` (e.g. `"how do I use --help?"`) is one argv token and is
  unaffected.

## Data Model Changes

None. No schema, no migration — `bin/lc.mjs` and its tests only.
