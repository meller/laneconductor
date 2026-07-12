# Track 1078: Add conductor/design-language.md to project scaffolding

## Phase 1: Add design-language.md to scaffold generation

**Problem**: `design-language.md` doesn't exist as a generated scaffold file anywhere.
**Solution**: add it everywhere `product-guidelines.md`/`deployment-stack.md` are generated,
plus a dedicated template block.

- [x] `setup scaffold generate`'s file list (SKILL.md ~L239): added
      `**`conductor/design-language.md`** — color tokens (light/dark), typography scale,
      spacing system, component conventions, iconography/motion (stub with placeholders if
      unknown)`.
- [x] Progress-print block: added `📝 Writing conductor/design-language.md...    ✅`.
- [x] `setup scaffold` Mode A's existing-code inference list: added
      `design-language.md — inferred from existing Tailwind/CSS-variable config, component
      library theme (e.g. shadcn, MUI theme), or design-token files if present; otherwise
      minimal template like product-guidelines.md`.
- [x] "Both modes create" file tree: inserted `design-language.md` alongside
      `product-guidelines.md`.
- [x] Wrote the `design-language.md` template block, placed immediately before the existing
      `kpis.md` template for consistency of presentation, covering: Color Tokens (light/dark,
      table), Typography Scale, Spacing System, Component Conventions, Iconography/Motion.

**Impact**: `lc setup` / `/laneconductor setup scaffold` now produce a dedicated design-system
doc for every new (or re-scaffolded) project, instead of a 4-bullet subsection buried in
`product-guidelines.md`.

## Phase 2: Wire design-language.md into context-loading steps

**Problem**: even once the file exists, nothing reads it yet.
**Solution**: add it to the two commands that load project context before acting.

- [x] `/laneconductor review`'s "Load Context" step: added `design-language.md` alongside the
      existing `product-guidelines.md` read (both `if present`).
- [x] `/laneconductor implement`'s "Read existing context" step: added three new bullets
      mirroring the existing `deployment-stack.md (if present)` line — reads
      `product-guidelines.md`, `design-language.md`, and `tech-stack.md` (all `if present`).

**Impact**: implementation work — especially UI-touching tracks — is now guided by the
project's actual design system and stack while being written, not just checked against it
after the fact in review.

## Phase 3: Fundamentals-conflict guardrail

**Problem**: no mechanism today for `plan`/`implement` to flag when a track's work conflicts
with, or implies a needed change to, one of the fundamental docs.
**Solution**: add an explicit guardrail bullet to both commands' protocols.

- [x] `/laneconductor plan` protocol: added step 5b — if the track's requirements appear to
      conflict with or require a change to a fundamental doc (`product-guidelines.md`,
      `design-language.md`, `tech-stack.md`, `workflow.md`), do NOT silently edit it. Append a
      `⚠️ FUNDAMENTALS CONFLICT` comment to `conversation.md` naming the doc and conflict, and
      note it in `spec.md`'s Requirements section. Non-blocking by default.
- [x] `/laneconductor implement` protocol: added step 3b — the parallel guardrail, checked
      against the now-loaded `product-guidelines.md`/`design-language.md`/`tech-stack.md`
      content from Phase 2. Same comment format. Non-blocking unless the conflict is severe
      enough that proceeding would be actively wrong, in which case treat as any other
      blocker.
- [x] Defined the exact comment format in both locations (kept identical wording so it's
      recognizable regardless of which command posted it):
      ```
      > **system**: ⚠️ FUNDAMENTALS CONFLICT — this track's [requirement] appears to require
      changing conductor/[doc].md ([specific conflict]). Continuing implementation as
      specified; doc not modified — please review whether conductor/[doc].md should be
      updated.
      ```

**Impact**: fundamental project docs (design language, stack, product guidelines, workflow)
can no longer drift silently through automated track work — every implied change surfaces as
a visible, human-reviewable comment.

## Phase 4: Verify

- [x] Diff-reviewed the updated SKILL.md sections: `git diff --stat` shows 63 insertions, 1
      deletion (the single line that was directly superseded, not an accidental removal) — no
      unintended changes elsewhere in the file.
- [x] Ran every grep command from `test.md` (TC-1 through TC-9) — all passed. Found and fixed
      one issue during verification: the implement guardrail's `⚠️ FUNDAMENTALS CONFLICT`
      phrase initially wrapped across two lines mid-phrase, causing TC-8's single-line grep to
      miss it — reflowed the paragraph so the phrase stays on one line (cosmetic fix, no
      content change).
- [x] Read back the new `design-language.md` template block against the `kpis.md` template —
      consistent style (H1 title, H2 sections, table where structured data fits).
- [x] No application code touched — verification was the grep-based cross-reference suite in
      `test.md`, all green.

## ✅ COMPLETE
