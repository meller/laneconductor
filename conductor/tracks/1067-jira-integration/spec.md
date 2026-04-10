# Spec: Track 1067 - Unified Integration Architecture

## Overview
Implement a flexible, generic integration system that supports modular webhooks and workflow-driven feedback loops. This replaces specialized "one-off" API endpoints with a scalable plugin-style architecture.

## Requirements

### R1: Unified Webhook Router
- New route: `POST /v1/webhooks/:provider`
- Supports an `Adapters` registry for payload translation (Jira, GitHub, Linear, etc.).
- Signature verification (HMAC) handled per provider.
- Resolves project context via API token or provider-specific domain mapping.

### R2: Workflow Action Service
- Centralize track state machine logic into `services/TrackService.js`.
- Automatically execute side effects when a track moves between lanes.
- Ensure consistency between UI-triggered moves and external-triggered moves.

### R3: Inbound Jira Adapter
- First concrete implementation of the modular registry.
- Translates Jira "Issue Created/Updated" events into LC track operations.
- Handles project identification via Jira issue keys or project mapping.

### R4: Outbound Feedback Hooks (`workflow.json`)
- Extend the `workflow.json` schema to support an `on_transition` or `hooks` array per lane.
- Example: `{ "target": "jira", "action": "comment", "template": "Track moved to review." }`
- New `HookEngine` to dispatch these calls asynchronously.

### R5: Integration & Secret Management
- Reuse existing `api_keys` / `api_tokens` mechanism for inbound authentication.
- Added support for **dynamic runtime secret resolution** via GCP Secret Manager (`--store-type gcp-secret`).
- Infrastructure now supports resolving `LC_PROD_KEY` style secrets at the worker level, preventing `.env` leaks in production environments.
- Add `integrations` JSONB column to `projects` table to store project-scoped secrets (External API Keys, URLs) for outbound hooks.

### R6: Multi-Target Synchronization
- Refactor `laneconductor.sync.mjs` and `lc` CLI to support an arbitrary list of collectors.
- Support individual **Target Toggles** (`lc toggle-target <url>`) to enable/disable sync per endpoint.
- Bidirectional track state fanning: all write operations (logs, comments, transitions) are broadcast to all enabled collectors simultaneously.

