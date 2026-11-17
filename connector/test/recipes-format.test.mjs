// Phase 2 (TC-2.1 to TC-2.8): the recipe format checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY, skill } from './helpers/recipes.mjs';
import { checkRecipe, parsePaths, sectionHeadings } from '../src/recipes/format.mjs';

const check = (text, folder = 'sample-recipe') => checkRecipe({ folder, text });
const fields = (r) => r.errors.map((e) => e.field);

test('TC-2.1: a valid recipe passes', () => {
  const r = check(skill());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('TC-2.2: the folder name must equal name', () => {
  const r = check(skill({ name: 'foo' }), 'foo-bar');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name' && /folder/.test(e.message)));
  assert.equal(check(skill({ name: 'Foo_Bar' }), 'Foo_Bar').errors[0].field, 'name');
});

test('TC-2.3: an undocumented top-level field is named and pointed at metadata', () => {
  const r = check(skill({ top: 'stack: [gcp]' }));
  const e = r.errors.find((x) => x.field === 'stack');
  assert.ok(e);
  assert.match(e.message, /metadata/);
});

test('TC-2.4: metadata must be a map and must not reuse a frontmatter field name', () => {
  const notMap = check(skill({ raw: 'name: sample-recipe\ndescription: d\nmetadata: x' }));
  assert.deepEqual(fields(notMap).filter((f) => f === 'metadata'), ['metadata']);
  const reused = check(skill({ extraMeta: '  paths: [a]' }));
  assert.deepEqual(fields(reused), ['metadata.paths']);
});

test('TC-2.5: kind must be recipe or process', () => {
  const r = check(skill({ kind: 'skill' }));
  assert.deepEqual(fields(r), ['metadata.kind']);
});

test('TC-2.6: description + when_to_use is capped at 1,536 characters', () => {
  const split = (total) => skill({ description: 'd'.repeat(total - 100), when_to_use: 'w'.repeat(100) });
  assert.equal(check(split(1536)).ok, true);
  const over = check(split(1537));
  assert.equal(over.ok, false);
  assert.deepEqual(fields(over), ['description']);
});

test('TC-2.7: sections must be in order; a recipe needs You run, a process does not', () => {
  const swapped = BODY.replace('## Recommendation', '## TMP').replace('## Claude does', '## Recommendation').replace('## TMP', '## Claude does');
  const r = check(skill({ body: swapped }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'body' && /must come before/.test(e.message)));

  const noRun = BODY.replace(/## You run[\s\S]*?(?=## Pitfalls)/, '');
  const rec = check(skill({ body: noRun }));
  assert.ok(rec.errors.some((e) => /missing section "## You run"/.test(e.message)));

  const processBody = '## Why this works for you\nbecause\n\n## Recommendation\n1. ask\n';
  const p = check(skill({ kind: 'process', body: processBody, refs: [] }));
  assert.deepEqual(p.errors, []);
});

test('TC-2.7b: a recipe needs a reference; headings inside code fences are not sections', () => {
  assert.ok(check(skill({ refs: [] })).errors.some((e) => e.field === 'metadata.reference'));
  const fenced = `${BODY}\n\`\`\`md\n## You run\n\`\`\`\n`;
  assert.deepEqual(sectionHeadings(fenced).map((h) => h.title), ['Why this works for you', 'Recommendation', 'Claude does', 'You run', 'Pitfalls']);
  assert.equal(check(skill({ body: fenced })).ok, true);
});

test('TC-2.8: the body is capped at 8,000 characters', () => {
  const pad = (n) => `${BODY}${'x'.repeat(n)}`;
  const at = pad(8000 - BODY.length);
  const over = check(skill({ body: `${at}y` }));
  assert.equal(check(skill({ body: at })).ok, true);
  assert.ok(over.errors.some((e) => e.field === 'body' && /8000/.test(e.message)));
});

test('reference entries are validated; verified must be a date or null', () => {
  const bad = check(skill({ refs: [{ repo: 'nope', path: '../x', commit: 'zz' }] }));
  assert.deepEqual(fields(bad).sort(), ['metadata.reference[0].commit', 'metadata.reference[0].path', 'metadata.reference[0].repo']);
  assert.ok(check(skill({ verified: 'null' })).ok);
  assert.deepEqual(fields(check(skill({ verified: 'yesterday' }))), ['metadata.verified']);
  // a bare number is YAML, not a string: the message says to quote it
  const num = check(skill({ raw: skill().split('---')[1].replace('commit: "abc1234"', 'commit: 1234567') }));
  assert.ok(num.errors.some((e) => e.field === 'metadata.reference[0].commit' && /quote/.test(e.message)));
});

test('missing frontmatter and invalid YAML are reported, not thrown', () => {
  assert.equal(check('# no frontmatter').errors[0].field, 'frontmatter');
  assert.equal(check('---\nname: [unclosed\n---\nbody').errors[0].field, 'frontmatter');
});

test('parsePaths accepts a comma string or a list and keeps brace globs whole', () => {
  assert.deepEqual(parsePaths('firebase.json, .firebaserc'), ['firebase.json', '.firebaserc']);
  assert.deepEqual(parsePaths(['a', 'b/**']), ['a', 'b/**']);
  assert.deepEqual(parsePaths('src/*.{ts,js}, Makefile'), ['src/*.{ts,js}', 'Makefile']);
  assert.deepEqual(parsePaths(undefined), []);
});
