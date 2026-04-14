
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

async function syncProjectContext() {
  const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
  const jira = config.collectors.find(c => c.type === 'jira');
  if (!jira) return;

  const token = execSync(`gcloud secrets versions access latest --secret="${jira.token_secret_name}"`, { encoding: 'utf8' }).trim();
  const auth = Buffer.from(`${jira.email}:${token}`).toString('base64');
  const domain = jira.domain;
  const projectKey = jira.project_key;

  const product = existsSync('conductor/product.md') ? readFileSync('conductor/product.md', 'utf8') : '';
  const techStack = existsSync('conductor/tech-stack.md') ? readFileSync('conductor/tech-stack.md', 'utf8') : '';
  const guidelines = existsSync('conductor/product-guidelines.md') ? readFileSync('conductor/product-guidelines.md', 'utf8') : '';

  const summary = "[WIKI] Project & Product Context";
  const adf = {
    version: 1,
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Project Wiki' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Product Definition' }] },
      { type: 'codeBlock', attrs: { language: 'markdown' }, content: [{ type: 'text', text: product || 'No product.md found.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Technical Stack' }] },
      { type: 'codeBlock', attrs: { language: 'markdown' }, content: [{ type: 'text', text: techStack || 'No tech-stack.md found.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Product Guidelines' }] },
      { type: 'codeBlock', attrs: { language: 'markdown' }, content: [{ type: 'text', text: guidelines || 'No product-guidelines.md found.' }] },
    ]
  };

  const searchUrl = `https://${domain}/rest/api/3/search?jql=project="${projectKey}" AND summary ~ "[WIKI]"`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Basic ${auth}` } });
  const searchData = await searchRes.json();
  const existingIssue = searchData.issues?.find(i => i.fields.summary.includes('[WIKI]'));

  if (existingIssue) {
    console.log(`Updating existing Wiki issue: ${existingIssue.key}`);
    const updateUrl = `https://${domain}/rest/api/3/issue/${existingIssue.key}`;
    await fetch(updateUrl, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { description: adf } })
    });
  } else {
    console.log(`Creating new Wiki issue...`);
    const createUrl = `https://${domain}/rest/api/3/issue`;
    await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          description: adf,
          issuetype: { name: 'Task' },
          labels: ['laneconductor-wiki']
        }
      })
    });
  }
}

syncProjectContext().catch(console.error);
