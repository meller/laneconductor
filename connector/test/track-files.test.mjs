// Track AM-10146: what goes in each track file. history.md (tracked run log) next to the untracked conversation.md, the contract text
// (plan.md is the task tracker; status, releases and incidents are dated lines in history.md) and the plan_has_log lint.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, buildPlugin } from '../../scripts/build-plugin.mjs';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, readFile, rm, INDEX } from './helpers/repo.mjs';
import { noLcHits } from './helpers/no-lc.mjs';
import { writeScaffold, GITIGNORE_LINES } from '../src/newproject/scaffold.mjs';
import { generateSummary } from '../src/summary.mjs';
import { PLAN_LOG_BYTES, planLogFindings, planLogWarning } from '../src/plan-log.mjs';
import { formatHistoryLine, historyStamp } from '../src/conversation.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const IGNORE = 'conductor/tracks/**/conversation.md\nconductor/tracks/**/conversation.json\n';
const fixture = () => {
  const dir = makeRepo({ files: { '.gitignore': IGNORE } });
  cleanup.push(dir);
  return dir;
};
const open = async (dir) => {
  const s = await connect(dir);
  sessions.push(s);
  return s;
};
const T = (n, slug) => `conductor/tracks/AM-${n}-${slug}`;
const LINE = /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z /;

// ---- history.md: created, routed, committed ----

test('create_track creates history.md with a one-line header, committed with the track; conversation.md stays untracked', async () => {
  const dir = fixture();
  const s = await open(dir);
  const r = await s.call('create_track', { title: 'A plain feature', problem: 'Do the thing.' });
  assert.equal(r.isError, false, r.text);
  const folder = r.env.data.track.folder;
  const history = `conductor/tracks/${folder}/history.md`;
  assert.ok(r.env.data.files_created.includes(history), JSON.stringify(r.env.data.files_created));
  assert.equal(readFile(dir, history), `# History: Track ${r.env.data.track.id}\n\n`);
  assert.equal(git(dir, 'ls-files', history), history, 'history.md is tracked');
  assert.match(git(dir, 'log', '--format=%H', '--', history), /^[0-9a-f]{40}$/m, 'a commit touched history.md');
  assert.equal(git(dir, 'ls-files', `conductor/tracks/${folder}/conversation.md`), '', 'conversation.md is not tracked');
  assert.ok(fs.existsSync(path.join(dir, `conductor/tracks/${folder}/conversation.md`)));
});

test('append_conversation: author system lands in history.md as a dated line and is committed; the answer names the file', async () => {
  const dir = fixture();
  const s = await open(dir);
  const made = await s.call('create_track', { title: 'Routing', problem: 'Check where a line goes.' });
  const folder = made.env.data.track.folder;
  const history = `conductor/tracks/${folder}/history.md`;
  const before = git(dir, 'rev-list', '--count', 'HEAD');
  const r = await s.call('append_conversation', { track: String(made.env.data.track.number), author: 'system', body: '✅ Plan complete - track now at plan:success.' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.env.data.appended.file, 'history.md');
  assert.match(r.env.summary ?? r.text, /history\.md/);
  assert.ok(r.env.data.commit?.sha, 'committed');
  assert.equal(Number(git(dir, 'rev-list', '--count', 'HEAD')), Number(before) + 1);
  assert.ok(git(dir, 'log', '--format=%H', '--', history).split('\n').includes(git(dir, 'rev-parse', 'HEAD')), 'the new commit is in the log of history.md');
  const lines = readFile(dir, history).split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 1);
  assert.match(lines[0], LINE);
  assert.match(lines[0], /Z ✅ Plan complete - track now at plan:success\.$/, 'the emoji is the first character after the date');
  // not in conversation.md
  assert.ok(!/Plan complete/.test(readFile(dir, `conductor/tracks/${folder}/conversation.md`)));
});

