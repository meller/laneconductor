// conductor/services/wizard-track-plan.mjs
// Track AM-1119 Phase 3 (Task 1): pure derivation of the initial track
// breakdown from the App Creator wizard's own structured input. No LLM
// call — the wizard's `scaffold_context.brainstorm_summary` (built by
// AppCreatorWizard.jsx's buildWizardPayload) already has real, structured
// answers from the user (purpose, target users, tech stack, KPIs); turning
// that into a deterministic set of tracks keeps this cheap, testable, and
// grounded in what the user actually said — never fabricated feature
// ideas. Extracted as a pure module (matches services/merge-mode.mjs,
// services/parse-status.mjs, etc.) so it's unit-testable without spinning
// up the sync worker or a real filesystem.

const PROVIDER_LABELS = { firebase: 'Firebase Hosting', gcp: 'GCP Cloud Run' };

function parseBrainstormLines(brainstormSummary) {
  const text = brainstormSummary || '';
  const get = (label) => {
    const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    purpose: get('Project purpose'),
    targetUsers: get('Target users'),
    techStack: get('Tech stack'),
    kpis: get('Success metrics / KPIs'),
  };
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/**
 * Returns an ordered array of { title, problem, solution, dependsOnAll }.
 * Always starts with an "App Skeleton" track and, when a real deployment
 * provider was chosen, always ends with exactly one "Deploy to <provider>"
 * track carrying `dependsOnAll: true` (the caller resolves that into a
 * **Depends On** listing every track ahead of it in this same batch).
 * Length is always in [1, 4] tracks before a deploy track, [1, 5] after —
 * within spec.md/plan.md's target 3-6, given the wizard's Product step
 * requires `purpose` before Launch is reachable (see ProductStep.jsx).
 */
export function deriveTrackPlan({ projectName, brainstormSummary, deploymentProvider }) {
  const { purpose, targetUsers, techStack, kpis } = parseBrainstormLines(brainstormSummary);
  const tracks = [];

  tracks.push({
    title: 'App Skeleton',
    problem: `No running application exists yet for ${projectName}.`,
    solution: `Scaffold the initial ${techStack || 'application'} skeleton — project structure, entry point, and basic routing/layout — implementing: ${purpose || projectName}.`,
  });

  if (purpose) {
    tracks.push({
      title: `Core Feature: ${truncate(purpose, 40)}`,
      problem: 'The app skeleton has no working functionality yet.',
      solution: `Implement the core feature described in the product brief: ${purpose}.${targetUsers ? ` Built for: ${targetUsers}.` : ''}`,
    });
  }

  if (kpis) {
    tracks.push({
      title: `Success Metrics: ${truncate(kpis, 40)}`,
      problem: 'No way to verify the app is meeting its intended goals.',
      solution: `Implement instrumentation/UX supporting the stated success metrics: ${kpis}.`,
    });
  }

  if (deploymentProvider && deploymentProvider !== 'skip') {
    const label = PROVIDER_LABELS[deploymentProvider] || deploymentProvider;
    tracks.push({
      title: `Deploy to ${label}`,
      problem: 'The app has no live deployment.',
      // Track AM-1119 Phase 4 (Task 2): explicit, actionable instruction —
      // not just "record the URL" — so whoever/whatever executes this
      // track (a human, or an AI agent's own implement-phase run) has the
      // concrete endpoint and payload shape, not just an intent. The URL
      // to report is either deploy.json's own `expected_url` for that
      // environment (Firebase — deterministic, see deployConfig.js) or
      // whatever URL `lc deploy` printed (GCP Cloud Run — only knowable
      // from real deploy output).
      solution: `Run \`lc deploy <env>\` using the configured conductor/deploy.json. On success, `
        + `determine the live URL — deploy.json's environments.<env>.expected_url when present, `
        + `otherwise the URL \`lc deploy\` printed in its output — and record it by calling `
        + `\`POST /api/projects/${'{project_id}'}/app-url\` with body \`{"app_url": "<url>"}\` `
        + `against this project's local Collector API (see .laneconductor.json's collectors[0].url).`,
      dependsOnAll: true,
    });
  }

  return tracks;
}
