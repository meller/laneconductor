# Spec: DB as Transport for Conductor File Content

## Problem Statement
The Vite dashboard shows lanes/cards but has no visibility into the content of conductor context files or track planning documents. Accessing these requires opening the filesystem directly. The UI should surface this content natively — and do so without a filesystem dependency so the dashboard works from any machine with DB access.

## Requirements

### DB Schema
- REQ-1: `projects` table gets a `conductor_files` JSONB column (or separate table) storing `{ filename: content }` for product.md, tech-stack.md, workflow.md, product-guidelines.md, code_styleguides/
- REQ-2: `tracks` table gets `index_content`, `plan_content`, `spec_content` TEXT columns

### Heartbeat Worker
- REQ-3: On startup and on file change, worker reads all conductor context files and pushes content to DB
- REQ-4: On track file change (index.md, plan.md, spec.md), worker reads all three and pushes to DB
- REQ-5: Content push is non-blocking — errors are logged but don't crash the worker

### Express API
- REQ-6: `GET /api/projects/:id/conductor` → returns conductor context files content from DB
- REQ-7: `GET /api/projects/:id/tracks/:num` → returns track detail including index/plan/spec content

### UI
- REQ-8: Project header/sidebar shows tabs for product.md, tech-stack.md, workflow.md
- REQ-9: Track card expands/links to a detail view with tabs for index.md, plan.md, spec.md
- REQ-10: Markdown rendered in UI (not raw text)

## Acceptance Criteria
- [ ] Editing product.md on disk → content updates in UI within 5s (heartbeat pushes on change)
- [ ] Track card click → opens detail panel showing plan.md rendered as markdown
- [ ] UI works correctly even if the project repo is not on the same machine as the browser
- [ ] Worker continues running if a conductor file is missing (graceful skip)

## API Contracts

### `GET /api/projects/:id/conductor`
```json
{
  "product": "# Product: LaneConductor\n...",
  "tech_stack": "# Tech Stack\n...",
  "workflow": "# Workflow\n...",
  "product_guidelines": "...",
  "code_styleguides": {
    "javascript": "..."
  }
}
```

### `GET /api/projects/:id/tracks/:num`
```json
{
  "track_number": "005",
  "title": "DB as Transport",
  "lane_status": "in-progress",
  "progress_percent": 40,
  "index": "# Track 005...",
  "plan": "## Phase 1...",
  "spec": "# Spec..."
}
```
