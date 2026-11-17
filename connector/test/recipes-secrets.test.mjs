// Phase 2 (TC-2.9, TC-2.10): the secret scanner reports file and line only, never the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeAwsKey, fakeDbUrl, fakeGithubToken, fakeGoogleKey, fakePemHeader, fakeSkKey } from './helpers/recipes.mjs';
import { scanFiles, scanText } from '../src/recipes/secrets.mjs';

const POSITIVES = {
  google_api_key: () => `GOOGLE=${fakeGoogleKey()}`,
  private_key_block: () => fakePemHeader(),
  private_key_json: () => '{"private_key": "x"}',
  github_token: () => `token ${fakeGithubToken()}`,
  sk_key: () => `OPENAI=${fakeSkKey()}`,
  aws_key_id: () => `id=${fakeAwsKey()}`,
  db_url_with_password: () => `DATABASE_URL=${fakeDbUrl()}`,
};

test('TC-2.9: every REQ-12 pattern is detected with file and line, and the output never contains the matched text', () => {
  for (const [id, make] of Object.entries(POSITIVES)) {
    const secret = make();
    const hits = scanText(`line one\nline two\n${secret}\n`, 'recipes/x/SKILL.md');
    assert.deepEqual(hits, [{ file: 'recipes/x/SKILL.md', line: 3, pattern: id }], id);
    const out = JSON.stringify(hits);
    for (const piece of secret.split(/[=\s]/).filter((p) => p.length > 12)) assert.ok(!out.includes(piece), `${id} leaked`);
  }
  assert.equal(scanText(`github_pat_${'x1'.repeat(15)}`, 'f')[0].pattern, 'github_token');
});

test('TC-2.10: negatives are not flagged', () => {
  const clean = [
    'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/x',
    'DATABASE_URL=postgres://u:p@127.0.0.1/db',
    'DATABASE_URL=',
    'GCP_PROJECT=laneconductor-site',
    'a task-management-and-reporting-dashboard-site',
    'AIzaShort',
  ];
  assert.deepEqual(scanText(clean.join('\n'), 'f'), []);
});

test('scanFiles takes a map or an object and keeps each file name', () => {
  const hits = scanFiles(new Map([['a', 'ok'], ['b', `x\n${fakeSkKey()}`]]));
  assert.deepEqual(hits, [{ file: 'b', line: 2, pattern: 'sk_key' }]);
  assert.deepEqual(scanFiles({ c: fakeAwsKey() }), [{ file: 'c', line: 1, pattern: 'aws_key_id' }]);
});
