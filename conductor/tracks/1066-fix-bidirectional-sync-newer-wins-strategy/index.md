# Track 1066: Fix bidirectional sync - newer wins strategy

**Lane**: implement
**Lane Status**: running
**Progress**: 20%
**Phase**: Phase 1 - Timestamp comparison (3/4 tasks)
**Summary**: Implement 'newer wins' timestamp-based conflict resolution in laneconductor.sync.mjs. When track content_summary or last_updated in DB is newer than filesystem files, pull full track details (spec.md, plan.md, test.md) from database to filesystem. Currently only does filesystem→DB sync, missing DB→filesystem pull when DB has newer version.
