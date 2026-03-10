# Workflow

## Commit Strategy
- Use conventional commits
- Add track number like #1010
## Branching Model
- main: production-ready
- feature branches: track-NNN-description

## Development Process
1. Create track with `/laneconductor newTrack`
2. Write spec.md before coding
3. Implement in phases with commits per phase
4. Update progress with `/laneconductor pulse`

## Code Review
- Self-review before marking done
- Update plan.md with learnings after each phase

## Lane Transitions

Transitions can specify just a lane (defaults: moving → `queue`, staying → `success`/`failure`) or a explicit state using `lane:status` format.

| Lane         | On Success   | On Failure   |
|--------------|--------------|--------------|
| plan         | plan:success | plan:failure |
| implement    | review       | implement    |
| review       | quality-gate | implement    |
| quality-gate | done         | review       |

## Workflow Configuration
Machine-readable config lives in `conductor/workflow.json`.
Edit it directly or via `/laneconductor workflow set`.
See `conductor/workflow.json` for lane transitions, parallel limits, and model overrides.
