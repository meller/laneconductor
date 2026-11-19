import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSkill } from '../src/format.mjs';
import { scanText } from '../src/secrets.mjs';
import { parseDenyList, gateSkillDir } from '../src/privacy-gate.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const body = ['Why this works', 'Recommendation', 'Claude does', 'You run', 'Pitfalls'].map((s) => `## ${s}\nx\n`).join('\n');
const fm = (extra = '', desc = 'd') => `---\nname: demo\ndescription: "${desc}"\nmetadata:\n  kind: convention\n  stack: [node]\n  provenance: observed in the author's own projects with LaneConductor\n  verified: 2026-11-18\n${extra}---\n\n${body}`;

test('a well-formed skill passes', () => assert.deepEqual(checkSkill({ folder: 'demo', text: fm() }).errors, []));
test('description over 1,536 characters fails', () => assert.ok(checkSkill({ folder: 'demo', text: fm('', 'x'.repeat(1600)) }).errors.some((e) => e.field === 'description')));
test('sections out of order fail', () => {
  const t = fm().replace('## Recommendation', '## Pitfalls2').replace('## Pitfalls\n', '## Recommendation\n').replace('## Pitfalls2', '## Pitfalls');
  assert.ok(checkSkill({ folder: 'demo', text: t }).errors.some((e) => /must come before/.test(e.message)));
});
test('secret findings never carry the matched text', () => {
  const secret = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const f = scanText(`key = ${secret}`, 'f');
  assert.equal(f.length, 1);
  assert.ok(!JSON.stringify(f).includes(secret));
});
test('deny list: findings name the entry line, not the term', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-'));
  await fs.writeFile(path.join(dir, 'SKILL.md'), 'mentions zebrafish-project here\n');
  const f = await gateSkillDir(dir, parseDenyList('# c\nzebrafish-project\n'));
  assert.equal(f.length, 1);
  assert.ok(!JSON.stringify(f).includes('zebrafish'));
  await fs.rm(dir, { recursive: true });
});
test('a convention with no references passes, with a provenance sentence', () => assert.deepEqual(checkSkill({ folder: 'demo', text: fm() }).errors, []));
test('a convention with neither reference nor provenance fails', () => {
  const t = fm().replace(/  provenance:.*\n/, '');
  assert.ok(checkSkill({ folder: 'demo', text: t }).errors.some((e) => e.field === 'metadata.provenance'));
});
test('a malformed optional reference still fails', () => {
  const t = fm('', 'd').replace('  verified', '  reference:\n    - { repo: o/r, path: a.js, commit: zzz, proves: p }\n  verified');
  assert.ok(checkSkill({ folder: 'demo', text: t }).errors.some((e) => /commit/.test(e.field)));
});
test('gate refuses a local path, a foreign repo URL and a commit-like hash, never printing them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-'));
  const hex = ['1a2b', '3c4d', '5e6f'].join('');
  await fs.writeFile(path.join(dir, 'SKILL.md'), [
    `see ${'/ho' + 'me'}/someone/project for it`,
    `and https://${'git' + 'hub'}.com/someone/else for that`,
    `at commit ${hex} it worked`,
    'but https://github.com/meller/laneconductor is allowed',
  ].join('\n'));
  const f = await gateSkillDir(dir, []);
  assert.deepEqual(f.map((x) => x.kind).sort(), ['commit_hash', 'local_path', 'repo_url']);
  assert.ok(!JSON.stringify(f).includes(hex) && !JSON.stringify(f).includes('someone'));
  await fs.rm(dir, { recursive: true });
});
