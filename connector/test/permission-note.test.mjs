// Track AM-10132: the base says, in one line, which option to choose when the client asks about reading a plugin file; setup shows everything
// in ONE pre-filled message ("Reply ok, or tell me what differs") and writes nothing until the reply. The base declares no pre-approved tools
// (allowed-tools was evaluated and is NOT shipped: an unscoped Read would also pre-approve reads outside the plugin folder).
// HUMAN, not covered here: whether a real client still shows the prompt (a real session is the only judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');

test('the README, setup, new-project and the setup command carry the one-line note: choose the one-time option, the permanent ones are not needed', () => {
  for (const rel of ['README.md', 'skills/laneconductor/setup/setup.md', 'skills/laneconductor/ops/new-project.md', 'commands/setup.md']) {
    const t = read(rel);
    assert.match(t, /allows it this one time/, rel);
    assert.match(t, /keep allowing/, rel);
    assert.match(t, /permanent setting/, rel);
  }
  assert.match(read('commands/setup.md'), /Never ask anyone to change their permission settings/);
  assert.match(read('skills/laneconductor/setup/setup.md'), /Never ask anyone to change their permission settings/);
});

// UPDATED for release 1.9.5 (tracks AM-10130 Phase 7 and AM-10144 Phase 12): this replaces the earlier rule of track AM-10132 TC-2 (one pre-filled message
// ending "Reply ok, or tell me what differs", nothing written before the reply) for the first-run path. Setup now writes FIRST: `go` to the card of
// `next`, or a direct /laneconductor:setup, is the yes; the files are new and one line undoes them. It asks first only for something unusual,
// and shows ONE closing message (what it created, the declared tracks line, the undo line, the plan found), then two offers and one question.
test('the setup flow writes first: no pre-write confirmation, ONE closing message with the private tracks line and an undo line, a question only for something unusual', () => {
  for (const rel of ['commands/setup.md', 'skills/laneconductor/setup/setup.md']) {
    const t = read(rel);
    assert.doesNotMatch(t, /Reply ok, or tell me what differs/, `${rel}: no pre-write confirmation`);
    assert.doesNotMatch(t, /[Ww]rite nothing until that reply/, rel);
    assert.match(t, /no confirmation (first|before the files)/, `${rel}: writes first`);
    assert.match(t, /ONE message/, rel);
    assert.match(t, /private/, rel);
    assert.match(t, /Undo: `rm -r conductor`, then `git checkout \.gitignore`\./, `${rel}: the undo line`);
    assert.match(t, /Stop and ask first, one line each, only for something unusual/, rel);
    for (const unusual of ['a `conductor/` folder with content', 'no git repository', 'uncommitted changes in `.gitignore`']) assert.ok(t.includes(unusual), `${rel}: ${unusual}`);
  }
  const np = read('skills/laneconductor/ops/new-project.md');
  assert.doesNotMatch(np, /Reply ok, or tell me what differs/);
  assert.match(np, /ONE message/);
});

test('no shipped skill or command declares allowed-tools (evaluated, not shipped)', () => {
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) assert.doesNotMatch(read(`commands/${f}`).split('\n---\n')[0], /^allowed-tools:/m, f);
  assert.doesNotMatch(read('skills/laneconductor/SKILL.md').split('\n---\n')[0], /allowed-tools/);
});
