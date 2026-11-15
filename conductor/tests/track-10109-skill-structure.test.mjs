// Track AM-10109: structure guard for the restructured laneconductor skill.
//
// SKILL.md used to be one 2,392-line / 129,829-byte file. It is now a routing
// index plus per-lane files (lanes/), track operations (ops/), setup/, deploy/
// and parked legacy material (legacy/). This test freezes what must survive:
// the frontmatter contract, the routing table, each lane's marker writes
// (conductor/tests/fixtures/track-10109-invariants.json), self-containment of
// the lane files, and the size budget.
//
// Pure-file test: it spawns nothing and touches no database. Run with
//   env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10109-skill-structure.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SLASH_COMMANDS } from '../services/slash-commands.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_DIR = join(REPO_ROOT, '.claude', 'skills', 'laneconductor');
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');
const FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, 'conductor', 'tests', 'fixtures', 'track-10109-invariants.json'), 'utf8'));
const BASELINE_BYTES = FIXTURE.baseline_bytes;

const LANE_FILES = {
  plan: 'lanes/plan.md',
  brainstorm: 'lanes/brainstorm.md',
  implement: 'lanes/implement.md',
  review: 'lanes/review.md',
  'quality-gate': 'lanes/quality-gate.md',
  merge: 'lanes/merge.md',
};

const read = (rel) => readFileSync(join(SKILL_DIR, rel), 'utf8');
const bytes = (rel) => Buffer.byteLength(read(rel), 'utf8');

function baselineSkill() {
  try {
    return execFileSync('git', ['show', `${FIXTURE.baseline_commit}:${FIXTURE.baseline_path}`], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // shallow clone / commit not available
  }
}

// ── minimal strict frontmatter parser (flat `key: value` lines only) ────────
function parseFrontmatter(text) {
  const lines = text.split('\n');
  assert.equal(lines[0], '---', 'SKILL.md must start with a --- line');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 0, 'frontmatter must be closed by a second --- line');
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    assert.ok(m, `frontmatter line is not a flat "key: value" pair: ${line.slice(0, 80)}`);
    let [, key, value] = m;
    assert.ok(!(key in fm), `duplicate frontmatter key ${key}`);
    if (value.startsWith('"')) {
      assert.ok(/^"([^"\\]|\\.)*"$/.test(value), `unterminated or malformed double-quoted value for ${key}`);
      value = JSON.parse(value);
    } else if (value.startsWith("'")) {
      assert.ok(/^'([^']|'')*'$/.test(value), `malformed single-quoted value for ${key}`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      assert.ok(!/^[\[{*&!|>%@`#]/.test(value), `plain scalar for ${key} starts with a YAML indicator`);
      assert.ok(!value.includes(': '), `plain scalar for ${key} contains ": " (invalid YAML)`);
      assert.ok(!value.includes(' #'), `plain scalar for ${key} contains " #" (starts a YAML comment)`);
    }
    fm[key] = value;
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

const DOCUMENTED_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent',
  'background', 'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility',
]);

// ── routing-table helpers ────────────────────────────────────────────────────
function routingRows(skillText) {
  // A routing row is a markdown table row whose first cell has backticked aliases.
  const rows = [];
  for (const line of skillText.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const aliases = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const links = [...line.matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]);
    if (aliases.length) rows.push({ aliases, links, line });
  }
  return rows;
}
const rowFor = (rows, name) => rows.find((r) => r.aliases.includes(name));

function listMd(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listMd(p, base));
    else if (e.name.endsWith('.md')) out.push(p.slice(base.length + 1));
  }
  return out;
}

describe('TC-0 fixture validity', () => {
  it('every invariant string occurs in the pre-restructure SKILL.md', (t) => {
    const old = baselineSkill();
    if (old === null) return t.skip(`baseline commit ${FIXTURE.baseline_commit} not available (shallow clone?)`);
    assert.equal(Buffer.byteLength(old), BASELINE_BYTES, 'baseline size drifted: wrong commit in the fixture');
    const all = [...Object.values(FIXTURE.lanes).flat(), ...FIXTURE.index];
    const missing = all.filter((s) => !old.includes(s));
    assert.deepEqual(missing, []);
  });
});

