# Track AM-10153: Release and download route: a rolling latest zip, and a Download button

**Lane**: implement
**Lane Status**: queue
**Progress**: 0%
**Phase**: Planned and sent to implement 2026-11-20 (owner): a GitHub Action keeps one rolling zip, always the newest base plugin, at a stable address; then a Download button. Nothing is published until the owner says yes to pushing the workflow.
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: People can install LaneConductor from the marketplace, but there is no zip for the "Upload plugin" route in the Claude desktop app and claude.ai, and the landing page and README have no Download route. A hand-made numbered release for every change would be a chore, so a GitHub Action keeps one zip, always the newest, at a stable address.
**Summary**: A GitHub Action rebuilds the base plugin zip on every change and replaces the one asset of a rolling `latest` release; the landing page and README link to its stable address. Before it goes live, one claim-by-claim read of the README, wiki and landing page, and the answer to where the plugin README comes from.
