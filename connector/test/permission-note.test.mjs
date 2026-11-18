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
  assert.match(read('commands/setup.md'), /Never ask me to change my permission settings/);
  assert.match(read('skills/laneconductor/setup/setup.md'), /Never ask anyone to change their permission settings/);
});

test('the setup interview is one message, pre-filled, with the private tracks option, "Reply ok, or tell me what differs", nothing written before', () => {
  for (const rel of ['commands/setup.md', 'skills/laneconductor/setup/setup.md', 'skills/laneconductor/ops/new-project.md']) {
    const t = read(rel);
    assert.match(t, /ONE message/, rel);
    assert.match(t, /Reply ok, or tell me what differs/, rel);
    assert.match(t, /private/, rel);
    assert.match(t, /write nothing until/i, rel);
  }
});

test('no shipped skill or command declares allowed-tools (evaluated, not shipped)', () => {
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) assert.doesNotMatch(read(`commands/${f}`).split('\n---\n')[0], /^allowed-tools:/m, f);
  assert.doesNotMatch(read('skills/laneconductor/SKILL.md').split('\n---\n')[0], /allowed-tools/);
});