test('append_conversation: human, claude and gemini stay in conversation.md and are not committed', async () => {
  const dir = fixture();
  const s = await open(dir);
  const made = await s.call('create_track', { title: 'Dialogue', problem: 'Check where a comment goes.' });
  const folder = made.env.data.track.folder;
  const conv = `conductor/tracks/${folder}/conversation.md`;
  const history = `conductor/tracks/${folder}/history.md`;
  const head = git(dir, 'rev-parse', 'HEAD');
  for (const author of ['human', 'claude', 'gemini']) {
    const r = await s.call('append_conversation', { track: String(made.env.data.track.number), author, body: `from ${author}` });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.env.data.appended.file, 'conversation.md');
    assert.equal(r.env.data.commit, null, 'an ignored file is not committed');
  }
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'no commit');
  assert.equal(git(dir, 'ls-files', conv), '');
  for (const a of ['human', 'claude', 'gemini']) assert.match(readFile(dir, conv), new RegExp(`> \\*\\*${a}\\*\\*: from ${a}`));
  assert.equal(readFile(dir, history), `# History: Track ${made.env.data.track.id}\n\n`, 'history.md untouched');
});

test('an older track without history.md gets it with its first system entry; lines append in order; multi-line text is one line', async () => {
  const dir = fixture();
  writeFile(dir, `${T(5, 'old')}/index.md`, INDEX(5, 'Old'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'old track without history.md');
  const s = await open(dir);
  const history = `${T(5, 'old')}/history.md`;
  assert.ok(!fs.existsSync(path.join(dir, history)));
  const a = await s.call('append_conversation', { track: '5', author: 'system', body: 'ℹ️ Classified as **Track Kind**: bug - the symptom\nis a crash.' });
  assert.equal(a.isError, false, a.text);
  const b = await s.call('append_conversation', { track: '5', author: 'system', body: '✅ Implementation complete - moved to review:queue.' });
  assert.equal(b.isError, false, b.text);
  const text = readFile(dir, history);
  assert.ok(text.startsWith('# History: Track AM-5\n\n'), text);
  const lines = text.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Z ℹ️ Classified as \*\*Track Kind\*\*: bug - the symptom is a crash\.$/);
  assert.match(lines[1], /Z ✅ Implementation complete/);
  assert.equal(git(dir, 'ls-files', history), history);
});

