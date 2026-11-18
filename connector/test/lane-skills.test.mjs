// Track AM-10123 (Phase 2): the lane-to-skill map. Every lane guide has a "Skills that help here" section written as a
// suggestion, and the optional top-level `skills` object of conductor/workflow.json is read without error by the
// connector and by the legacy parsers under conductor/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm, WORKFLOW_JSON } from './helpers/repo.mjs';
import { DEFAULT_WORKFLOW } from '../src/newproject/scaffold.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const HEADING = '## Skills that help here';

// The starting set, by lane guide (names from the Superpowers plugin).
const MAP = {
  plan: ['brainstorming', 'writing-plans'],
  brainstorm: ['brainstorming', 'writing-plans'],
  implement: ['test-driven-development', 'systematic-debugging', 'subagent-driven-development', 'using-git-worktrees'],
  review: ['requesting-code-review', 'receiving-code-review'],
  'quality-gate': ['verification-before-completion'],
  merge: ['finishing-a-development-branch'],
};

const section = (text) => {
  const i = text.indexOf(HEADING);
  assert.ok(i >= 0, 'has the section');
  assert.equal(text.indexOf(HEADING, i + 1), -1, 'one section only');
  return text.slice(i);
};

const GUIDE_DIRS = {
  'skill lane guide': (lane) => `.claude/skills/laneconductor/lanes/${lane}.md`,
  'bundled guide': (lane) => `connector/guides/${lane}.md`,
  'generated plugin guide': (lane) => `plugins/laneconductor/skills/laneconductor/lanes/${lane}.md`,
};

for (const [label, rel] of Object.entries(GUIDE_DIRS)) {
  test(`${label}s: each lane has "Skills that help here" with its starting skills, as a suggestion`, () => {
    for (const [lane, names] of Object.entries(MAP)) {
      const s = section(read(rel(lane)));
      for (const n of names) assert.ok(s.includes(`\`${n}\``), `${lane}: names ${n}`);
      assert.match(s, /suggestion|never orders?/i, `${lane}: framed as a suggestion`);
      assert.match(s, /not installed|is missing|one is missing/i, `${lane}: says what to do when a skill is missing`);
      assert.ok(s.includes('conductor/workflow.json') && s.includes('`skills`') && s.includes(`"${lane}"`), `${lane}: tells Claude to read the optional skills key under its own name`);
      assert.match(s, /optional/i, `${lane}: the key is optional`);
      assert.doesNotMatch(s, /\b(must|always|required)\b/i, `${lane}: no commanding words`);
    }
  });
}

test('the section ends each lane guide, and the other lanes\' skills are not suggested at the wrong lane', () => {
  for (const lane of Object.keys(MAP)) {
    const text = read(GUIDE_DIRS['skill lane guide'](lane));
    assert.ok(text.indexOf(HEADING) > text.length / 2, `${lane}: the section comes late in the guide`);
    assert.ok(!/^## /m.test(text.slice(text.indexOf(HEADING) + HEADING.length)), `${lane}: nothing follows the section`);
  }
  assert.ok(!section(read(GUIDE_DIRS['skill lane guide']('merge'))).includes('test-driven-development'));
});

test('templates.md documents the optional skills key and the default workflow.json does not carry it', () => {
  const md = read('.claude/skills/laneconductor/setup/templates.md');
  assert.match(md, /Optional `skills` object in `conductor\/workflow\.json`/);
  assert.match(md, /"skills": \{ "implement": \["my-firebase-deploy"\]/);
  assert.ok(!('skills' in DEFAULT_WORKFLOW), 'the generated default is unchanged');
  const m = md.match(/\*\*`conductor\/workflow\.json` default\*\*[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(m && !('skills' in JSON.parse(m[1])), 'the default block in templates.md has no skills key');
});

// --- the connector -----------------------------------------------------------------------------------------

const WITH_SKILLS = JSON.stringify({ ...JSON.parse(WORKFLOW_JSON), skills: { implement: ['my-firebase-deploy'], review: ['my-review-checklist'], 'not-a-lane': [] } }, null, 2);

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
async function open(workflowText) {
  const dir = makeRepo({ files: { 'conductor/workflow.json': workflowText } });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  return s;
}

for (const [label, wf] of [['without a skills key', WORKFLOW_JSON], ['with a skills key', WITH_SKILLS]]) {
  test(`connector reads workflow.json ${label}: transitions, lane names for validation, lane guide, no warning`, async () => {
    const s = await open(wf);
    const ctx = await s.call('get_context');
    assert.equal(ctx.isError, false);
    assert.deepEqual(ctx.env.warnings ?? [], []);
    assert.equal(ctx.env.data.workflow_transitions.implement.on_success, 'review:queue');
    assert.deepEqual(Object.keys(ctx.env.data.workflow_transitions).sort(), ['done', 'implement', 'plan', 'quality-gate', 'review']);
    const guide = (await s.call('get_context', { lane: 'implement' })).env.data.lane_guide;
    assert.match(guide.advice, /Skills that help here/);
    // update_track validates `Lane` against the lanes of workflow.json (workflowLanes): a real lane passes, `skills` is not a lane.
    const made = await s.call('create_track', { title: 'Probe track', problem: 'checks that workflow.json is read' });
    assert.equal(made.isError, false, made.text);
    const track = made.env.data.track.number;
    const got = { env: { data: { base: made.env.data.base } } };
    const moved = await s.call('update_track', { track, base: got.env.data.base, markers: { Lane: 'implement', 'Lane Status': 'queue' } });
    assert.equal(moved.isError, false, moved.text);
    const bad = await s.call('update_track', { track, base: moved.env.data.base, markers: { Lane: 'skills' } });
    assert.equal(bad.isError, true, 'a key of workflow.json that is not a lane is no lane');
  });
}

// --- the legacy parsers under conductor/ -------------------------------------------------------------------

test('legacy parsers (mergeWorkflowConfig, stripLanePrimaryCli) accept workflow.json with and without a skills key and carry it through', async () => {
  const { mergeWorkflowConfig } = await import('../../conductor/services/meta-defaults.mjs');
  const { stripLanePrimaryCli } = await import('../../conductor/services/lane-model-resolver.mjs');
  for (const text of [WORKFLOW_JSON, WITH_SKILLS, read('conductor/workflow.json'), JSON.stringify({ ...JSON.parse(read('conductor/workflow.json')), skills: { plan: ['x'] } })]) {
    const parsed = stripLanePrimaryCli(JSON.parse(text), () => {});
    const merged = mergeWorkflowConfig({ projectWorkflow: parsed, metaWorkflow: {}, globalCanonicalWorkflow: null, inheritMetaDefaults: false });
    assert.deepEqual(Object.keys(merged.lanes), Object.keys(parsed.lanes), 'lanes are untouched');
    assert.deepEqual(merged.skills, parsed.skills, 'skills is carried through, or stays absent');
    // The access pattern of the sync worker (isQualityGateEnabled, hooks): lanes by name, never the other top-level keys.
    assert.equal(parsed.lanes['quality-gate'] !== undefined, true);
  }
  // A project with a skills key over a canonical workflow without one: the project's key wins; without it nothing is added.
  const canonical = JSON.parse(WORKFLOW_JSON);
  assert.equal('skills' in mergeWorkflowConfig({ projectWorkflow: canonical, globalCanonicalWorkflow: canonical }), false);
  assert.deepEqual(mergeWorkflowConfig({ projectWorkflow: JSON.parse(WITH_SKILLS), globalCanonicalWorkflow: canonical }).skills.implement, ['my-firebase-deploy']);
});
