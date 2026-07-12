# Track 1078: Add conductor/design-language.md to project scaffolding

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: Added `conductor/design-language.md` to scaffold generation (file list, progress-print, Mode A inference, "Both modes create" tree, plus a template covering color tokens, typography scale, spacing, component conventions, iconography/motion) — previously only a thin 4-bullet subsection buried in `product-guidelines.md`. Wired it into `/laneconductor review`'s context load. Per human-confirmed requirements: `/laneconductor implement` now reads `product-guidelines.md`, `design-language.md`, and `tech-stack.md` (previously read none of them); and both `plan` and `implement` now carry a fundamentals-conflict guardrail — post a `⚠️ FUNDAMENTALS CONFLICT` comment naming the doc/conflict instead of silently drifting or rewriting a fundamental doc, non-blocking by default. All 9 test cases in `test.md` verified via grep against the updated `SKILL.md`.
