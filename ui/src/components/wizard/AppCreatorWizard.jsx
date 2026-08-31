import React, { useState } from 'react';
import { BasicsStep, basicsStepValid } from './BasicsStep.jsx';
import { ProductStep, productStepValid } from './ProductStep.jsx';
import { DesignStackStep, designStackStepValid } from './DesignStackStep.jsx';
import { DeploymentStep, deploymentStepValid } from './DeploymentStep.jsx';
import { ReviewLaunchStep } from './ReviewLaunchStep.jsx';

// Track AM-1119 Phase 1: five-step App Creator wizard (spec.md REQ-1).
// Each step is a standalone component sharing one wizardState object; Back
// preserves everything already entered. Validation gates Next per-step
// (Basics/Product required, Design/Stack + Deployment's env choice only
// required when a provider is picked, Review has nothing to validate).
//
// Track AM-1121: the step list now depends on basics.kind. 'app' (the
// default, and the only kind that existed before this track) keeps all
// five steps unchanged. 'marketing' drops Design & Stack and Deployment —
// both ask about code/hosting, which a project with no code doesn't have
// (found live 2026-08-30 running an actual book-marketing project through
// this wizard: it asked for a "visual style" and a deploy provider).
function stepsForKind(kind) {
  const basics = { label: 'Basics', Component: BasicsStep, validate: s => basicsStepValid(s.basics) };
  const product = { label: 'Product', Component: ProductStep, validate: s => productStepValid(s.product) };
  const review = { label: 'Review & Launch', Component: ReviewLaunchStep, validate: () => true };
  if (kind === 'marketing') return [basics, product, review];
  return [
    basics,
    product,
    { label: 'Design & Stack', Component: DesignStackStep, validate: s => designStackStepValid(s.designStack) },
    { label: 'Deployment', Component: DeploymentStep, validate: s => deploymentStepValid(s.deployment) },
    review,
  ];
}

export function defaultWizardState(managerWorkers) {
  return {
    basics: { name: '', repoType: 'path', repoValue: '', hasExistingCode: true, kind: 'app', workerId: managerWorkers[0]?.id ?? null },
    product: { purpose: '', targetUsers: '', kpis: '' },
    designStack: { designPrompt: '', stackPreset: '', techStack: '' },
    deployment: { provider: 'skip', environments: [] },
  };
}

export function buildWizardPayload(wizardState) {
  const { basics, product, designStack, deployment } = wizardState;
  const isMarketing = basics.kind === 'marketing';
  const parts = [`Project purpose: ${product.purpose.trim()}`];
  if (product.targetUsers.trim()) parts.push(`Target users: ${product.targetUsers.trim()}`);
  if (!isMarketing && designStack.techStack.trim()) parts.push(`Tech stack: ${designStack.techStack.trim()}`);
  if (product.kpis.trim()) parts.push(`Success metrics / KPIs: ${product.kpis.trim()}`);

  return {
    repo_source: { type: basics.repoType, value: basics.repoValue.trim() },
    scaffold_context: {
      project: { name: basics.name.trim(), has_existing_code: basics.hasExistingCode, kind: basics.kind },
      brainstorm_summary: parts.join('\n'),
    },
    wizard: {
      product: { target_users: product.targetUsers.trim() || null },
      design: isMarketing ? null : {
        prompt: designStack.designPrompt.trim() || null,
        tech_stack: designStack.techStack.trim() || null,
      },
      deployment: isMarketing ? { provider: 'skip', environments: [] } : {
        provider: deployment.provider,
        environments: deployment.provider === 'skip' ? [] : deployment.environments,
      },
    },
  };
}

export function AppCreatorWizard({ managerWorkers, onLaunch, onCancel, nameInputRef }) {
  const [step, setStep] = useState(0);
  const [wizardState, setWizardState] = useState(() => defaultWizardState(managerWorkers));

  const steps = stepsForKind(wizardState.basics.kind);
  // Switching kind on Basics (step 0) can only ever shrink the list while
  // already sitting on step 0, so this never actually clamps past a step
  // the user has reached — it's a defensive floor, not a real transition.
  const clampedStep = Math.min(step, steps.length - 1);
  const canAdvance = steps[clampedStep].validate(wizardState);
  const isLastStep = clampedStep === steps.length - 1;
  const StepComponent = steps[clampedStep].Component;

  function patch(key, value) {
    setWizardState(prev => ({ ...prev, [key]: value }));
  }

  function handleNext() {
    if (!canAdvance) return;
    if (isLastStep) {
      onLaunch(buildWizardPayload(wizardState), wizardState.basics.workerId);
    } else {
      setStep(clampedStep + 1);
    }
  }

  const stepProps = {
    Basics: { value: wizardState.basics, onChange: v => patch('basics', v), managerWorkers, nameInputRef },
    Product: { value: wizardState.product, onChange: v => patch('product', v) },
    'Design & Stack': { value: wizardState.designStack, onChange: v => patch('designStack', v) },
    Deployment: { value: wizardState.deployment, onChange: v => patch('deployment', v), workerId: wizardState.basics.workerId },
    'Review & Launch': { wizardState },
  }[steps[clampedStep].label];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 px-0.5" data-testid="wizard-stepper">
        {steps.map(({ label }, i) => (
          <React.Fragment key={label}>
            <div
              className={`flex items-center gap-1 text-[11px] ${i === clampedStep ? 'text-blue-300 font-semibold' : i < clampedStep ? 'text-gray-400' : 'text-gray-600'}`}
              data-testid={`wizard-step-indicator-${i}`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${i === clampedStep ? 'bg-blue-800' : i < clampedStep ? 'bg-gray-700' : 'bg-gray-800'}`}>
                {i < clampedStep ? '✓' : i + 1}
              </span>
              {label}
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-800" />}
          </React.Fragment>
        ))}
      </div>

      <div className="min-h-[180px]">
        <StepComponent {...stepProps} />
      </div>

      <div className="flex justify-between pt-1">
        <button
          type="button"
          onClick={() => (clampedStep === 0 ? onCancel() : setStep(clampedStep - 1))}
          className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {clampedStep === 0 ? 'Cancel' : 'Back'}
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canAdvance}
          data-testid="wizard-next-button"
          className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          {isLastStep ? 'Launch' : 'Next'}
        </button>
      </div>
    </div>
  );
}
