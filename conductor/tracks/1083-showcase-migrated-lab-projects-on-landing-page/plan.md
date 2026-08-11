# Track 1083: Showcase Migrated Lab Projects on LaneConductor Landing Page

## Phase 1: Design the section

**Problem**: laneconductor.com currently has no "real projects" proof section.
**Solution**: Add a card-grid section reusing the visual pattern from ocumentor_landing's retired Labs tab.

- [ ] Task 1: Review `~/Code/laneconductor/conductor/design-language.md` (if present) for color tokens/typography to match
- [ ] Task 2: Design a card layout (image, title, one-line description, link) — can directly reference `ocumentor_landing/index.html`'s Labs tab markup as a starting point
- [ ] Task 3: Decide section placement (e.g. below the existing "Documentation"/"GitHub" section)

**Impact**: A concrete design to implement against, not ad hoc.

## Phase 2: Implement with whatever migrations are live

**Problem**: Not all four lab-project migrations will necessarily be done at the same time.
**Solution**: Ship incrementally — add a card per project as its DNS/hosting track completes, starting with chesstrainer (the pilot).

- [ ] Task 1: Add the showcase section markup/component to the landing page
- [ ] Task 2: Add a card for Chess AI Mentor → `chessmasters.laneconductor.com` (once Track 1063 ships)
- [ ] Task 3: Add cards for 5Elements, The Hero's Journey, Otralingo as their respective DNS/hosting tracks complete
- [ ] Task 4: Reuse existing icon assets (`chess.svg`, `5elements.png`, `hero.png`, `otralingo.png`) — copy from `ocumentor_landing/public/apps/` rather than recreating

**Impact**: Landing page grows a real "proof of use" section as migrations land, instead of waiting for all four before shipping anything.

## Phase 3: Verify & cross-link

- [ ] Task 1: Confirm all linked cards resolve to live, working apps (no broken links to not-yet-migrated projects)
- [ ] Task 2: Consider a reciprocal note on `ocumentor_landing`'s remaining SessionArc-only page, if appropriate, pointing back at laneconductor.com as the open-source tool behind these apps — optional, not required for this track's completion

## Progress: first card shipped

- [x] "Built with LaneConductor" section added to `landing/index.html`, reusing the existing `feature-card`/`features-grid` pattern (emoji icon, matching the page's existing visual language — no new image assets)
- [x] Chess AI Mentor card added, linking to `chessmasters.laneconductor.com`, placed between the Stats section and the final CTA
- [x] Removed from `ocumentor_landing/index.html`'s Labs tab entirely (not just relinked) — confirmed via rendered page text, no longer appears there
- [ ] 5Elements, The Hero's Journey, Otralingo cards — add as their respective DNS/hosting tracks (1035, 025, 1121) complete
