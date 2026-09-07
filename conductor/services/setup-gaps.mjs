// conductor/services/setup-gaps.mjs
// Track 10069 Phase 1 (REQ-16): spec.md D4's seven-condition gap table,
// computed deterministically from already-fetched facts — no LLM turn,
// so a fully configured instance costs nothing to check (REQ-18/AC-10).
//
// Pure module, no I/O.

/**
 * @typedef {{ id: string, severity: 'blocking'|'advisory', subject: string,
 *   detail: string, remedy: string }} SetupGap
 */

/**
 * @param {object} input
 * @param {number} input.projectCount - total project rows in the instance
 * @param {boolean} input.hasOnlineWorker - this project has a worker whose
 *   heartbeat is inside the staleness window
 * @param {boolean} input.hasManagerWorker - a `type: 'manager'` worker is
 *   registered on this machine
 * @param {boolean} input.primaryCliConfigured - `project.primary.cli` is set
 * @param {boolean} input.primaryProviderReachable - provider_status reports
 *   the configured primary CLI as reachable
 * @param {boolean} input.hasProductMd - `conductor/product.md` exists and is
 *   not still the template stub
 * @param {boolean} input.hasTechStackMd - `conductor/tech-stack.md` exists
 *   and is not still the template stub
 * @param {boolean} input.createQualityGate - project config requests a
 *   quality gate
 * @param {boolean} input.hasQualityGateMd - `conductor/quality-gate.md` exists
 * @param {number} input.trackCount - tracks in this project
 * @returns {SetupGap[]}
 */
export function computeSetupGaps({
  projectCount,
  hasOnlineWorker,
  hasManagerWorker,
  primaryCliConfigured,
  primaryProviderReachable,
  hasProductMd,
  hasTechStackMd,
  createQualityGate,
  hasQualityGateMd,
  trackCount,
}) {
  const gaps = [];

  if (projectCount === 0) {
    gaps.push({
      id: 'no-projects',
      severity: 'blocking',
      subject: 'No projects registered',
      detail: 'This LaneConductor instance has no projects yet.',
      remedy: 'Run `lc setup` in a project directory to register it.',
    });
  }

  if (!hasOnlineWorker) {
    gaps.push({
      id: 'no-workers',
      severity: 'blocking',
      subject: 'No live worker',
      detail: 'No worker for this project has heartbeat within the staleness window.',
      remedy: 'Run `lc worker start` (or `lc start`) in the project directory.',
    });
  }

  if (!hasManagerWorker) {
    gaps.push({
      id: 'no-manager',
      severity: 'advisory',
      subject: 'No manager worker',
      detail: 'No `type: manager` worker is registered on this machine.',
      remedy: 'Run `lc worker start --manager` to register a manager worker.',
    });
  }

  if (!primaryCliConfigured || !primaryProviderReachable) {
    gaps.push({
      id: 'no-provider',
      severity: 'blocking',
      subject: 'Primary provider unreachable',
      detail: !primaryCliConfigured
        ? '`project.primary.cli` is not configured.'
        : 'The configured primary CLI is not reachable on this machine.',
      remedy: 'Run `lc setup` and choose a primary CLI, then verify it with `<cli> --version`.',
    });
  }

  if (!hasProductMd || !hasTechStackMd) {
    gaps.push({
      id: 'no-conductor-context',
      severity: 'advisory',
      subject: 'Missing conductor context docs',
      detail: 'conductor/product.md or conductor/tech-stack.md is missing or still a template stub.',
      remedy: 'Run `/laneconductor setup scaffold` to generate them.',
    });
  }

  if (createQualityGate && !hasQualityGateMd) {
    gaps.push({
      id: 'no-quality-gate',
      severity: 'advisory',
      subject: 'Quality gate not configured',
      detail: 'create_quality_gate is enabled but conductor/quality-gate.md is missing.',
      remedy: 'Run `/laneconductor setup scaffold` to generate conductor/quality-gate.md.',
    });
  }

  if (trackCount === 0) {
    gaps.push({
      id: 'no-tracks',
      severity: 'advisory',
      subject: 'No tracks yet',
      detail: 'This project has zero tracks.',
      remedy: 'Run `lc new "Title" "Description"` to create the first one.',
    });
  }

  return gaps;
}
