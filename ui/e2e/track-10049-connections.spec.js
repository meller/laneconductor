// ui/e2e/track-10049-connections.spec.js
// Track TU-10049 Phase 6 (TC-38, TC-39): real-browser coverage for the
// Connections step — a disabled FFU alternative genuinely cannot be
// selected via real mouse interaction (not just via fireEvent in jsdom),
// and a full walk-through with a Jira connection dispatches the exact
// wizard.connections payload shape. Mirrors app-creator-wizard.spec.js's
// API-mocking approach (page.route, no live Collector/Postgres needed).

import { test, expect } from '@playwright/test';

const NEW_PROJECT_PATH = '/home/you/Code/digger-game';
const MANAGER_WORKER = { id: 1, hostname: 'test-machine', type: 'manager', project_id: null, status: 'idle', last_heartbeat: new Date().toISOString() };

function mockBaseRoutes(page, { onDispatch } = {}) {
  return page.route('**/api/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname === '/api/projects' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/tracks' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/tracks/waiting' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/workers' && method === 'GET') return route.fulfill({ json: [MANAGER_WORKER] });

    if (pathname.match(/^\/api\/workers\/\d+\/credentials$/) && method === 'GET') {
      const provider = searchParams.get('provider');
      if (provider === 'jira') {
        return route.fulfill({ json: { provider: 'jira', status: 'verified', detail: `${searchParams.get('project_key')} @ ${searchParams.get('domain')}` } });
      }
      return route.fulfill({ json: { provider, status: 'NOT CONFIGURED', detail: null } });
    }

    if (pathname === '/api/dispatch/create-project' && method === 'POST') {
      const body = route.request().postDataJSON();
      if (onDispatch) onDispatch(body);
      return route.fulfill({ json: { ok: true, id: 555 } });
    }
    if (pathname === '/api/dispatch/555' && method === 'GET') {
      return route.fulfill({ json: { id: 555, status: 'pending', result: null } });
    }

    return route.fulfill({ json: [] });
  });
}

async function walkToConnections(page) {
  await page.goto('/');
  await page.getByTitle('New Project').click();
  await page.getByText('Guided wizard').click();

  await page.getByPlaceholder('e.g. Digger Game').fill('Digger Game');
  await page.getByPlaceholder('/home/you/Code/digger-game').fill(NEW_PROJECT_PATH);
  await page.getByTestId('wizard-next-button').click();

  await page.getByPlaceholder(/2D digging\/mining game/).fill('Dig for ore, avoid hazards');
  await page.getByTestId('wizard-next-button').click();

  await page.getByTestId('wizard-next-button').click(); // Design & Stack — skip

  await expect(page.getByTestId('connections-source_control')).toBeVisible();
}

test('TC-39: a disabled FFU alternative cannot be selected by a real click', async ({ page }) => {
  await mockBaseRoutes(page);
  await walkToConnections(page);

  const gitlab = page.getByTestId('connections-alt-source_control-gitlab');
  await expect(gitlab).toBeDisabled();

  // Playwright refuses to click a genuinely disabled element outside
  // { force: true } — attempting the click at all is the real assertion
  // here; if the element were ever NOT disabled, this click would succeed
  // and the test below would catch the unintended selection.
  await gitlab.click({ force: true, timeout: 2000 }).catch(() => {});
  await expect(gitlab).not.toBeChecked();

  // Skip is still the active selection for that category.
  const skipRadio = page.getByTestId('connections-source_control').locator('input').first();
  await expect(skipRadio).toBeChecked();
});

test('TC-38: full walk-through with GitHub + Jira + GCP connections dispatches wizard.connections', async ({ page }) => {
  let dispatched = null;
  await mockBaseRoutes(page, { onDispatch: body => { dispatched = body; } });
  await walkToConnections(page);

  // Source control: GitHub
  await page.getByTestId('connections-real-source_control').click();
  await expect(page.getByTestId('connections-category-source_control').getByTestId('connections-credential-status')).toContainText(/NOT CONFIGURED/);

  // Issue tracker: Jira
  await page.getByTestId('connections-real-issue_tracker').click();
  await page.getByTestId('connections-jira-domain').fill('acme.atlassian.net');
  await page.getByTestId('connections-jira-email').fill('me@acme.com');
  await page.getByTestId('connections-jira-project-key').fill('ACME');
  await expect(page.getByTestId('connections-category-issue_tracker').getByTestId('connections-credential-status')).toContainText(/verified/, { timeout: 5000 });

  // Cloud: GCP
  await page.getByTestId('connections-real-cloud').click();
  await page.getByTestId('connections-gcp-project-id').fill('acme-prod');

  await page.getByTestId('wizard-next-button').click(); // Connections → Deployment
  await page.getByTestId('wizard-next-button').click(); // Deployment (skip) → Review
  await expect(page.getByText(/Dig for ore, avoid hazards/)).toBeVisible();
  await page.getByTestId('wizard-next-button').click(); // Review → Launch

  await expect.poll(() => dispatched !== null, { timeout: 5000 }).toBe(true);
  expect(dispatched.payload.wizard.connections).toEqual({
    source_control: { provider: 'github' },
    issue_tracker: {
      provider: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: 'JIRA_API_TOKEN',
    },
    cloud: { provider: 'gcp', project_id: 'acme-prod', service_account: null },
  });

  // REQ-3/AC-6 — no credential value anywhere in the dispatched payload.
  expect(JSON.stringify(dispatched)).not.toMatch(/"token":/);
});
