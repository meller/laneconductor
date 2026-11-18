// Track AM-10124, REQ-12 (owner, 2026-11-18): track context. The base skill has a short soft rule for real work with no track in play, and
// the current track is found one way, written once and used by the base skill, suggest-skills and next. TC-18 to TC-20.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const skillFile = (rel) => read(`skills/laneconductor/${rel}`);
const src = (rel) => fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor', rel), 'utf8');
const baseSkill = () => skillFile('SKILL.md');
const ruleOf = () => { const t = baseSkill(); return t.slice(t.indexOf('## Work without a track'), t.indexOf('## Finding a track')); };

test('TC-18 real work, no track: one sentence and three ways in, plain text, nothing blocked', () => {
  const rule = ruleOf();
  assert.ok(rule.length > 100 && rule.length < 2500, 'a few lines only: the base is a directory plugin');
  assert.match(rule, /real work \(it changes files, or takes more than a quick answer\) and no track is in play, say so in one sentence and offer three ways in, in plain text/);
  assert.match(rule, /update the nearest existing track \(search first: `list_tracks` when the connector tools are there, else the folders under `conductor\/tracks\/`; the default wording is "Update track N\?"\)/);
  assert.match(rule, /create a new track, or go on without a track/);
  assert.match(rule, /Never block: when the work is clearly small, go ahead without asking/);
  assert.ok(!baseSkill().includes('<!-- generated: track context -->'));
  assert.ok(!/\b(AM-\d+|track \d{4,})\b/.test(rule), 'no track number in shipped text');
});

test('TC-19 small things get no offer, "no track" once is the end of it for the session, and nothing is created without a yes', () => {
  const rule = ruleOf();
  assert.match(rule, /Create or change a track only after a yes/);
  assert.match(rule, /A question, reading, a one-line or typo fix gets no offer/);
  assert.match(rule, /"no track" once, or a choice to go on without one, means no more track offers this session/);
  // the source skill does not hold the text by hand: it is one constant of the generator, so it cannot drift between the places that use it
  assert.ok(src('SKILL.md').includes('<!-- generated: track context -->') && !src('SKILL.md').includes('Update track N?'));
});

test('TC-20 the current track: the prompt, a branch named after a track, or the track this session has running; written once and used by the base skill, suggest-skills and next', () => {
  const lookup = /\*\*The current track\*\* is, in this order: the track the person named in the prompt \(a number or a title\); the track a branch is named after \(`git branch --show-current`, for example `track-NNN` or a name holding a track number, matched to its folder under `conductor\/tracks\/`\); the track this session has running \(its `index\.md` says `\*\*Lane Status\*\*: running`, and with the connector `\*\*Run By\*\*` names this client\)\./;
  for (const [label, text] of [['the base skill', baseSkill()], ['ops/suggest-skills.md', skillFile('ops/suggest-skills.md')], ['ops/next.md', skillFile('ops/next.md')], ['the suggest-skills command', read('commands/suggest-skills.md')], ['the next command', read('commands/next.md')]]) {
    assert.match(text, lookup, label);
    assert.equal(text.split('**The current track** is, in this order').length - 1, 1, `${label}: written once`);
    assert.match(text, /With one in play, the work follows its lane, `\*\*Type\*\*`, stack and skill offers; with none, skill offers go by the project's stack only, and there is no KPI block to write \(that belongs to a marketing or sales track\)\./, label);
  }
  for (const lane of ['plan', 'implement', 'review', 'quality-gate', 'merge', 'brainstorm']) assert.match(skillFile(`lanes/${lane}.md`), /The track is the one this command names, so its lane, `\*\*Type\*\*` and stack are known\./, lane);
  // no marker is left anywhere in the shipped base
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(BASE).filter((x) => x.endsWith('.md'))) assert.ok(!/<!-- generated: (current track|track context|skill )/.test(fs.readFileSync(f, 'utf8')), `${path.relative(BASE, f)}: a marker is left`);
});
