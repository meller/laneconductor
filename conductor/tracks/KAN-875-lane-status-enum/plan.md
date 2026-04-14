# Track 1016: Lane Status Enum Implementation

## Phase 1: Prisma Schema Update

**Problem**: Database uses String type for lane_action_status; no type safety.
**Solution**: Define LaneActionStatus enum in Prisma schema and update model.

- [ ] Add enum definition to schema.prisma:
  ```prisma
  enum LaneActionStatus {
    queue
    success
    failure
  }
  ```
- [ ] Update tracks model: change `lane_action_status String?` to `lane_action_status LaneActionStatus?`
- [ ] Update default: `@default(queue)`
- [ ] Verify Prisma codegen: `npx prisma generate`

**Impact**: Prisma client will enforce enum type at code level.

---

## Phase 2: Atlas Migration

**Problem**: Database column is still VARCHAR; needs schema migration.
**Solution**: Create Atlas migration to alter column type and add constraint.

- [ ] Generate migration: `make db-diff MIGRATION_NAME="lane_status_enum"`
- [ ] Review generated migration file (should contain ALTER COLUMN + CAST)
- [ ] Apply migration: `make db-migrate`
- [ ] Verify: `make db-status`

**Impact**: Database enforces enum values; old string values rejected.

---

## Phase 3: Worker Code Update

**Problem**: Worker parses **Status** field; doesn't understand **Lane Status** enum.
**Solution**: Update worker to parse **Lane Status** field and validate enum values.

- [ ] In `laneconductor.sync.mjs`:
  - Add `parseLaneStatus(content)` function to extract **Lane Status** field
  - Validate value is one of: `queue`, `success`, `failure`
  - Include in track payload: `lane_action_status: laneStatus`
- [ ] Update track markdown parsing to read `**Lane Status**: [queue|success|failure]`
- [ ] Test: manually update a track markdown and verify worker syncs enum value

**Impact**: Worker correctly syncs enum values from markdown to database.

---

## Phase 4: UI Display Update

**Problem**: UI displays `waiting`/`running`/`done` strings; needs enum display.
**Solution**: Update UI components to show proper enum state badges.

- [ ] Update track card component:
  - Map `queue` → "⏳ Queued" (yellow badge)
  - Map `success` → "✅ Success" (green badge)
  - Map `failure` → "❌ Failed" (red badge)
- [ ] Update lane status display in detail view
- [ ] Add state machine help tooltip: "queue → (processing) → success or failure"

**Impact**: UI clearly shows track automation state.

---

## Phase 5: Migrate Existing Tracks

**Problem**: Existing tracks have old string values; need conversion.
**Solution**: Update all track markdown files to use new enum values.

- [ ] Query database: find all tracks with `lane_action_status IN ('waiting', 'running', 'done')`
- [ ] For each track:
  - Open its `index.md`
  - Update `**Lane Status**: [old-value]` to new enum value
  - Commit: `docs(track-NNN): migrate to lane status enum`
- [ ] Worker will auto-sync updated values

**Impact**: All tracks use new enum consistently.

---

## Phase 6: Documentation Update

**Problem**: workflow.md doesn't document lane state machine with enums.
**Solution**: Add comprehensive state machine documentation.

- [ ] Update `conductor/workflow.md`:
  - Add "Lane State Machine" section
  - Document state transitions: queue → (processing) → success or failure
  - Add table: Lane × LaneActionStatus combinations
  - Document how to transition states in markdown
- [ ] Add example: "**Lane Status**: queue" in track templates

**Impact**: Developers understand proper enum usage.

---

## ✅ Success Criteria Met
- All code and database updated to enum
- All tracks migrated to new format
- UI and worker handle enum correctly
- Documentation complete
