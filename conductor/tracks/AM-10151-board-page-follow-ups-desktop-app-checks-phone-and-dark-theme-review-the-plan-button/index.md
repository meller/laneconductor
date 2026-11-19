# Track AM-10151: Board page follow-ups: desktop-app checks, phone and dark-theme check, and the Review-the-plan button

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Parked in the backlog: left over from track 10115 (closed). Nothing here blocks anything.
**Track Kind**: feature
**Type**: dev
**Priority**: low
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Track 10115 shipped the board (card actions, Project drawer, What's next, freshness, partial publish, auto-refresh) but left four things unverified or unbuilt, all on the board page: the Move menu and "Check now" rely on the page reaching the local connector as a host server, a string that was never verified in the desktop app (every publish prints that warning); the page was never checked at phone width and in dark mode by a person; the Review-the-plan button (the `sample` capability) was not built; and the plugin commands were never tried by hand on a scratch repository.
**Summary**: Verify the Move menu and Check now in the desktop app, check the board at 375 px and in both themes, build the Review-the-plan button if wanted, and try status, plan and run by hand on a scratch repository.