describe('SKILL.md index: frontmatter and size', () => {
  const text = readFileSync(SKILL_MD, 'utf8');

  it('TC-1 frontmatter parses, uses only documented keys, has no parameters block', () => {
    const { fm } = parseFrontmatter(text);
    for (const k of Object.keys(fm)) assert.ok(DOCUMENTED_KEYS.has(k), `undocumented frontmatter key: ${k}`);
    assert.ok(!('parameters' in fm), '`parameters` is not a documented field');
    assert.equal(fm.name, 'laneconductor');
  });

  it('TC-2 description + when_to_use fit the 1,536-char cap and lead with the use case', () => {
    const { fm } = parseFrontmatter(text);
    assert.ok(fm.description && fm.when_to_use, 'description and when_to_use are required');
    assert.ok(fm.description.length + fm.when_to_use.length <= 1536,
      `description + when_to_use = ${fm.description.length + fm.when_to_use.length} chars`);
    assert.ok(fm.description.startsWith('Plan'), 'description must lead with the key use case');
    assert.ok(!/[<>]/.test(fm.description + fm.when_to_use), 'no angle brackets in description/when_to_use');
    assert.ok(!/postgres/i.test(fm.description + fm.when_to_use), 'must not advertise the retiring Postgres architecture');
  });

  it('TC-3 SKILL.md is at most 200 lines and 20,000 bytes', () => {
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 200, `SKILL.md has ${lines} lines`);
    assert.ok(Buffer.byteLength(text) <= 20000, `SKILL.md has ${Buffer.byteLength(text)} bytes`);
  });

  it('TC-4 the body has no $<digit> or $ARGUMENTS (Claude Code substitutes them)', () => {
    const { body } = parseFrontmatter(text);
    assert.ok(!/\$\d/.test(body), 'found $<digit>');
    assert.ok(!body.includes('$ARGUMENTS'), 'found $ARGUMENTS');
  });

  it('TC-5 every relative markdown link resolves to an existing file', () => {
    const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l));
    assert.ok(links.length > 0, 'expected relative links');
    for (const l of links) assert.ok(existsSync(join(SKILL_DIR, l.split('#')[0])), `broken link: ${l}`);
  });
});

describe('routing', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  const rows = routingRows(text);

  it('TC-6 every command the daemon, CLI or UI can send resolves to an existing file', () => {
    const names = new Set(SLASH_COMMANDS.map((c) => c.name));
    for (const n of ['qualityGate', 'quality-gate', 'done', 'merge', 'brainstorm', 'comment', 'move',
      'setup scaffold generate', 'setup-deploy generate']) names.add(n);
    const problems = [];
    for (const n of names) {
      const r = rowFor(rows, n);
      if (!r) { problems.push(`no routing row for ${n}`); continue; }
      if (!r.links.length) { problems.push(`row for ${n} has no link`); continue; }
      for (const l of r.links) if (!existsSync(join(SKILL_DIR, l.split("#")[0]))) problems.push(`row for ${n} links missing file ${l}`);
    }
    assert.deepEqual(problems, []);
  });

  it('TC-7 qualityGate and quality-gate share one file; done and merge share one file', () => {
    assert.deepEqual(rowFor(rows, 'qualityGate').links, ['lanes/quality-gate.md']);
    assert.deepEqual(rowFor(rows, 'quality-gate').links, ['lanes/quality-gate.md']);
    assert.deepEqual(rowFor(rows, 'done').links, ['lanes/merge.md']);
    assert.deepEqual(rowFor(rows, 'merge').links, ['lanes/merge.md']);
  });

  it('REQ-7 legacy files are reachable only through the routing table', () => {
    for (const f of listMd(join(SKILL_DIR, 'lanes'))) {
      assert.ok(!/legacy\//.test(read(join('lanes', f))), `lanes/${f} must not link to legacy/`);
    }
  });

  it('the index tells non-Claude CLIs where the lane files live', () => {
    assert.ok(text.includes('.claude/skills/laneconductor/'), 'index must name the default skill directory');
  });
});

describe('layout', () => {
  it('TC-8 the planned files exist', () => {
    const want = [
      ...Object.values(LANE_FILES), 'ops/tracks.md',
      'setup/setup.md', 'setup/scaffold.md', 'setup/templates.md',
      'deploy/setup-deploy.md', 'deploy/deploy.md',
      'legacy/worker.md', 'legacy/db-schema.md', 'legacy/syncdb.md', 'legacy/remote-sync.md',
    ];
    assert.deepEqual(want.filter((f) => !existsSync(join(SKILL_DIR, f))), []);
  });
});

