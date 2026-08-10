# Spec: /laneconductor plan doesn't reliably populate test.md

## Problem Statement

When planning a track using `/laneconductor plan`, the `test.md` file is often left at the generic `(Test cases to be added)` stub. This breaks `/laneconductor implement`'s TDD Protocol since there are no test cases to drive the implementation. Additionally, tracks created via the file sync queue completely omit the `test.md` file initially, and are later populated with a bare stub by the sync worker.

## Requirements

- **REQ-1: Robust Planning Step for test.md**: The `/laneconductor plan` instructions in `SKILL.md` must explicitly command the planning agent to fully populate/refine `test.md` with real, concrete test cases for each phase in `plan.md`. It must not leave the `(Test cases to be added)` stub.
- **REQ-2: Self-Healing during Implement**: The `/laneconductor implement` instructions in `SKILL.md` must specify that if `test.md` is missing, empty, or only contains the generic stub, the agent must first analyze the plan and spec, write real per-phase test cases to `test.md`, and then proceed with TDD implementation.
- **REQ-3: Initial test.md Creation in queue-based Track Creation**: Update `handleTrackCreate` in `laneconductor.sync.mjs` to write a structured `test.md` scaffold immediately upon track folder creation.
- **REQ-4: Structured Sync Stub**: Update `pullTracksMetadataFromDB`'s fallback stub in `laneconductor.sync.mjs` to write a fully-structured template for `test.md` (including headings for Test Commands, Test Cases, Acceptance Criteria) instead of a bare stub.

## Acceptance Criteria

- [ ] `SKILL.md` contains explicit instructions for `/laneconductor plan` to populate `test.md` with specific test cases.
- [ ] `SKILL.md` contains self-healing instructions for `/laneconductor implement` to generate `test.md` if it's missing or a stub.
- [ ] `laneconductor.sync.mjs`'s `handleTrackCreate` creates `test.md` with proper structure.
- [ ] `laneconductor.sync.mjs`'s `pullTracksMetadataFromDB` creates a structured `test.md` stub if it doesn't exist.
- [ ] Automated tests verify the new file-creation and self-healing logic.
