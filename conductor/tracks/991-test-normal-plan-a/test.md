# Tests: Track 991 — Test Normal Plan A

All commands are run from the repo root. `T=conductor/tracks/991-test-normal-plan-a`.

## Test Commands

```bash
T=conductor/tracks/991-test-normal-plan-a

# Phase 1 — planning artifacts exist and are not stubs
ls "$T"/spec.md "$T"/plan.md "$T"/test.md "$T"/conversation.md
[ "$(grep -cE '^- \[ \] TC-' "$T"/test.md)" -ge 1 ]

# Phase 2 — canary marker content is exact
[ "$(cat "$T"/canary-a.txt)" = "Normal Plan A OK" ]

# Phase 3 — lane markers match workflow.json, comments are syncable
grep -E '^\*\*Lane\*\*: plan$' "$T"/index.md
grep -E '^\*\*Lane Status\*\*: success$' "$T"/index.md
node -e 'const w=require("./conductor/workflow.json");console.log(w.lanes.plan.on_success)'
grep -cE '^> \*\*(system|claude|human|gemini)\*\*: ' "$T"/conversation.md

# Regression — project suites must stay green
node --test conductor/tests/
cd ui && npm test
```

## Test Cases

### Phase 1: Plan-lane artifacts

- [ ] TC-1.1: `ls` of the four artifact files — expected: all four present, exit 0
- [ ] TC-1.2: `test.md` names at least one concrete `TC-` case — expected: count ≥ 1
      (REQ-1; a `test.md` left at the skill's generic placeholder is a plan-lane
      failure, not a pass. Asserted positively on purpose: grepping for the
      placeholder string would match this file's own prose describing it)
- [ ] TC-1.3: `spec.md` contains a `## Acceptance Criteria` section with at least
      one checkbox — expected: `grep -c '^- \[ \]' "$T"/spec.md` ≥ 1
- [ ] TC-1.4: Every phase heading in `plan.md` has a matching phase section in
      `test.md` — expected: counts agree (3 phases, 3 phase sections)

### Phase 2: Canary marker

- [ ] TC-2.1: `canary-a.txt` exists — expected: exit 0 (fails before implement runs;
      this is the case that proves implement actually did something)
- [ ] TC-2.2: Content equality check — expected: exactly `Normal Plan A OK`, no
      leading/trailing whitespace beyond one trailing newline
- [ ] TC-2.3: The file lives inside the track folder, not the repo root — expected:
      `test ! -f canary-a.txt` at repo root (path-isolation check)

### Phase 3: Flow assertions

- [ ] TC-3.1: `**Lane**` in `index.md` equals the lane half of
      `workflow.json`'s `lanes.plan.on_success` — expected: both read `plan`
- [ ] TC-3.2: `**Lane Status**` equals the status half — expected: `success`
- [ ] TC-3.3: `**Progress**` reads `100%` once the plan run exits successfully —
      expected: `100%`. Counter-intuitive but correct as of this observation: the
      worker forces 100% on *any* successful lane-action exit
      (`conductor/laneconductor.sync.mjs:4494`), so a plan-only track reports 100%
      with nothing implemented. Do not "fix" this case to `0%` without first
      changing the worker — see the open item in `spec.md`.
- [ ] TC-3.6: The progress-forcing carve-outs still exclude the `plan` lane —
      expected: `grep -n 'isConversationRun && !isBlockedTurn'
      conductor/laneconductor.sync.mjs` still matches. If this line gains a
      plan-lane carve-out, TC-3.3 flips back to expecting `0%` and this canary
      is how you find out.
- [ ] TC-3.4: Every non-blank line in `conversation.md` that carries content is
      either the file header or matches `^> ` — expected: no orphaned prose that
      would silently fail to sync to `track_comments`
- [ ] TC-3.5: At least one `> **system**: ✅ ...` completion comment is present —
      expected: count ≥ 1

### Regression

- [ ] TC-R.1: `node --test conductor/tests/` — expected: all pass, no new failures
- [ ] TC-R.2: `cd ui && npm test` — expected: all pass, no new failures

## Acceptance Criteria

- [ ] All Phase 1 cases pass after the `plan` lane run
- [ ] All Phase 2 and Phase 3 cases pass after the `implement` lane run
- [ ] Both regression suites pass — this canary must not perturb them
- [ ] No stub markers (`TODO`, `not yet implemented`, or the skill's generic
      test-case placeholder) remain in any file this track marks `[x]`
