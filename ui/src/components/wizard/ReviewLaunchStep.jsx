import React from 'react';

// Track AM-1119 Phase 1: Step 5 — final review before dispatch. Purely a
// read-only summary; Launch reuses the same dispatch flow as the legacy
// form (App Creator Wizard Mode spec.md REQ-1: no new gate beyond this).
export function ReviewLaunchStep({ wizardState }) {
  const { basics, product, designStack, connections, deployment } = wizardState;
  const isMarketing = basics.kind === 'marketing';

  return (
    <div className="space-y-3 text-sm text-gray-300">
      <ReviewRow label="Name" value={basics.name} />
      <ReviewRow label="Type" value={isMarketing ? 'Marketing / growth (no code)' : 'Software app'} />
      <ReviewRow label="Repo" value={`${basics.repoType === 'path' ? 'Local path' : 'Git URL'}: ${basics.repoValue}`} />
      <ReviewRow label="Purpose" value={product.purpose} />
      {product.targetUsers && <ReviewRow label="Target users" value={product.targetUsers} />}
      {product.kpis && <ReviewRow label="KPIs" value={product.kpis} />}
      {!isMarketing && designStack.designPrompt && <ReviewRow label="Style" value={designStack.designPrompt} />}
      {!isMarketing && designStack.techStack && <ReviewRow label="Stack" value={designStack.techStack} />}
      {!isMarketing && <ReviewRow label="Source control" value={connectionSummary(connections.sourceControl, 'GitHub')} />}
      <ReviewRow label="Issue tracker" value={connectionSummary(connections.issueTracker, 'Jira', v => `Jira — ${v.projectKey || '(no project key)'} @ ${v.domain || '(no domain)'}`)} />
      {!isMarketing && <ReviewRow label="Cloud" value={connectionSummary(connections.cloud, 'GCP', v => `GCP — ${v.projectId || '(no project id)'}`)} />}
      {!isMarketing && (
        <ReviewRow
          label="Deployment"
          value={deployment.provider === 'skip' ? 'Skipped — configure later' : `${deployment.provider} (${deployment.environments.join(', ') || 'no environments selected'})`}
        />
      )}
      <p className="text-xs text-gray-500 pt-1">
        {isMarketing
          ? 'Launching will scaffold the project and generate tracks from the marketing skills for the work above, then run them automatically. You can follow progress after launch.'
          : 'Launching will scaffold the project, generate tracks for the work above, and run them automatically. You can follow progress after launch.'}
      </p>
    </div>
  );
}

// Track TU-10049 Phase 4 (Task 4.4): summarizes a Connections category
// choice for the review step. `skip` (the default) reads the same way the
// existing Deployment row already treats its own "skip" default.
function connectionSummary(categoryValue, realLabel, describeReal) {
  if (categoryValue.provider === 'skip') return 'Skipped — configure later';
  return describeReal ? describeReal(categoryValue) : realLabel;
}

function ReviewRow({ label, value }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-200 whitespace-pre-wrap">{value}</span>
    </div>
  );
}
