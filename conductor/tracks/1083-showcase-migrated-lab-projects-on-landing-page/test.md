# Tests: Track 1083 — Showcase Migrated Lab Projects on LaneConductor Landing Page

## Test Commands
```bash
# Visual check
cd landing && npm run dev   # or whatever the actual landing page dev command is — confirm via package.json

# Link check for each card added
curl -sI https://chessmasters.laneconductor.com | head -3
curl -sI https://5elements.laneconductor.com | head -3
curl -sI https://theherojourney.laneconductor.com | head -3
curl -sI https://otralingo.laneconductor.com | head -3
```

## Test Cases

### Feature: Landing page showcase section
- [ ] TC-1: Showcase section renders correctly and matches existing site's visual style
- [ ] TC-2: Every card's link resolves to a live, working app — no cards linking to not-yet-migrated subdomains
- [ ] TC-3: No regression to existing landing page sections (product pitch, docs, GitHub links still intact)
- [ ] TC-4: Icons/assets load correctly (reused from ocumentor_landing, confirm paths are correct after copying)

## Acceptance Criteria
- [ ] All test cases pass for whichever cards are live at implementation time
- [ ] Remaining project cards added as their migrations complete (tracked as follow-up if not all four are done yet)
