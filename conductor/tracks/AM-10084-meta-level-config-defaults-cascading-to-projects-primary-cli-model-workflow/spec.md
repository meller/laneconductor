# Spec: Meta-Level Config Defaults Cascading to Projects

## Problem Statement

Every project-level setting today — `project.primary.cli`/`.model`, and every
`conductor/workflow.json` lane's `parallel_limit`/`max_retries`/`primary_model`/
`on_success`/`on_failure` — is either hardcoded in engine defaults or must be
independently configured and independently *verified* (`provider_status`) per
project. There is no shared "org-wide" default a new or lightly-used project
can simply inherit.

This was surfaced concretely by livingwork: its `.laneconductor.json` and the
`projects` DB row both correctly have `primary_cli = 'claude'`, but setup gaps
flagged it as unconfigured/unreachable anyway. Root cause: livingwork has
never had its own `lc worker start` process — all its actual plan/implement
work has run as the manager's own ad-hoc subagent `Task` calls `cd`'d into its
directory. No worker has ever reported a `provider_status` row for
livingwork's `project_id`, so `computeSetupGaps` (`conductor/services/setup-gaps.mjs`)
cannot distinguish *"never verified because no dedicated worker has ever run
here"* from *"genuinely broken."* The same gap machinery also treats "no
online worker" as unconditionally blocking, with no way for a project to say
"I don't expect one — the manager drives me directly, by design."

Two related but separable problems, both in scope here:

1. **No shared defaults.** `primary.cli`/`.model` and workflow-shaped settings
   are 100% per-project with no cascade.
2. **No "never verified vs. broken" distinction**, and no "manager-driven, no
   worker expected" declaration, in the setup-gaps machinery.

## Existing Building Blocks (context for the design below)

- `conductor/services/meta-project.mjs` (track 1091): guarantees a
  filesystem-first, DB-registered "LaneConductor Meta" project always exists
  at `META_PROJECT_REPO_PATH` (under the manager's configured projects dir,
  or `$HOME` if unconfigured), with its own `projects` row and thus its own
  `project_id`. Works in every mode, no DB dependency for the on-disk half.
- `conductor/laneconductor.sync.mjs` already layers `HARDCODED_DEFAULTS` <
  `conductor/defaults.json` < `.laneconductor.json` for `project.primary.cli`/
  `.model` — but `conductor/defaults.json` is **per-project** (resolved
  against *that project's own* primary checkout via `resolveConfigRoot`),
  not shared across projects. This is a different, narrower mechanism than
  what's being requested, and is left untouched.
- `loadWorkflowConfig()` (`conductor/laneconductor.sync.mjs` ~line 1804)
  already falls back from a project's own `conductor/workflow.json` to a
  **whole-file** canonical copy at the LaneConductor install path — but it's
  all-or-nothing (one file replaces the other entirely); a project cannot
  override just one lane's `max_retries` while inheriting everything else.
- `workflow.md`'s "Model Overrides" section already documents a 3-level
  precedence (track marker > lane `primary_model` > project
  `primary.model`) for model *selection specifically* — this track adds a
  4th, lowest tier beneath that stack, and generalizes the same shape to
  `primary.cli` and to workflow.json's lane settings generally.
- `provider_status` is `PRIMARY KEY (project_id, provider)` with no
  machine/hostname column — see Non-Goals below.

## Requirements

### REQ-1 — Meta-defaults file, not the meta project's own `.laneconductor.json`

A new, dedicated file `conductor/meta-defaults.json`, living inside the
already-guaranteed-to-exist meta project's own folder
(`META_PROJECT_REPO_PATH/conductor/meta-defaults.json`), is the shared
default source. It is **not** the meta project's own `.laneconductor.json` —
that file describes the meta project's *own* identity/config as a project in
its own right; reusing it to also mean "defaults published to every other
project" would conflate two different concerns and risks the meta project
silently inheriting its own published defaults. Shape:

```json
{
  "project": { "primary": { "cli": "claude", "model": null } },
  "workflow": { "lanes": { "...": { "...": "..." } }, "global": { "...": "..." } }
}
```

Absent file, missing keys, or malformed JSON are all treated as "no meta
defaults configured" (`{}`) — never an error, never a startup blocker. This
mirrors how `conductor/defaults.json` already degrades today.

### REQ-2 — Precedence for `project.primary.cli` / `.model`

Highest to lowest, each tier only filling in what the one above left unset:

1. `--cli`/`--model` CLI flags (existing, in-memory only, unchanged)
2. Project's own `.laneconductor.json` (existing, unchanged)
3. Project's own `conductor/defaults.json` (existing, unchanged)
4. **`conductor/meta-defaults.json`'s `project.primary` (NEW)**
5. Hardcoded engine fallback (`cli: 'claude'`, unchanged)

A project's own settings always win; the meta tier only fills gaps the
project left unset — it never overrides an explicit project value.

### REQ-3 — Precedence for `workflow.json` (field-level, not whole-file)

`loadWorkflowConfig()` changes from "return whichever whole file is found
first" to a **deep merge**, keyed by `lanes.<lane>.<key>` and top-level
`global`/`defaults` blocks, in this order (highest wins):

1. Project's own `conductor/workflow.json` (existing file, existing fields)
2. **`conductor/meta-defaults.json`'s `workflow` block (NEW)**
3. Existing whole-file global canonical `conductor/workflow.json` at the
   LaneConductor install path (existing fallback, kept for back-compat for
   any project with *no* local `workflow.json` at all and no meta defaults
   either)
4. `lane-model-resolver.mjs`'s own hardcoded per-lane engine defaults
   (existing, unchanged)

A project can now override a single lane's single key (e.g.
`lanes.review.max_retries`) while inheriting everything else the meta
defaults or install-path canonical file provide, instead of having to
restate an entire `workflow.json`.

