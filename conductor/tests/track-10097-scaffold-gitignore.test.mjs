// Track AM-10097: the scaffold gitignore pattern list used to be three
// unlinked copies (this repo's own .gitignore, a hardcoded list in
// bin/lc.mjs, a prose fence in SKILL.md) that drifted for months —
// .conv-cursor and .worktrees/ were added to this repo's .gitignore by hand
// but never reached either scaffold consumer. conductor/services/
// scaffold-gitignore.mjs is now the single source; these tests pin its
// idempotent-append behaviour (Phase 1) and guard against the two consumers
// drifting from it again (Phase 3's SKILL.md set-equality check).

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureScaffoldGitignore,
  SECRET_PATTERNS,
  RUNTIME_STATE_PATTERNS,
} from '../services/scaffold-gitignore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ALL_PATTERNS = [...SECRET_PATTERNS, ...RUNTIME_STATE_PATTERNS].map(p => p.pattern);

const fsImpl = { existsSync, readFileSync, writeFileSync, appendFileSync };

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-scaffold-gitignore-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Phase 1: ensureScaffoldGitignore unit tests ─────────────────────────────

test('TC-1: no existing .gitignore — creates the file with every pattern', () => {
  withTmpDir(dir => {
    const result = ensureScaffoldGitignore(dir, fsImpl);
    assert.equal(result.created, true);
    assert.deepEqual(result.added.sort(), [...ALL_PATTERNS].sort());

    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    for (const pattern of ALL_PATTERNS) {
      assert.ok(content.includes(pattern), `expected .gitignore to contain "${pattern}"`);
    }
  });
});

test('TC-2: running twice on the same directory is a no-op the second time', () => {
  withTmpDir(dir => {
    ensureScaffoldGitignore(dir, fsImpl);
    const afterFirst = readFileSync(join(dir, '.gitignore'), 'utf8');

    const second = ensureScaffoldGitignore(dir, fsImpl);
    assert.equal(second.created, false);
    assert.deepEqual(second.added, []);

    const afterSecond = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.equal(afterSecond, afterFirst, '.gitignore must be byte-identical after a no-op re-run');
  });
});

test('TC-3: pre-seeded with only two patterns — appends exactly the missing ones, untouched otherwise', () => {
  withTmpDir(dir => {
    writeFileSync(join(dir, '.gitignore'), '.env\nconductor/tracks/**/conversation.md\n');
    const result = ensureScaffoldGitignore(dir, fsImpl);

    assert.equal(result.created, false);
    assert.equal(result.added.length, ALL_PATTERNS.length - 2);
    assert.ok(!result.added.includes('.env'));
    assert.ok(!result.added.includes('conductor/tracks/**/conversation.md'));

    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    // Original two lines survive exactly once, not duplicated.
    assert.equal((content.match(/^\.env$/gm) || []).length, 1);
    assert.equal((content.match(/^conductor\/tracks\/\*\*\/conversation\.md$/gm) || []).length, 1);
  });
});

test('TC-4: an already path-scoped spelling satisfies the bare pattern — no duplicate appended', () => {
  withTmpDir(dir => {
    // Exactly the shape macrodash's own .gitignore had for these two.
    writeFileSync(
      join(dir, '.gitignore'),
      'conductor/tracks/**/.prespawn-block-count\nconductor/tracks/**/.conv-cursor\n'
    );
    const result = ensureScaffoldGitignore(dir, fsImpl);

    assert.ok(!result.added.includes('.prespawn-block-count'), 'path-scoped .prespawn-block-count should satisfy the bare pattern');
    assert.ok(!result.added.includes('.conv-cursor'), 'path-scoped .conv-cursor should satisfy the bare pattern');

    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.equal((content.match(/\.prespawn-block-count$/gm) || []).length, 1);
    assert.equal((content.match(/\.conv-cursor$/gm) || []).length, 1);
  });
});

test('TC-5: a commented-out pattern is not active — the real pattern still gets appended', () => {
  withTmpDir(dir => {
    writeFileSync(join(dir, '.gitignore'), '# .worktrees/\n');
    const result = ensureScaffoldGitignore(dir, fsImpl);

    assert.ok(result.added.includes('.worktrees/'), 'a commented-out line must not count as coverage');

    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('# .worktrees/'), 'the original comment line must survive untouched');
    assert.ok(/(^|\n)\.worktrees\/(\n|$)/.test(content), 'the real, active pattern must also be present');
  });
});

test('TC-6: a leading-slash spelling satisfies the pattern', () => {
  withTmpDir(dir => {
    writeFileSync(join(dir, '.gitignore'), '/conductor/.runs/\n');
    const result = ensureScaffoldGitignore(dir, fsImpl);
    assert.ok(!result.added.includes('conductor/.runs/'), 'leading-slash spelling should satisfy the pattern');
  });
});

test('TC-7: every pattern carries a non-empty "why" — guards against a silent reasoning drop', () => {
  for (const { pattern, why } of [...SECRET_PATTERNS, ...RUNTIME_STATE_PATTERNS]) {
    assert.ok(typeof why === 'string' && why.trim().length > 0, `pattern "${pattern}" is missing its "why"`);
  }
});

test('a .gitignore with no trailing newline is not glued onto', () => {
  withTmpDir(dir => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/'); // no trailing \n
    ensureScaffoldGitignore(dir, fsImpl);
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.ok(content.startsWith('node_modules/\n'), 'existing content must not be glued to the first appended line');
  });
});

// ── Phase 3 (REQ-4): SKILL.md's prose fence must not drift from the shared list ──

test('SKILL.md\'s scaffold gitignore fence lists exactly the RUNTIME_STATE_PATTERNS set', () => {
  const skillPath = join(REPO_ROOT, '.claude', 'skills', 'laneconductor', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');

  const marker = "Ensure `.gitignore` covers the sync-only runtime files";
  const markerIdx = skill.indexOf(marker);
  assert.ok(markerIdx !== -1, 'expected to find the scaffold gitignore bullet in SKILL.md — did it get renamed/moved?');

  const afterMarker = skill.slice(markerIdx);
  const fenceMatch = afterMarker.match(/```\n([\s\S]*?)```/);
  assert.ok(fenceMatch, 'expected a fenced code block listing the gitignore patterns right after the marker');

  const listed = fenceMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
  const expected = RUNTIME_STATE_PATTERNS.map(p => p.pattern);

  assert.deepEqual(
    [...listed].sort(),
    [...expected].sort(),
    'SKILL.md\'s fenced pattern list has drifted from RUNTIME_STATE_PATTERNS — the next new pattern must be added to both'
  );
});

test('SKILL.md explicitly carves out conductor/tracks/**/index.md — it must not be scaffolded as ignored', () => {
  const skillPath = join(REPO_ROOT, '.claude', 'skills', 'laneconductor', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  assert.ok(
    skill.includes('Do **not** add') && skill.includes('index.md'),
    'SKILL.md must still explain why index.md is deliberately excluded from the runtime-state gitignore list'
  );
});
