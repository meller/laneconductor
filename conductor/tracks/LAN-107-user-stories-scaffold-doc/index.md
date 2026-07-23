# Track LAN-107: `user-stories.md` as a first-class scaffold artifact

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implemented and live-verified against two real projects (laneconductor itself and
coachai/aitutor). Found and fixed a second hardcoded file-list location (the chokidar watch
config) beyond the one originally scoped, and discovered each project runs its own separate sync
worker process — a code change requires restarting every affected project's worker individually,
not just one.
**Type**: dev
**Summary**: A downstream project (coachai) wants to collect user stories (e.g. "psychologist
invited by admin", "client invited by psychologist") as a durable, canonical doc that an E2E
testing effort can build on, rather than re-deriving flows from scratch each time. Requested this
be a proper scaffold artifact — generated like `product.md`/`kpis.md`/`deployment-stack.md`,
shown in the dashboard UI, and kept in sync — not just a hand-written file living outside
LaneConductor's normal context system.

## Investigation: the requested precedent ("like deploy md design kpis") doesn't fully exist yet

Checked whether `kpis.md`, `deployment-stack.md`, and `design-language.md` are actually wired
end-to-end (generated → synced to DB → shown in UI), since the request assumes they already are:

- **Generated**: yes. `bin/lc.mjs`'s `setup`/`setup-deploy` wizards write `conductor/kpis.md` and
  `conductor/deployment-stack.md` to disk (lines ~926, ~1229). The skill's scaffold-generation
  instructions also describe generating these plus `design-language.md`.
- **Synced into `conductor_files`**: **no**. `conductor/laneconductor.sync.mjs`'s conductor-files
  builder (~line 1378) only reads `product.md`, `tech-stack.md`, `product-guidelines.md`, and
  `quality-gate.md` into the `conductor_files` JSON blob that the UI actually fetches. `kpis.md`,
  `deployment-stack.md`, and `design-language.md` are never read into it.
- **Shown in UI**: **no**. `ui/src/components/ConductorPanel.jsx`'s `TABS` array only has
  `product`, `tech_stack`, `workflow`, `product_guidelines`, `quality_gate` — no tab exists for
  kpis, deployment stack, or design language at all.

So these three docs are currently scaffold-generated-but-orphaned: they exist as files on disk
after setup, but nothing surfaces them anywhere in the dashboard, and file edits never sync
anywhere. This track needs to both (a) add `user-stories.md` as a new artifact and (b) fix this
same gap for the three that were assumed to already work, since `user-stories.md` would otherwise
land in the identical orphaned state.

## What this track adds

1. `conductor/user-stories.md` generated as part of `/laneconductor setup scaffold` /
   `setup scaffold generate`, alongside the existing product/tech-stack/etc. files. Content shape:
   named personas + their journeys (e.g. "Admin invites a Professional", "Professional invites a
   Client"), not prescribing a fixed format beyond that — see spec.md.
2. Sync fix: `laneconductor.sync.mjs`'s conductor-files builder reads `user-stories.md`, `kpis.md`,
   `deployment-stack.md`, and `design-language.md` into `conductor_files` (matching the existing
   `readIfExists` pattern for the other four).
3. UI fix: `ConductorPanel.jsx`'s `TABS` gets `user_stories`, `kpis`, `deployment_stack`,
   `design_language` entries.
4. Downstream: coachai's own track (opened separately, in that project) uses this once available.