### REQ-4 — Explicit opt-out, not per-field silence

New optional field in `.laneconductor.json`: `project.inherit_meta_defaults`
(boolean, default `true`). Setting it to `false` skips the meta-defaults tier
entirely — both REQ-2's and REQ-3's tier 4/2 — for that project. This is a
single on/off switch, not per-field opt-out: per-field silent inheritance vs.
override is already fully expressible today (a project either sets a field
in its own config, in which case it wins per REQ-2/REQ-3, or it doesn't, in
which case it inherits) — a *second*, separate per-field "explicitly refuse
to inherit this one field" sentinel would be genuine over-engineering for a
need nobody described.

### REQ-5 — `worker_mode`: a project that intentionally has no dedicated worker

New optional field in `.laneconductor.json`: `project.worker_mode`, one of
`'dedicated'` (default) or `'manager-driven'`. `'manager-driven'` declares
"this project is, by design, driven by the manager's own ad-hoc sessions —
no standing `lc worker start` process is expected for it," exactly
livingwork's situation.

### REQ-6 — `computeSetupGaps` gains two inputs, changes two gaps

`conductor/services/setup-gaps.mjs` stays a pure function. New inputs:

- `workerMode: 'dedicated'|'manager-driven'` (default `'dedicated'` at every
  call site, so omitting it reproduces today's exact behavior)
- `primaryProviderReachableAnywhere: boolean` — true if *some* project on
  this LaneConductor instance has a fresh `available` `provider_status` row
  for this same `primary_cli`, independent of whether *this* project has
  ever reported one itself

Gap logic changes:

- **`no-workers`**: when `workerMode === 'manager-driven'` and
  `!hasOnlineWorker`, this is no longer raised as `blocking`. It is instead
  reported as `advisory` with a distinct `id: 'manager-driven-no-worker'`
  and a detail that says this is expected, not broken. `workerMode ===
  'dedicated'` (the default) is completely unaffected — identical output to
  today.
- **`no-provider`**: currently fires whenever `!primaryCliConfigured ||
  !primaryProviderReachable`. Add: if `primaryCliConfigured &&
  !primaryProviderReachable && workerMode === 'manager-driven' &&
  primaryProviderReachableAnywhere`, do **not** raise `no-provider` — a
  manager-driven project inherits "verified reachable" from any other
  project on the instance that has actually checked the same CLI, since CLI
  reachability is a machine+binary property, not a project property.
  `workerMode === 'dedicated'` keeps today's exact behavior unconditionally
  (a dedicated-worker project must still verify its own reachability; the
  cross-project inheritance is *only* for projects that declared they have
  no worker of their own to do that verification).

### REQ-7 — Call sites read the new fields without a DB migration

Both existing `computeSetupGaps` call sites (`ui/server/index.mjs`'s
`/api/state` route, `bin/lc.mjs`'s `state`/gap command) already read
per-project markers straight off disk for other advisory checks (e.g.
`hasProductMd` reads `conductor/product.md` off `project.repo_path` directly,
not from a DB column). `worker_mode` and `inherit_meta_defaults` follow the
same pattern: read directly from `.laneconductor.json` at `project.repo_path`
at gap-computation time. **No new `projects` table column, no migration.**

`primaryProviderReachableAnywhere` is a small additional query at each call
site: does any row exist in `provider_status` for this `provider` with
`status = 'available'` (any `project_id`, excluding the "already checked and
it's this project's own row" case, which is already covered by the existing
`primaryProviderReachable` input).

## Non-Goals

- **Per-field opt-out** from meta defaults (see REQ-4) — the single
  `inherit_meta_defaults` switch is the whole opt-out surface.
- **True machine-scoping** of `primaryProviderReachableAnywhere`.
  `provider_status` has no hostname/machine column, so "reachable anywhere"
  really means "reachable anywhere on this LaneConductor instance's shared
  Postgres." For `local-api` (today's primary supported mode, inherently one
  machine) this is accurate. For a multi-machine `remote-api` instance it is
  an over-approximation — a CLI verified reachable on machine A would
  incorrectly count as reachable for a manager-driven project living on
  machine B. This is a known, documented limitation, not solved here; fixing
  it properly would need its own `provider_status` schema change (adding a
  hostname column) and is its own separable track if it turns out to matter
  in practice.
- **New CLI subcommands.** `bin/lc.mjs` already has a generic
  `lc config set <key> <value>` (writing into `.laneconductor.json` via
  `setNestedKey`). `lc config set project.worker_mode manager-driven` and
  `lc config set inherit_meta_defaults false` already work with zero new
  code — this track only needs to document them, not add bespoke
  `lc config worker-mode ...` commands.
- **Rewriting `conductor/defaults.json`'s existing per-project mechanism.**
  It stays exactly as-is; the new meta tier sits below it in precedence
  (REQ-2), not instead of it.
- **Editing `META_PROJECT_REPO_PATH`'s own `.laneconductor.json`** as part of
  this track — `meta-defaults.json` is a separate, new file (REQ-1).

## Acceptance Criteria

- [x] A project with no `primary.cli` set anywhere in its own
      `.laneconductor.json`/`conductor/defaults.json`, but with
      `conductor/meta-defaults.json` at the meta project setting
      `project.primary.cli = "claude"`, resolves an *effective* primary CLI
      of `"claude"` — verified via the sync worker's own config resolution
      (not just a unit test of the merge helper in isolation) and via
      `lc state --json` reporting the same effective value `bin/lc.mjs` uses
      for its own gap computation.
- [x] The same project, once its own `.laneconductor.json` sets
      `primary.cli = "antigravity"`, resolves to `"antigravity"` — project
      config always wins over the meta tier.
- [x] Setting `project.inherit_meta_defaults: false` makes that same project
      fall through to the hardcoded `"claude"` engine default instead of the
      meta tier's value, even though the meta tier still has a value
      configured.
- [x] A project's `conductor/workflow.json` that only specifies
      `lanes.review.max_retries` inherits every other lane's settings from
      `conductor/meta-defaults.json`'s `workflow` block (when present) or the
      existing install-path canonical file (when no meta defaults exist) —
      not just its own single overridden key in isolation.
- [x] `computeSetupGaps` unit tests (extending
      `conductor/tests/track-10069-setup-gaps.test.mjs`): a
      `workerMode: 'dedicated'` fixture produces byte-identical gap output to
      today, with or without the two new inputs supplied — confirms zero
      behavior change for the default/unaffected case.
- [x] `computeSetupGaps` with `workerMode: 'manager-driven'`,
      `hasOnlineWorker: false`: no `blocking` gap is raised for the missing
      worker; an `advisory` `manager-driven-no-worker` gap is raised instead.
- [x] `computeSetupGaps` with `workerMode: 'manager-driven'`,
      `primaryProviderReachable: false`, `primaryProviderReachableAnywhere:
      true`: no `no-provider` gap is raised.
- [x] `computeSetupGaps` with `workerMode: 'manager-driven'`,
      `primaryProviderReachable: false`, `primaryProviderReachableAnywhere:
      false`: `no-provider` gap **is** still raised — inheriting reachability
      requires that *someone* actually verified it somewhere; a
      manager-driven project doesn't get a free pass with zero evidence
      anywhere on the instance.
- [x] livingwork specifically, once given `**worker_mode**: manager-driven`
      (or the config-file equivalent) and with `claude` verified reachable
      by at least one other project's worker on the same instance, no longer
      shows `no-workers`/`no-provider` as blocking gaps in the real running
      dashboard — this is the concrete incident this track exists to fix,
      so it must be checked against the real instance, not only unit tests.
- [x] `conductor/workflow.md`'s "Model Overrides" section documents the new
      4th precedence tier and the `meta-defaults.json` / `worker_mode` /
      `inherit_meta_defaults` mechanism.
