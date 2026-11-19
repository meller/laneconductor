// Private tracks (owner direction, 2026-11-19: "cut it, you can declare it but not ask about it").
// Setup never asks "committed or private": it decides from facts and declares it. Private adds THREE lines to .gitignore (the tracks, the summary of every
// track's title and phase, the advice log: with only the tracks ignored the summary and the log were still committed, which would publish plan titles of a
// public repository). The connector, when every path a write would commit is git-ignored, writes the files, skips the commit and says so, never an error.
// HUMAN, not covered here: that a real client follows the declared line (checked by a headless run, see the track conversation).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, rm, writeFile } from './helpers/repo.mjs';
import { GITIGNORE_LINES, PRIVATE_GITIGNORE_LINES, mergeGitignore, normalizeAnswers, writeScaffold } from '../src/newproject/scaffold.mjs';
import { decideTracks, detectProject } from '../src/newproject/detect.mjs';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-private-'));
  cleanup.push(d);
  return d;
};
const repoWith = (files = {}, { remote = false } = {}) => {
  const d = tmp();
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  for (const [rel, content] of Object.entries(files)) writeFile(d, rel, content);
  if (remote) git(d, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
  return d;
};
const THREE = ['conductor/tracks/', 'conductor/tracks-summary.md', 'conductor/advice-log/'];

// ---- the rule: decided from facts, never asked ----

test('private tracks add exactly three .gitignore lines, only the ones missing, after the three of every project', () => {
  assert.deepEqual(PRIVATE_GITIGNORE_LINES, THREE);
  assert.equal(mergeGitignore(null), `${GITIGNORE_LINES.join('\n')}\n`, 'committed tracks: the three base lines, as before');
  assert.equal(mergeGitignore(null, { tracks: 'private' }), `${[...GITIGNORE_LINES, ...THREE].join('\n')}\n`);
  assert.equal(mergeGitignore(`dist/\nconductor/tracks/\n`, { tracks: 'private' }), `dist/\nconductor/tracks/\n${[...GITIGNORE_LINES, 'conductor/tracks-summary.md', 'conductor/advice-log/'].join('\n')}\n`, 'only the missing ones');
  assert.equal(mergeGitignore([...GITIGNORE_LINES, ...THREE].join('\n'), { tracks: 'private' }), null, 'nothing missing, nothing written');
  assert.equal(normalizeAnswers({ name: 'a', summary: 'b', tracks: 'Private' }).tracks, 'private');
  assert.equal(normalizeAnswers({ name: 'a', summary: 'b' }).tracks, 'committed', 'the default is the old behaviour');
});

test('decideTracks: private on a public sign (README, open-source LICENSE, package.json licence) or with no remote; committed with a remote and no sign', () => {
  const sign = (r) => assert.equal(r.mode, 'private');
  sign(decideTracks(repoWith({ 'README.md': '# x\n\nThis is a public demo.\n' }, { remote: true })));
  assert.match(decideTracks(repoWith({ 'README.md': '# x\n\nThis is a public demo.\n' }, { remote: true })).reason, /README\.md says this is public/);
  sign(decideTracks(repoWith({ 'README.md': '# x\n\nAn open-source tool.\n' }, { remote: true })));
  const lic = decideTracks(repoWith({ LICENSE: 'MIT License\n\nCopyright (c) 2026\n' }, { remote: true }));
  assert.equal(lic.mode, 'private');
  assert.match(lic.reason, /LICENSE is an open-source licence/);
  const pkg = decideTracks(repoWith({ 'package.json': '{"name":"x","license":"MIT"}' }, { remote: true }));
  assert.equal(pkg.mode, 'private');
  assert.match(pkg.reason, /package\.json says the licence is MIT/);
  assert.equal(decideTracks(repoWith({ 'package.json': '{"name":"x","license":"UNLICENSED"}' }, { remote: true })).mode, 'committed', 'UNLICENSED is not a public sign');
  assert.equal(decideTracks(repoWith({ 'package.json': '{"name":"x","license":"proprietary"}' }, { remote: true })).mode, 'committed');
  const none = decideTracks(repoWith({ 'README.md': '# x\n\nAn internal service.\n' }));
  assert.equal(none.mode, 'private');
  assert.match(none.reason, /no remote yet, so there is nothing to share/);
  const shared = decideTracks(repoWith({ 'README.md': '# x\n\nAn internal service.\n' }, { remote: true }));
  assert.equal(shared.mode, 'committed');
  assert.equal(decideTracks(tmp()).mode, 'private', 'a folder that is not a repository has no remote');
});

test('detectProject carries the decision in its answers and its evidence; writeScaffold with private tracks writes the three lines', () => {
  const dir = repoWith({ 'README.md': '# demo\n\nA public demo.\n', 'package.json': '{"name":"demo","scripts":{}}' });
  const d = detectProject(dir);
  assert.equal(d.answers.tracks, 'private');
  assert.ok(d.evidence.some((e) => /^tracks private \(git-ignored\): the README\.md says this is public$/.test(e)));
  writeScaffold(dir, d.answers, { firstTrack: false });
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n');
  for (const l of [...GITIGNORE_LINES, ...THREE]) assert.ok(gi.includes(l), l);
  const shared = repoWith({ 'README.md': '# svc\n\nAn internal service.\n' }, { remote: true });
  writeScaffold(shared, detectProject(shared).answers, { firstTrack: false });
  assert.deepEqual(fs.readFileSync(path.join(shared, '.gitignore'), 'utf8').trimEnd().split('\n'), GITIGNORE_LINES, 'committed tracks: only the three base lines');
});

// ---- the connector: every path ignored means write, do not commit, say so ----

const open = async (dir) => {
  const s = await connect(dir);
  sessions.push(s);
  return s;
};
const privateRepo = () => {
  const dir = makeRepo({ files: { '.gitignore': `${THREE.join('\n')}\n` } });
  cleanup.push(dir);
  return dir;
};
const head = (dir) => git(dir, 'rev-parse', 'HEAD');

test('create_track, update_track and append_conversation in a repository that ignores the tracks, the summary and the advice log: files written, no commit, a warning, no error', async () => {
  const dir = privateRepo();
  const before = head(dir);
  const s = await open(dir);
  const c = await s.call('create_track', { title: 'Private plan', problem: 'A plan title that must not reach a public repository.', track_kind: 'feature' });
  assert.equal(c.isError, false, JSON.stringify(c.env.error));
  assert.equal(c.env.data.commit, null);
  assert.ok(c.env.warnings.some((w) => /not committed/i.test(w) && /gitignored/.test(w)), JSON.stringify(c.env.warnings));
  assert.equal(head(dir), before, 'no commit was made');
  const folder = c.env.data.folder ?? c.env.data.track?.folder;
  const rel = `conductor/tracks/${folder}`;
  assert.ok(fs.existsSync(path.join(dir, rel, 'index.md')), 'the files are written');

  const g = await s.call('get_track', { track: String(c.env.data.number ?? c.env.data.track?.number) });
  assert.equal(g.isError, false, JSON.stringify(g.env.error));
  const u = await s.call('update_track', { track: String(c.env.data.number ?? c.env.data.track?.number), base: g.env.data.base, markers: { Progress: '10%' } });
  assert.equal(u.isError, false, JSON.stringify(u.env.error));
  assert.equal(u.env.data.commit, null);
  assert.ok(u.env.warnings.some((w) => /NOT committed/i.test(w) && /gitignored/.test(w)), JSON.stringify(u.env.warnings));
  assert.match(fs.readFileSync(path.join(dir, rel, 'index.md'), 'utf8'), /\*\*Progress\*\*: 10%/);

  const a = await s.call('append_conversation', { track: String(c.env.data.number ?? c.env.data.track?.number), author: 'claude', body: 'a private note' });
  assert.equal(a.isError, false, JSON.stringify(a.env.error));
  assert.equal(a.env.data.commit, null);
  assert.ok(a.env.warnings.some((w) => /not committed/i.test(w)));

  assert.equal(head(dir), before, 'still no commit after the three writes');
  const tracked = git(dir, 'ls-files', 'conductor').split('\n').filter(Boolean);
  assert.ok(!tracked.some((f) => /tracks-summary|advice-log|conductor\/tracks\/AM-/.test(f)), `nothing private is tracked: ${tracked.join(', ')}`);
  assert.equal(git(dir, 'status', '--porcelain', '--', 'conductor'), '', 'and nothing is left to commit by mistake');
});

test('with the tracks ignored but the summary not, a write commits only the paths that are not ignored (the case the three lines prevent)', async () => {
  const dir = makeRepo({ files: { '.gitignore': 'conductor/tracks/\n' } });
  cleanup.push(dir);
  const s = await open(dir);
  const before = head(dir);
  const c = await s.call('create_track', { title: 'Half private', problem: 'p', track_kind: 'feature' });
  assert.equal(c.isError, false, JSON.stringify(c.env.error));
  const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  assert.ok(files.every((f) => !f.startsWith('conductor/tracks/')), `no ignored track file is committed: ${files.join(', ')}`);
  assert.notEqual(head(dir), before, 'the non-ignored path (the summary) is committed alone: why setup adds the summary and the log to .gitignore too');
});

// ---- the texts ----

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const read = (p) => fs.readFileSync(p, 'utf8');
const NEW_PROJECT = read(path.join(SRC, 'ops/new-project.md'));
const SETUP = read(path.join(SRC, 'setup/setup.md'));
const SKILL = read(path.join(SRC, 'SKILL.md'));
const cmd = (n) => read(path.join(REPO, RELS.base, `commands/${n}.md`));

test('setup and new-project never ask: they declare one line in the closing message, name the rule, the three lines and the way back', () => {
  // Release 1.9.5: the confirmation message is gone (setup writes first), so the declared choice is a line of the ONE closing message.
  for (const [name, text] of [['setup/setup.md + ops/new-project.md', `${SETUP}\n${NEW_PROJECT}`], ['commands/setup.md', cmd('setup')]]) {
    assert.match(text, /The tracks choice, declared and never asked: private when something says the project is public \(the README says public, public demo or open source; an open-source LICENSE file; a `package\.json` `license` other than UNLICENSED or proprietary\) or `git remote` is empty/, name);
    assert.match(text, /Tracks are committed with the code\. Say 'make tracks private' to keep them out of git\./, name);
    assert.match(text, /Tracks are private \(git-ignored\) because .+ Say 'commit my tracks' to share them\./, name);
    for (const l of THREE) assert.ok(text.includes(`\`${l}\``), `${name}: ${l}`);
    assert.doesNotMatch(text, /committed with the code, or private/, `${name}: the old question is gone`);
  }
  // a brand-new project: no remote to share with, so private, declared in the closing message and never asked
  for (const [name, text] of [['ops/new-project.md', NEW_PROJECT], ['commands/new-project.md', cmd('new-project')]]) {
    assert.match(text, /decided from facts and declared in the closing message, never asked: the project looks public, or has no remote to share with/, name);
    assert.match(text, /Tracks are private \(git-ignored\): there is no remote to share them with\. Say 'commit my tracks' to share them\./, name);
    for (const l of THREE) assert.ok(text.includes(`\`${l}\``), `${name}: ${l}`);
  }
  assert.match(SETUP, /The tracks choice, declared and never asked/);
});

test('the base skill carries the short rule for the plain sentence later: private adds the three lines and offers `git rm -r --cached` (shown, not run); committed removes them after asking', () => {
  const at = SKILL.indexOf('**Private or committed tracks.**');
  assert.ok(at >= 0);
  const rule = SKILL.slice(at).split('\n\n')[1] ? `${SKILL.slice(at).split('\n\n')[0]}` : '';
  assert.match(rule, /"Make tracks private"/);
  assert.match(rule, /"Commit my tracks"/);
  for (const l of THREE) assert.ok(rule.includes(`\`${l}\``), l);
  assert.match(rule, /`git rm -r --cached`/);
  assert.match(rule, /never run it without a yes/);
  assert.match(rule, /show the diff and ask before editing `\.gitignore`/);
  assert.ok(rule.split('\n').length <= 4, 'three lines, one paragraph');
  assert.ok(!cmd('setup').includes('**Private or committed tracks.**'), 'the rule is in the skill, not in every command');
});
