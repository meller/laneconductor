import React from 'react';

// Track AM-1119 Phase 1: Step 5 — final review before dispatch. Purely a
// read-only summary; Launch reuses the same dispatch flow as the legacy
// form (App Creator Wizard Mode spec.md REQ-1: no new gate beyond this).
export function ReviewLaunchStep({ wizardState }) {
  const { basics, product, designStack, deployment } = wizardState;

  return (
    <div className="space-y-3 text-sm text-gray-300">
      <ReviewRow label="Name" value={basics.name} />
      <ReviewRow label="Repo" value={`${basics.repoType === 'path' ? 'Local path' : 'Git URL'}: ${basics.repoValue}`} />
      <ReviewRow label="Purpose" value={product.purpose} />
      {product.targetUsers && <ReviewRow label="Target users" value={product.targetUsers} />}
      {product.kpis && <ReviewRow label="KPIs" value={product.kpis} />}
      {designStack.designPrompt && <ReviewRow label="Style" value={designStack.designPrompt} />}
      {designStack.techStack && <ReviewRow label="Stack" value={designStack.techStack} />}
      <ReviewRow
        label="Deployment"
        value={deployment.provider === 'skip' ? 'Skipped — configure later' : `${deployment.provider} (${deployment.environments.join(', ') || 'no environments selected'})`}
      />
      <p className="text-xs text-gray-500 pt-1">
        Launching will scaffold the project, generate tracks for the work above, and run them
        automatically. You can follow progress after launch.
      </p>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-200 whitespace-pre-wrap">{value}</span>
    </div>
  );
}
