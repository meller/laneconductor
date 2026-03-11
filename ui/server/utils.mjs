// Utility functions for LaneConductor server

/**
 * Append a regression test block to existing test.md content.
 * Pure function — no I/O.
 * @param {string} testContent  Existing test.md content (may be empty)
 * @param {string} description  Human-readable bug description
 * @param {string} trackNum     Track number (e.g. '1045')
 * @returns {string}            Updated test.md content
 */
export function appendRegressionTest(testContent, description, trackNum) {
  const bugCount = (testContent.match(/TC-BUG-/g) ?? []).length;
  const n = bugCount + 1;
  const date = new Date().toISOString().slice(0, 10);
  const block = [
    '',
    `### Regression: ${description} (${date})`,
    `- [ ] TC-BUG-${n}: Verify "${description}" does not recur — expected: correct behavior without the bug`,
    '',
  ].join('\n');

  if (!testContent.includes('## Test Cases')) {
    return `${testContent}\n## Test Cases\n${block}`;
  }
  return testContent + block;
}

export function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function trackTemplates(trackNumber, title, description, type = 'feature') {
    if (type === 'bug') {
        const index = `# Track ${trackNumber}: ${title}\n\n**Status**: backlog\n**Progress**: 0%\n\n## Problem\n${description || 'To be defined.'}\n\n## Solution\nInvestigate root cause, fix, and add regression test.\n\n## Phases\n- [ ] Phase 1: Investigate and fix\n`;
        const plan = `# Track ${trackNumber}: ${title}\n\n## Phase 1: Investigate and Fix\n\n**Problem**: ${description || 'To be defined.'}\n**Solution**: Identify root cause, implement fix, verify with regression test.\n\n- [ ] Reproduce the bug\n- [ ] Investigate root cause\n- [ ] Implement fix\n- [ ] Verify fix works\n- [ ] Add regression test\n`;
        const spec = `# Spec: ${title}\n\n## Problem Statement\n${description || 'To be defined.'}\n\n## Steps to Reproduce\n1. \n2. \n\n## Expected Behaviour\n\n## Actual Behaviour\n\n## Acceptance Criteria\n- [ ] Bug no longer reproducible\n- [ ] Regression test added\n`;
        return { index, plan, spec };
    }
    // feature (default)
    const index = `# Track ${trackNumber}: ${title}\n\n**Status**: backlog\n**Progress**: 0%\n\n## Problem\n${description || 'To be defined.'}\n\n## Solution\nTo be defined.\n\n## Phases\n- [ ] Phase 1: Implementation\n`;
    const plan = `# Track ${trackNumber}: ${title}\n\n## Phase 1: Implementation\n\n**Problem**: ${description || 'To be defined.'}\n**Solution**: To be defined.\n\n- [ ] Task 1: Define requirements\n- [ ] Task 2: Implement\n- [ ] Task 3: Test\n`;
    const spec = `# Spec: ${title}\n\n## Problem Statement\n${description || 'To be defined.'}\n\n## Requirements\n- REQ-1: ...\n\n## Acceptance Criteria\n- [ ] Criterion 1\n`;
    return { index, plan, spec };
}
