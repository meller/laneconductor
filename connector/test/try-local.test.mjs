// scripts/try-local.sh (track AM-10128 Phase 5 Task 3): adds THIS repository as a local marketplace, installs the three plugins at local
// scope into a scratch git repository, prints what to type. It must print every command before running it, refuse anything that could be a
// real project, and never touch the user's configuration in these tests: a fake `claude` on PATH records what would have run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';

const SCRIPT = path.join(REPO, 'scripts/try-local.sh');
const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });
const mk = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };

/** A fake `claude`: `plugin marketplace list` prints `listing`; every other call prints RAN <args> and appends cwd + args to the log. */
function fakeClaude(listing = 'Configured marketplaces:\n') {
  const bin = mk('lc-fake-claude-');
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
if [ "$1 $2 $3" = "plugin marketplace list" ]; then cat <<'EOF'
${listing}EOF
exit 0; fi
echo "RAN $*"
echo "$PWD | $*" >> "${log}"
`, { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}
const run = (args, { claude, env = {} } = {}) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${claude?.bin ?? ''}:${process.env.PATH}`, ...env } });

test('the script is executable bash with valid syntax and documents itself', () => {
  assert.ok((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'executable');
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /adds THIS repository as a LOCAL marketplace/);
  assert.equal(run([]).status, 2, 'a scratch path is required');
  assert.match(run(['--nope', 'x']).stderr, /unknown option/);
});

test('dry run prints every command in order, creates nothing and runs no claude command', () => {
  const claude = fakeClaude();
  const scratch = path.join(mk('lc-dry-'), 'scratch');
  const r = run(['--dry-run', scratch], { claude });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(scratch), 'nothing was created');
  assert.deepEqual(claude.calls(), [], 'no claude command ran');
  const order = [
    `+ mkdir -p ${scratch}/conductor/tracks`, `git init -q -b main`, 'git add conductor/workflow.json conductor/tracks/.gitkeep .lc-scratch',
    `claude plugin marketplace add ${REPO} --scope local`,
    'claude plugin install laneconductor@laneconductor --scope local',
    'claude plugin install laneconductor-parallel@laneconductor --scope local',
    'claude plugin install laneconductor-board@laneconductor --scope local',
  ];
  let at = -1;
  for (const o of order) { const i = r.stdout.indexOf(o); assert.ok(i > at, `"${o}" missing or out of order in:\n${r.stdout}`); at = i; }
  assert.match(r.stdout, /DRY RUN: the commands below are printed, not run\./);
  for (const must of ['/laneconductor:help', '/mcp', '/laneconductor:board', 'plugin:laneconductor-parallel:lc', 'rm -rf', 'claude plugin marketplace remove laneconductor']) assert.ok(r.stdout.includes(must), `what to type mentions ${must}`);
  assert.match(r.stdout, /Undo \(commands to run yourself; the script never runs them\)/);
});

test('a real run (fake claude) prints each command right before running it, in the scratch repository, at local scope', () => {
  const claude = fakeClaude();
  const scratch = path.join(mk('lc-run-'), 'scratch');
  const r = run([scratch], { claude });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(fs.existsSync(path.join(scratch, '.lc-scratch')) && fs.existsSync(path.join(scratch, 'conductor/workflow.json')), 'the scratch repository was made');
  assert.equal(execFileSync('git', ['-C', scratch, 'log', '--format=%s'], { encoding: 'utf8' }).trim(), 'scratch repository for trying LaneConductor');
  assert.deepEqual(claude.calls().map((c) => c.split(' | ')[1]), [
    `plugin marketplace add ${REPO} --scope local`,
    'plugin install laneconductor@laneconductor --scope local',
    'plugin install laneconductor-parallel@laneconductor --scope local',
    'plugin install laneconductor-board@laneconductor --scope local',
  ]);
  for (const c of claude.calls()) assert.equal(c.split(' | ')[0], scratch, 'every claude command ran inside the scratch repository');
  const lines = r.stdout.split('\n');
  lines.forEach((l, i) => { if (l.startsWith('RAN ')) assert.ok(lines[i - 1].includes(`claude ${l.slice(4)}`), `"${l}" was not printed right before it ran: ${lines[i - 1]}`); });
  assert.equal(lines.filter((l) => l.startsWith('RAN ')).length, 4);
});

test('it refuses this repository, a path inside it, a non-git folder, a repository outside the temp folder without the marker, and a clashing marketplace name', () => {
  const claude = fakeClaude();
  const refused = (args, opts, why) => { const r = run(args, { claude, ...opts }); assert.notEqual(r.status, 0, `${args}: ${r.stdout}`); assert.match(r.stderr, why); assert.deepEqual(claude.calls(), [], 'nothing ran'); return r; };
  refused([REPO], {}, /is this repository/);
  refused([path.join(REPO, 'plugins/x')], {}, /is this repository/);
  const plain = mk('lc-plain-');
  refused([plain], {}, /not a git repository/);
  // A real-looking git repository that is not under the temp folder (TMPDIR points elsewhere) and has no marker.
  const proj = mk('lc-realish-');
  execFileSync('git', ['-C', proj, 'init', '-q']);
  const otherTmp = mk('lc-othertmp-');
  refused([proj], { env: { TMPDIR: otherTmp } }, /not under .* and has no \.lc-scratch marker/);
  refused([path.join(proj, 'nested')], { env: { TMPDIR: otherTmp } }, /not under .* a new scratch repository is only made under the system temp folder/);
  // With the marker it is accepted (a dry run is enough to see that).
  fs.writeFileSync(path.join(proj, '.lc-scratch'), 'x');
  assert.equal(run(['--dry-run', proj], { claude, env: { TMPDIR: otherTmp } }).status, 0);
  // A marketplace of the same name from another source: stop before adding, say how to remove it, never run the removal.
  const clash = fakeClaude('Configured marketplaces:\n\n  ❯ laneconductor\n    Source: GitHub (meller/laneconductor)\n');
  const scratch = path.join(mk('lc-clash-'), 'scratch');
  const r = run([scratch], { claude: clash });
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stdout, /WARNING: a marketplace named laneconductor is already configured from another source/);
  assert.match(r.stderr, /pass --allow-name-clash/);
  assert.ok(!clash.calls().some((c) => c.includes('marketplace add')), 'the local marketplace was not added');
  assert.ok(!clash.calls().some((c) => c.includes('marketplace remove')), 'the old marketplace was not removed');
});
