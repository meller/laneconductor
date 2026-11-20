# Track AM-10151: Board page follow-ups: desktop-app checks, phone and dark-theme check, and the Review-the-plan button

**Lane**: implement
**Lane Status**: queue
**Progress**: 0%
**Phase**: In implement (owner, 2026-11-20). Done today: the board add-on hook now notices track changes made by any tool (REQ-5, board 1.10.4, with tests); the drawer links and the Discuss button shipped in 1.10.3 (REQ-6, REQ-7). Open: the desktop-app checks (REQ-1), the 375 px and dark-theme look (REQ-2), the Review-the-plan button decision (REQ-3), the by-hand status/plan/run check (REQ-4).
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Track 10115 shipped the board (card actions, Project drawer, What's next, freshness, partial publish, auto-refresh) but left four things unverified or unbuilt, all on the board page: the Move menu and "Check now" rely on the page reaching the local connector as a host server, a string that was never verified in the desktop app (every publish prints that warning); the page was never checked at phone width and in dark mode by a person; the Review-the-plan button (the `sample` capability) was not built; and the plugin commands were never tried by hand on a scratch repository.
**Summary**: Verify the Move menu and Check now in the desktop app, check the board at 375 px and in both themes, build the Review-the-plan button if wanted, and try status, plan and run by hand on a scratch repository.