test('a system body that is already a turn or a dated line is refused, nothing is written', async () => {
  const dir = fixture();
  writeFile(dir, `${T(5, 'old')}/index.md`, INDEX(5, 'Old'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'track');
  const s = await open(dir);
  for (const body of ['> **system**: ✅ done', '- 2026-11-18 10:00Z ✅ done', '   ']) {
    const r = await s.call('append_conversation', { track: '5', author: 'system', body });
    assert.equal(r.isError, true, body);
    assert.equal(r.env.error.code, 'VALIDATION_FAILED');
  }
  assert.ok(!fs.existsSync(path.join(dir, T(5, 'old'), 'history.md')));
});

test('formatHistoryLine: UTC minute stamp, one line, emoji first', () => {
  assert.equal(historyStamp(Date.UTC(2026, 10, 18, 9, 5, 59)), '2026-11-18 09:05Z');
  assert.equal(formatHistoryLine(Date.UTC(2026, 10, 18, 9, 5), '⚠️ PR opened -\n waiting for review.'), '- 2026-11-18 09:05Z ⚠️ PR opened - waiting for review.');
});

// ---- the scaffold ----

test('the scaffold creates an empty history.md beside each first track and its .gitignore lines do not ignore it', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-tf-scaffold-'));
  cleanup.push(dir);
  const out = writeScaffold(dir, { name: 'Demo', summary: 'A demo project.', initials: 'DM' });
  const historyRel = out.created.find((f) => f.endsWith('/history.md'));
  assert.ok(historyRel, JSON.stringify(out.created));
  assert.match(fs.readFileSync(path.join(dir, historyRel), 'utf8'), /^# History: Track DM-\d+\n\n$/);
  assert.ok(!GITIGNORE_LINES.some((l) => /history/.test(l)));
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.ok(!/history/.test(gi));
  const ignored = (rel) => { try { git(dir, 'check-ignore', '-q', '--', rel); return true; } catch { return false; } };
  assert.equal(ignored(historyRel), false, 'history.md is not ignored');
  assert.equal(ignored(historyRel.replace('history.md', 'conversation.md')), true, 'conversation.md still is');
});

// ---- the lint ----

const CLEAN = '# Track 1: Clean\n\n## Phase 1: Build\n\n**Problem**: x\n\n- [ ] Task one\n- [x] Task two\n\n## Phase 2: Ship\n\n- [ ] Task three\n';
const checkboxes = (n) => `${CLEAN}\n${Array.from({ length: n }, (_, i) => `- [${i % 2 ? 'x' : ' '}] Task ${i + 4}: detail of the work`).join('\n')}\n`;

test('plan_has_log: a clean plan, and a plan with many task checkboxes, are not flagged', () => {
  assert.equal(planLogFindings(CLEAN).flagged, false);
  const many = planLogFindings(checkboxes(800));
  assert.equal(many.headings, 0);
  assert.equal(many.flagged, false, `${many.bytes} bytes of tasks`);
});

test('plan_has_log: exactly one dated heading is clean, two are a log', () => {
  assert.equal(planLogFindings(`${CLEAN}\n## 2026-11-18\n- note\n`).flagged, false);
  const two = planLogFindings(`${CLEAN}\n## 2026-11-18\n- a\n\n### 18 Nov\n- b\n`);
  assert.equal(two.headings, 2);
  assert.equal(two.flagged, true);
  assert.equal(planLogFindings(`${CLEAN}\n## Nov 18\n\n## November 2026\n`).flagged, true);
});

test('plan_has_log: STATUS, RELEASE, INCIDENT, UPDATE and LOG headings (any case, with an emoji) count; a numbered section or a fenced heading does not', () => {
  const f = planLogFindings(`${CLEAN}\n## STATUS 3\n\n### release v1.2\n\n## 🚨 Incident: outage\n\n## Update\n\n## Log\n`);
  assert.equal(f.headings, 5);
  assert.equal(f.flagged, true);
  assert.equal(planLogFindings(`${CLEAN}\n## 1.2 Design notes\n\n## 3 Items\n\n## Logging\n`).flagged, false, 'numbered sections and "Logging" are not log headings');
  assert.equal(planLogFindings(`${CLEAN}\n\`\`\`\n## STATUS a\n## STATUS b\n\`\`\`\n`).flagged, false, 'headings inside a fence are not headings');
});

test('plan_has_log: a plan over 60 KB is flagged without any dated heading', () => {
  const big = `${CLEAN}\n${'prose line that is long enough to add up\n'.repeat(1700)}`;
  const f = planLogFindings(big);
  assert.ok(f.bytes > PLAN_LOG_BYTES);
  assert.equal(f.headings, 0);
  assert.equal(f.flagged, true);
  assert.match(planLogWarning(f), /plan\.md is \d+ KB/);
});

test('plan_has_log: get_track warns within 200 characters and names the file and the count; a clean track has no such warning', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'log')}/index.md`, INDEX(1, 'Log'));
  writeFile(dir, `${T(1, 'log')}/plan.md`, `${CLEAN}\n${Array.from({ length: 25 }, (_, i) => `## STATUS 2026-10-${String((i % 28) + 1).padStart(2, '0')}\n- shipped something\n`).join('\n')}`);
  writeFile(dir, `${T(2, 'clean')}/index.md`, INDEX(2, 'Clean'));
  writeFile(dir, `${T(2, 'clean')}/plan.md`, CLEAN);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixtures');
  const s = await open(dir);
  const bad = await s.call('get_track', { track: '1', files: ['index'] });
  const w = bad.env.warnings.find((x) => /plan_has_log/.test(x));
  assert.ok(w, JSON.stringify(bad.env.warnings));
  assert.ok(w.length <= 200, `${w.length}`);
  assert.match(w, /plan\.md has 25 dated or STATUS/);
  assert.match(w, /history\.md/);
  const ok = await s.call('get_track', { track: '2' });
  assert.ok(!ok.env.warnings.some((x) => /plan_has_log/.test(x)), JSON.stringify(ok.env.warnings));
});

test('plan_has_log: list_tracks gives ONE aggregate line with the count and the first track numbers; the summary lint lists the track', async () => {
  const dir = fixture();
  for (let n = 1; n <= 6; n++) {
    writeFile(dir, `${T(n, `t${n}`)}/index.md`, INDEX(n, `T${n}`));
    writeFile(dir, `${T(n, `t${n}`)}/plan.md`, n <= 5 ? `${CLEAN}\n## STATUS one\n\n## RELEASE two\n` : CLEAN);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixtures');
  const s = await open(dir);
  const r = await s.call('list_tracks', {});
  const lines = r.env.warnings.filter((x) => /plan_has_log/.test(x));
  assert.equal(lines.length, 1, JSON.stringify(r.env.warnings));
  assert.ok(lines[0].length <= 200);
  assert.match(lines[0], /^plan_has_log in 5 tracks/);
  assert.match(lines[0], /AM-1, AM-2, AM-3, \.\.\./, 'the first few numbers, then an ellipsis');
  assert.ok(!/AM-6/.test(lines[0]));
  // the summary lint (pure function, no clock): the flagged track is under "Needs attention"; a clean one and a plan-less entry are not
  const entries = [1, 6].map((n) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `T${n}`) }, plan: { content: n === 1 ? `${CLEAN}\n## STATUS a\n\n## STATUS b\n` : CLEAN } }));
  const { text, attention } = generateSummary(entries, { lanes: ['plan', 'implement', 'review', 'quality-gate', 'done'], generatedAt: '2026-11-18T00:00:00Z' });
  assert.deepEqual(attention.map((a) => a.id), ['AM-1']);
  assert.match(text, /## Needs attention\n\n- AM-1-t1: plan_has_log: plan\.md holds a log/);
  const same = generateSummary(entries.map(({ plan, ...e }) => e), { lanes: ['plan', 'implement', 'review', 'quality-gate', 'done'], generatedAt: '2026-11-18T00:00:00Z' });
  assert.deepEqual(same.attention, [], 'an entry without plan.md content is not linted');
});

