# Track TU-10057: Main-mode dirty-checkout guard is wedged by the worker's own index.md sync writes

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: The main-mode pre-spawn guard (conductor/laneconductor.sync.mjs around line 4894) refuses to spawn a main-mode lane action when the primary checkout has uncommitted changes outside the track's own…
**Auto Run**: yes
