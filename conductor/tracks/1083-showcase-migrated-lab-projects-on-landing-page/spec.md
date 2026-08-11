# Spec: Showcase Migrated Lab Projects on LaneConductor Landing Page

## Problem Statement
ocumentor.com's landing page is being stripped down to SessionArc only — the "Labs & Playground" tab (Sage Council, Chess AI Mentor, 5Elements, Hero's Journey, Otralingo) is going away as those projects move to *.laneconductor.com. Right now laneconductor.com's own landing page has no equivalent showcase — it's a documentation/open-source site with no visible proof of real projects built and run through it. As each lab project's DNS/hosting migration (Tracks 1063-1065 chesstrainer, 1035-1037 5elements, 025-027 the_hero_journey, 1121-1123 otralingo) lands on a *.laneconductor.com subdomain, this is a natural, real showcase LaneConductor doesn't currently have.

## Requirements
- REQ-1: Add a "Built with LaneConductor" (or similar) section to laneconductor.com's landing page (`~/Code/laneconductor/landing/`), styled consistently with the existing site.
- REQ-2: One card per migrated project, linking to its live *.laneconductor.com subdomain — pull from whichever of the four migrations (chesstrainer/5elements/the_hero_journey/otralingo) have actually completed their DNS/hosting track by the time this ships; don't block on all four being done, add cards incrementally as each one lands.
- REQ-3: Reuse existing project descriptions/icons from ocumentor_landing's retired Labs tab as a starting point (chess.svg, 5elements.png, hero.png, otralingo.png) rather than commissioning new assets — confirm licensing/ownership is fine to reuse since these are the same apps, just re-hosted.
- REQ-4: Sage Council doesn't have a confirmed home yet (no dedicated repo was found during the earlier audit — it may be a feature of 5Elements rather than a standalone app). Don't include it here until that's resolved; track as a follow-up rather than blocking this one.
- REQ-5: Keep this additive to the existing landing page — don't restructure unrelated sections (LaneConductor's own product pitch, docs links, GitHub link) while doing this.

## Acceptance Criteria
- [ ] New showcase section live on laneconductor.com
- [ ] At least the already-migrated project(s) at the time of implementation are linked and working
- [ ] Visual style matches the rest of the site (check `conductor/design-language.md` if present)
- [ ] No regression to existing landing page sections

## Notes
- This track has a soft dependency on the four DNS/hosting migration tracks actually completing (or at least the first one or two) — implementing this before any migration has shipped would mean linking to URLs that don't exist yet. Sequence this after chesstrainer's 1063 (the pilot) is done, at minimum.