test('plan_has_log: the generated summary file carries the lint after a track write, and does not change when only a checkbox is ticked', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'log')}/index.md`, INDEX(1, 'Log'));
  writeFile(dir, `${T(1, 'log')}/plan.md`, `${CLEAN}\n## STATUS one\n\n## STATUS two\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  const s = await open(dir);
  const made = await s.call('create_track', { title: 'Another', problem: 'Trigger a summary write.' });
  assert.equal(made.isError, false, made.text);
  const summary = readFile(dir, 'conductor/tracks-summary.md');
  assert.match(summary, /AM-1-log: plan_has_log/);
  assert.ok(!/AM-\d+-another: plan_has_log/.test(summary));
});

// ---- the contract text ----

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const sectionOf = (text, head) => {
  const a = text.indexOf(`${head}\n`);
  assert.ok(a >= 0, `missing section ${head}`);
  const rest = text.slice(a + head.length);
  const b = rest.search(/\n## /);
  return b < 0 ? rest : rest.slice(0, b);
};
const FILES = ['index.md', 'spec.md', 'plan.md', 'test.md', 'history.md', 'conversation.md'];

test('ops/tracks.md has the contract: a table of the six files, plan.md as the task tracker, the history line format and the splitting procedure', () => {
  const tracks = read('.claude/skills/laneconductor/ops/tracks.md');
  const sec = sectionOf(tracks, '## What goes in each track file');
  for (const f of FILES) assert.ok(sec.includes(`| \`${f}\` |`), `row for ${f}`);
  assert.match(sec, /\| Never holds \|/);
  assert.match(sec, /\| `plan.md` \| Task tracker/);
  assert.match(sec, /never goes into `plan.md` or `spec.md`/);
  assert.match(sec, /- <YYYY-MM-DD HH:MMZ> <emoji> <one line>/);
  assert.ok(!/high-level/i.test(sec), 'the plan is not a high-level summary');
  assert.match(sec, /Who ticks what[^\n]*acceptance criteria[^\n]*review and the quality gate[^\n]*implementing agent[^\n]*REQ-3/);
  const split = sectionOf(tracks, '## Splitting a plan that holds a log');
  assert.match(split, /Ask first/);
  assert.match(split, /Never delete/);
  assert.match(split, /checkbox tasks stay in `plan.md`|Phases and the checkbox tasks stay/);
  assert.match(split, /not a log: never split a plan for having many tasks/);
});

test('the plan lane guides (skill and bundled) and SKILL.md name the contract; the other lane guides carry the one-line rule', () => {
  const plan = read('.claude/skills/laneconductor/lanes/plan.md');
  assert.match(sectionOf(plan, '## Where things go'), /history\.md/);
  assert.match(plan, /task tracker/);
  assert.match(plan, /Splitting a plan that holds a log/);
  const bundled = read('connector/guides/plan.md');
  assert.match(bundled, /What goes in each track file/);
  assert.match(bundled, /task tracker/);
  assert.match(bundled, /history\.md/);
  assert.match(read('.claude/skills/laneconductor/SKILL.md'), /## What goes in each track file[\s\S]*task tracker[\s\S]*ops\/tracks\.md/);
  for (const lane of ['implement', 'review', 'quality-gate', 'merge', 'brainstorm']) {
    assert.match(read(`.claude/skills/laneconductor/lanes/${lane}.md`), /history\.md/, `lanes/${lane}.md`);
    assert.match(read(`connector/guides/${lane}.md`), /history\.md/, `guides/${lane}.md`);
  }
});

test('the scaffold\'s workflow.md template (skill text and generator) carries the contract', () => {
  const template = sectionOf(read('.claude/skills/laneconductor/setup/templates.md'), '## What goes in each track file').replace(/```[\s\S]*$/, '');
  const generated = read('connector/src/newproject/scaffold.mjs');
  const rendered = [...Array(1)].map(() => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-tf-wf-'));
    cleanup.push(dir);
    writeScaffold(dir, { name: 'Demo', summary: 'A demo project.' }, { gitInit: false, firstTrack: false });
    return fs.readFileSync(path.join(dir, 'conductor/workflow.md'), 'utf8');
  })[0];
  for (const text of [template, rendered]) {
    for (const f of FILES) assert.ok(text.includes(`\`${f}\``), `${f}`);
    assert.match(text, /task tracker/);
    assert.match(text, /never go into `plan.md` or `spec.md`/);
    assert.match(text, /quality gate tick the acceptance criteria of `spec.md`; the implementing agent ticks the tasks of `plan.md`[^\n]*REQ-3/);
    assert.ok(!/high-level/i.test(text));
  }
  assert.ok(generated.includes('## What goes in each track file'));
});

