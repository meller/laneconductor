# Track AM-10153: Docs truth pass; one constant install one-liner, no zip

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Closed 2026-11-20 by the owner. No zip, release, Action or Download button: the install route is the constant marketplace one-liner, and the landing page reads the plugin versions live from docs/plugin-versions.json, so a release needs no site update. Done: the README zip section removed and its hooks sentence fixed, scripts/make-zip.mjs removed. Not done, dropped by the owner: the claim-by-claim read of the README, wiki and landing page, and the plugin README source question.
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Track 10114 left docs questions open: some claims on the README, wiki and landing page may be wrong (the base README says hooks are not available yet, but the board add-on ships them), the README describes a zip route that is not published, and it is not clear where the plugin README comes from. The owner decided not to publish a zip: the constant marketplace one-liner, with no version in it, always installs the newest plugins.
**Summary**: One claim-by-claim read of the README, wiki and landing page, fix the wrong claims (landing and wiki now; the README with the next base version), and answer where the plugin README comes from. No zip, release, Action or Download button.
