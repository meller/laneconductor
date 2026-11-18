// Track AM-10131 (TC-10, TC-11, TC-12): the one current reference for lanes, lane statuses and transitions
// (ops/lanes-and-statuses.md), shipped in the Markdown-only base, linked from the skill index, /laneconductor:workflow and the lane
// guides; and the text of the guides and commands tells the model to use `valid.next` or `outcome`, never to compute a target from the raw
// file, with track 1020's grammar for the case where the connector is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/commands.mjs';
import { BASE_PROCEDURES } from '../../scripts/plugin-texts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const REF = 'ops/lanes-and-statuses.md';
const SKILL = '.claude/skills/laneconductor';
const BASE = 'plugins/laneconductor/skills/laneconductor';
const LANE_GUIDES = ['plan', 'brainstorm', 'implement', 'review', 'quality-gate', 'merge'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

test('TC-10: the reference exists in the skill source and in the generated BASE plugin, and says what it must', () => {
  for (const root of [SKILL, BASE]) {
    assert.ok(fs.existsSync(path.join(REPO, root, REF)), `${root}/${REF} exists`);
    const t = read(`${root}/${REF}`);
    for (const s of ['queue', 'running', 'success', 'failure', 'waiting']) assert.match(t, new RegExp(`\\| \`${s}\` \\|`), `status ${s} has a row with a meaning`);
    assert.match(t, /done:queue.*not shipped/i, 'done:queue means passed the gate, not shipped');
    assert.match(t, /done:success.*shipped/i, 'done:success means shipped');
    assert.match(t, /different\*\* lane[\s\S]{0,80}`queue`/, 'bare different lane defaults to queue');
    assert.match(t, /same\*\* lane[\s\S]{0,120}`success`[\s\S]{0,60}`failure`/i, 'bare same lane defaults to success / failure');
    assert.match(t, /bare `done`[^\n]*`done:queue`/, 'a bare done from another lane is done:queue');
    assert.match(t, /null[^\n]*no automatic move/i, 'null means no automatic move');
    assert.match(t, /`running` belongs to the lane whose action is executing/, 'where running belongs');
    assert.match(t, /quality-gate:running/, 'the deploy gate example');
    assert.match(t, /Manual moves win/i);
    assert.match(t, /`planning` to `plan` and `in-progress` to `implement`/, 'old-to-new lane names');
    assert.match(t, /valid\.guide_lanes/, 'how a project\'s own names map');
    assert.match(t, /valid\.next/);
    assert.match(t, /outcome/);
    assert.match(t, /superseded/i, 'marks the three-status text of track 1016 as superseded');
  }
  assert.equal(read(`${SKILL}/${REF}`), read(`${BASE}/${REF}`), 'the base ships the source file as it is');
});

test('TC-10: the base plugin stays Markdown, JSON and one PNG only', () => {
  const files = walk('plugins/laneconductor');
  const odd = files.filter((f) => !/\.(md|json|png)$/.test(f) && !/\/LICENSE$/.test(f));
  assert.deepEqual(odd, [], 'no program file in the base');
  assert.ok(!files.some((f) => f.endsWith('workflow-transitions.mjs')), 'the shared resolver is not in the base');
});

test('TC-11: the skill index, /laneconductor:workflow and every lane guide link to the reference', () => {
  assert.match(read(`${SKILL}/SKILL.md`), /ops\/lanes-and-statuses\.md/);
  assert.match(read(`${SKILL}/ops/tracks.md`), /lanes-and-statuses\.md/, 'move and workflow sections');
  const workflow = COMMANDS.find((c) => c.name === 'workflow');
  assert.match(workflow.procedure, /lanes-and-statuses\.md/);
  assert.match(read('plugins/laneconductor/commands/workflow.md'), /lanes-and-statuses\.md/, 'the generated base command');
  assert.match(workflow.procedure, /OFFER[\s\S]{0,300}backup[\s\S]{0,200}until I say yes/, 'the migration is an offer: backup first, nothing written without a yes');
  for (const lane of ['plan', 'implement', 'review', 'quality-gate', 'merge']) {
    for (const rel of [`${SKILL}/lanes/${lane}.md`, `connector/guides/${lane}.md`, `${BASE}/lanes/${lane}.md`]) assert.match(read(rel), /lanes-and-statuses\.md|valid\.next|outcome/, `${rel} points at the reference or the tools`);
  }
  for (const lane of ['plan', 'implement', 'review', 'quality-gate']) assert.match(read(`${SKILL}/lanes/${lane}.md`), /lanes-and-statuses\.md/, `${lane} guide links the reference`);
  assert.match(read(`${BASE}/SKILL.md`), /ops\/lanes-and-statuses\.md/);
});

test('TC-11: no lane guide, command or plugin text says "done:success after implement" or computes a target from the raw file', () => {
  const texts = [
    ...walk(SKILL).filter((f) => f.endsWith('.md')),
    ...walk('connector/guides'),
    ...walk('plugins').filter((f) => f.endsWith('.md')),
    'connector/src/commands.mjs',
    'scripts/plugin-texts.mjs',
  ];
  for (const rel of texts) {
    const t = read(rel);
    assert.doesNotMatch(t, /done:success after implement/i, rel);
    // The old guide wording: "set **Lane** to `lanes.implement.on_success`" computes the target from the raw file.
    assert.doesNotMatch(t, /set `\*\*Lane\*\*` to\s+`lanes\.[a-z-]+\.on_(success|failure)`/i, `${rel}: still computes a target from the raw file`);
    assert.doesNotMatch(t, /apply `lanes\.plan\.on_success`/i, `${rel}: still computes a target from the raw file`);
  }
});

test('TC-11: the commands that move tracks say: valid.next or outcome with the connector, track 1020\'s grammar without it', () => {
  for (const name of ['move', 'implement', 'review', 'quality-gate', 'run']) {
    const cat = COMMANDS.find((c) => c.name === name).procedure;
    assert.match(cat, /valid\.next|outcome/, `catalog ${name} names valid.next or outcome`);
    const base = BASE_PROCEDURES[name] ?? '';
    assert.match(base, /lanes-and-statuses\.md/, `base ${name} gives the grammar by reference when the connector is absent`);
  }
  // The generated commands carry it too (commands/*.md of the base, built from the above).
  for (const name of ['move', 'implement', 'review', 'quality-gate', 'run']) {
    assert.match(read(`plugins/laneconductor/commands/${name}.md`), /lanes-and-statuses\.md/, `generated ${name}`);
  }
  // The lane guides that end a lane say so for each direction.
  for (const lane of ['plan', 'implement', 'review', 'quality-gate']) {
    const t = read(`${SKILL}/lanes/${lane}.md`);
    assert.match(t, /valid\.next|outcome/, `${lane} guide`);
  }
});

test('TC-11: this repository\'s guides and the plugin copies stay in step (same reference link in the source and in the generated base)', () => {
  // The base copy has daemon-free rewordings (track AM-10130), so the guides are not byte-identical; the reference links must be.
  const links = (t) => t.match(/[\w./-]*lanes-and-statuses\.md/g) ?? [];
  for (const lane of LANE_GUIDES) assert.deepEqual(links(read(`${BASE}/lanes/${lane}.md`)), links(read(`${SKILL}/lanes/${lane}.md`)), lane);
});