test('the shipped base text has no daemon-era words, no `lc` command and no track number in the contract sections', () => {
  const BAD = /make install|laneconductorrc|\bworkers?\b|collection|daemon/i;
  const texts = [
    sectionOf(read('.claude/skills/laneconductor/ops/tracks.md'), '## What goes in each track file'),
    sectionOf(read('.claude/skills/laneconductor/ops/tracks.md'), '## Splitting a plan that holds a log'),
    sectionOf(read('.claude/skills/laneconductor/lanes/plan.md'), '## Where things go'),
    sectionOf(read('.claude/skills/laneconductor/SKILL.md'), '## What goes in each track file'),
    sectionOf(read('.claude/skills/laneconductor/setup/templates.md'), '## What goes in each track file'),
  ];
  for (const t of texts) {
    assert.ok(!BAD.test(t), t.match(BAD)?.[0]);
    assert.deepEqual(noLcHits(t), []);
    assert.ok(!/\b10\d\d\d\b/.test(t), 'no track number');
  }
});

test('the generated commands carry the contract: the plan lane and run command include both sections; the built base plugin is Markdown only', () => {
  const built = buildPlugin(REPO, 'base');
  const files = new Map([...(built.files ?? built)].map(([rel, f]) => [rel, String((f.content ?? f).toString())]));
  const pick = (name) => [...files].find(([rel]) => rel.endsWith(`commands/${name}.md`))?.[1] ?? '';
  for (const name of ['plan', 'run', 'new']) {
    const text = pick(name);
    assert.ok(text.includes('What goes in each track file'), `${name} command`);
    assert.ok(/task tracker/i.test(text), `${name} command: plan.md is the task tracker`);
  }
  assert.ok(pick('plan').includes('Splitting a plan that holds a log'));
});
