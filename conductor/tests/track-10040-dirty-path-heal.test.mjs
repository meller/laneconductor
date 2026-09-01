// Track 10040 Phase 7 (REQ-7, Finding 1, spec D3): dirty-path healing
// safety boundary. The 10036 exact cause: `ui/node_modules` committed as
// a symlink, then ignored, permanently showing as `D ui/node_modules`.

import { test } from 'node:test';
import assert from 'node:assert';
import { classifyHealableDirtyPath, HEALABLE_BASENAMES } from '../services/dirty-path-heal.mjs';

test('TC-41: ui/node_modules, deleted + git-ignored -> healable, remedy is git rm -r --cached (the exact 10036 cause)', () => {
  const r = classifyHealableDirtyPath({ path: 'ui/node_modules', porcelainStatus: 'D', isGitIgnored: true });
  assert.equal(r.healable, true);
  assert.equal(r.remedy, 'git rm -r --cached ui/node_modules');
});

test('TC-42: same path, NOT git-ignored -> not healable', () => {
  const r = classifyHealableDirtyPath({ path: 'ui/node_modules', porcelainStatus: 'D', isGitIgnored: false });
  assert.equal(r.healable, false);
});

test('TC-43: deleted + ignored but not on the allowlist -> not healable', () => {
  const r = classifyHealableDirtyPath({ path: 'src/index.js', porcelainStatus: 'D', isGitIgnored: true });
  assert.equal(r.healable, false);
});

test('TC-44: modified (M) or untracked (??) status -> never healable, only D qualifies', () => {
  for (const porcelainStatus of ['M', '??', 'A', 'R']) {
    const r = classifyHealableDirtyPath({ path: 'ui/node_modules', porcelainStatus, isGitIgnored: true });
    assert.equal(r.healable, false, `status ${porcelainStatus} must not be healable`);
  }
});

test('TC-45: every allowlist entry, nested, deleted+ignored -> healable', () => {
  for (const basename of HEALABLE_BASENAMES) {
    const r = classifyHealableDirtyPath({ path: `packages/app/${basename}`, porcelainStatus: 'D', isGitIgnored: true });
    assert.equal(r.healable, true, `${basename} must be healable`);
  }
});

test('TC-46: path traversal / absolute paths -> never healable, never a remedy', () => {
  for (const path of ['../../etc/passwd', '/etc/passwd', 'node_modules/../../../etc/passwd']) {
    const r = classifyHealableDirtyPath({ path, porcelainStatus: 'D', isGitIgnored: true });
    assert.equal(r.healable, false, `${path} must never be healable`);
    assert.equal(r.remedy, null);
  }
});

test('TC-47: the emitted remedy is ALWAYS git rm -r --cached, never a filesystem delete or content edit', () => {
  const inputs = [
    { path: 'ui/node_modules', porcelainStatus: 'D', isGitIgnored: true },
    { path: 'dist', porcelainStatus: 'D', isGitIgnored: true },
    { path: 'a/b/.turbo', porcelainStatus: 'D', isGitIgnored: true },
  ];
  for (const input of inputs) {
    const r = classifyHealableDirtyPath(input);
    assert.ok(r.remedy.startsWith('git rm -r --cached '));
    assert.ok(!r.remedy.includes('rm -rf'));
  }
});
