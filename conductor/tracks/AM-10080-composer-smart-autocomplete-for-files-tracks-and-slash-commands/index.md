# Track AM-10080: Composer smart autocomplete for @file mentions, @track references, and /slash commands

**Lane**: plan
**Merge Mode**: direct
**Lane Status**: running
**Progress**: 100%
**Phase**: Planned — 5 phases
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Implement rich autocomplete in the Chat composer for @file mentions, @track references, and /laneconductor commands, backed by worker filesystem metadata sync.

> [!NOTE]
> **Related to Track AM-10069**: This track implements smart autocomplete in the chat composer, which was identified during the coding-agent parity comparison.

## Problem

Standalone terminal coding agents provide path autocompletion and command shortcuts. The LaneConductor Web UI runs in a browser and has no direct filesystem access (especially in remote/distributed worker deployments or multi-machine setups). Chat users currently have to manually type long file paths from memory without autocomplete assistance.

## Scope

1. **Worker/API Filesystem Metadata Sync**:
   - Provide an API endpoint `GET /api/projects/:id/files?q=...` that queries the repository file list (`git ls-files`) with debounce and in-memory caching.
   - For remote worker instances, sync file manifests/metadata via collector heartbeats or on-demand file queries.
2. **Composer Autocomplete UI**:
   - Support trigger `@` for file path search with fuzzy matching and keyboard navigation (Up/Down/Enter/Tab/Escape).
   - Support trigger `@track` or `#` for referencing project tracks.
   - Support trigger `/` for `/laneconductor` slash commands (`move`, `plan`, `implement`, etc.).
3. **Context Injection**:
   - Insert selected file paths and relative references cleanly into the composer input.
