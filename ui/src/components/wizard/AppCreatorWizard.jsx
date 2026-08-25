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
const STEPS = ['Basics', 'Product', 'Design & Stack', 'Deployment', 'Review & Launch'];

export function defaultWizardState(managerWorkers) {
  return {
    basics: { name: '', repoType: 'path', repoValue: '', hasExistingCode: true, workerId: managerWorkers[0]?.id ?? null },
    product: { purpose: '', targetUsers: '', kpis: '' },
    designStack: { designPrompt: '', stackPreset: '', techStack: '' },
    deployment: { provider: 'skip', environments: [] },
  };
}

const STEP_VALIDATORS = [
  s => basicsStepValid(s.basics),
  s => productStepValid(s.product),
  s => designStackStepValid(s.designStack),
  s => deploymentStepValid(s.deployment),
  () => true,
];

export function buildWizardPayload(wizardState) {
  const { basics, product, designStack, deployment } = wizardState;
  const parts = [`Project purpose: ${product.purpose.trim()}`];
  if (product.targetUsers.trim()) parts.push(`Target users: ${product.targetUsers.trim()}`);
  if (designStack.techStack.trim()) parts.push(`Tech stack: ${designStack.techStack.trim()}`);
  if (product.kpis.trim()) parts.push(`Success metrics / KPIs: ${product.kpis.trim()}`);

  return {
    repo_source: { type: basics.repoType, value: basics.repoValue.trim() },
    scaffold_context: {
      project: { name: basics.name.trim(), has_existing_code: basics.hasExistingCode },
      brainstorm_summary: parts.join('\n'),
    },
    wizard: {
      product: { target_users: product.targetUsers.trim() || null },
      design: {
        prompt: designStack.designPrompt.trim() || null,
        tech_stack: designStack.techStack.trim() || null,
      },
      deployment: {
        provider: deployment.provider,
        environments: deployment.provider === 'skip' ? [] : deployment.environments,
      },
    },
  };
}

export function AppCreatorWizard({ managerWorkers, onLaunch, onCancel, nameInputRef }) {
  const [step, setStep] = useState(0);
  const [wizardState, setWizardState] = useState(() => defaultWizardState(managerWorkers));

  const canAdvance = STEP_VALIDATORS[step](wizardState);
  const isLastStep = step === STEPS.length - 1;

  function patch(key, value) {
    setWizardState(prev => ({ ...prev, [key]: value }));
  }

  function handleNext() {
    if (!canAdvance) return;
    if (isLastStep) {
      onLaunch(buildWizardPayload(wizardState), wizardState.basics.workerId);
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 px-0.5" data-testid="wizard-stepper">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div
              className={`flex items-center gap-1 text-[11px] ${i === step ? 'text-blue-300 font-semibold' : i < step ? 'text-gray-400' : 'text-gray-600'}`}
              data-testid={`wizard-step-indicator-${i}`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${i === step ? 'bg-blue-800' : i < step ? 'bg-gray-700' : 'bg-gray-800'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-800" />}
          </React.Fragment>
        ))}
      </div>

      <div className="min-h-[180px]">
        {step === 0 && <BasicsStep value={wizardState.basics} onChange={v => patch('basics', v)} managerWorkers={managerWorkers} nameInputRef={nameInputRef} />}
        {step === 1 && <ProductStep value={wizardState.product} onChange={v => patch('product', v)} />}
        {step === 2 && <DesignStackStep value={wizardState.designStack} onChange={v => patch('designStack', v)} />}
        {step === 3 && <DeploymentStep value={wizardState.deployment} onChange={v => patch('deployment', v)} />}
        {step === 4 && <ReviewLaunchStep wizardState={wizardState} />}
      </div>

      <div className="flex justify-between pt-1">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep(s => s - 1))}
          className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {step === 0 ? 'Cancel' : 'Back'}
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