describe('lane files', () => {
  it('TC-9 self-containment: no lane file points at another lane file or at ops/setup/deploy/legacy', () => {
    for (const rel of Object.values(LANE_FILES)) {
      const t = read(rel);
      assert.ok(!/\]\([^)]*\.md/.test(t), `${rel} contains a markdown link to another file`);
      assert.ok(!/(^|[^\w.\/-])(lanes|ops|setup|deploy|legacy)\/[\w-]+\.md/.test(t), `${rel} names a sibling skill file`);
      assert.ok(!/see `?\/laneconductor (plan|implement|review|quality-gate|qualityGate|merge|brainstorm)/i.test(t),
        `${rel} says "see /laneconductor <other lane>"`);
    }
  });

  it('TC-10 invariants: each lane file keeps the strings its transitions depend on', () => {
    for (const [lane, strings] of Object.entries(FIXTURE.lanes)) {
      const rel = LANE_FILES[lane];
      const t = read(rel);
      assert.deepEqual(strings.filter((s) => !t.includes(s)), [], `${rel} lost invariant strings`);
    }
    const idx = readFileSync(SKILL_MD, 'utf8');
    assert.deepEqual(FIXTURE.index.filter((s) => !idx.includes(s)), [], 'SKILL.md lost invariant strings');
  });

  it('TC-11 no lane file and not SKILL.md writes the legacy **Status** marker', () => {
    const files = [['SKILL.md', readFileSync(SKILL_MD, 'utf8')], ...Object.values(LANE_FILES).map((r) => [r, read(r)])];
    for (const [name, t] of files) {
      const bad = t.split('\n').filter((l) => l.includes('**Status**:') && !l.includes('file_sync_queue'));
      assert.deepEqual(bad, [], `${name} mentions the legacy **Status** marker`);
    }
  });

  it('TC-12 size budget: SKILL.md + one lane file is at most 32,000 bytes', () => {
    const idx = Buffer.byteLength(readFileSync(SKILL_MD, 'utf8'));
    const rows = [];
    for (const rel of Object.values(LANE_FILES)) {
      const total = idx + bytes(rel);
      rows.push(`${rel}: ${total} bytes (${(100 * total / BASELINE_BYTES).toFixed(1)}% of ${BASELINE_BYTES})`);
      assert.ok(total <= 32000, `${rel}: SKILL.md + lane = ${total} bytes`);
    }
    console.log(rows.join('\n'));
  });
});

describe('dedupe and stale text', () => {
  it('TC-13 exactly one remote-sync procedure, and the stale qualityGate text is gone', () => {
    const heads = [];
    let stale = [];
    for (const rel of listMd(SKILL_DIR)) {
      const t = read(rel);
      if (/^#{1,6} .*remote-sync/m.test(t)) heads.push(rel);
      if (t.includes('update `index.md` status to `success`')) stale.push(rel);
    }
    assert.deepEqual(heads, ['legacy/remote-sync.md']);
    assert.deepEqual(stale, []);
  });
});

describe('heading coverage (TC-I2)', () => {
  it('every old SKILL.md heading appears in the track mapping table, and mapped files exist', (t) => {
    const old = baselineSkill();
    if (old === null) return t.skip('baseline commit not available');
    const tracksDir = join(REPO_ROOT, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find((d) => d.startsWith('AM-10109-'));
    if (!dir || !existsSync(join(tracksDir, dir, 'skill-mapping.md'))) return t.skip('track folder / skill-mapping.md not present');
    const mapping = readFileSync(join(tracksDir, dir, 'skill-mapping.md'), 'utf8');

    const headings = [];
    let fence = false;
    for (const line of old.split('\n')) {
      if (/^```/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const m = line.match(/^(#{1,3}) (.+)$/);
      if (m) headings.push(m[2].trim());
    }
    const unmapped = headings.filter((h) => !mapping.includes(h));
    assert.deepEqual(unmapped, [], 'old headings missing from skill-mapping.md');

    const dests = [...mapping.matchAll(/`((?:lanes|ops|setup|deploy|legacy)\/[\w-]+\.md|SKILL\.md)`/g)].map((m) => m[1]);
    for (const d of new Set(dests)) assert.ok(existsSync(join(SKILL_DIR, d)), `mapping names a missing file: ${d}`);
  });
});

describe('symlinked install (TC-SYM-1)', () => {
  it('every relative link in SKILL.md opens when the skill dir is reached through a symlink', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lc-10109-sym-'));
    try {
      mkdirSync(join(tmp, '.claude', 'skills'), { recursive: true });
      const link = join(tmp, '.claude', 'skills', 'laneconductor');
      symlinkSync(SKILL_DIR, link, 'dir');
      assert.ok(statSync(link).isDirectory());
      const text = readFileSync(join(link, 'SKILL.md'), 'utf8');
      const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l));
      assert.ok(links.length > 0);
      for (const l of links) assert.ok(existsSync(join(link, l.split('#')[0])), `broken through symlink: ${l}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
