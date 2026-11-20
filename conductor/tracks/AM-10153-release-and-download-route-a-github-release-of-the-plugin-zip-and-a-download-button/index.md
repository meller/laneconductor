# Track AM-10153: Release and download route: a GitHub release of the plugin zip, and a Download button

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New: split out of track 10114 (REQ-10) on 2026-11-20 by the owner. Nothing is published, tagged or sent until the owner approves each outward step.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: People can install LaneConductor from the marketplace, but there is no GitHub release, so there is no zip to download or to load with "Upload plugin" in the Claude desktop app or claude.ai, and the landing page and README have no Download route. Track 10114 left this open (REQ-10) because it needs a published release, and a release is an outward step only the owner can approve.
**Summary**: Cut a GitHub release of the plugin zip (version bump, `scripts/make-zip.mjs`, checksum, tag, `gh release create`), each outward step approved by the owner, then add a Download button to the landing page and a download route to the README that link to it. Before the release, one claim-by-claim read of the README, wiki and landing against the code.
