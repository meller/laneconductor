// scripts/try-local.sh (track AM-10128 Phase 5 Task 3): exports a copy of THIS repository at HEAD, renames the copy's marketplace to
// laneconductor-try (the real `laneconductor` marketplace is never touched), adds the copy as a local marketplace, installs the three plugins
// at local scope into a scratch git repository, prints what to type. It must print every command before running it, refuse anything that could be a
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
// The script puts its marketplace copy at <tmp>/lc-try-marketplace-<basename of the scratch path>.
const copyOf = (scratch) => { const c = path.join(real, `lc-try-marketplace-${path.basename(scratch)}`); cleanup.push(c); return c; };

/** What `claude plugin list --json` prints for an owner who has the real all-in-one plugin enabled at user scope (and some other plugins). */
const LIST = (scratch = '/nowhere') => JSON.stringify([
  { id: 'laneconductor@laneconductor', version: '0.5.0', scope: 'user', enabled: true },
  { id: 'laneconductor@laneconductor', version: '0.3.0', scope: 'local', enabled: true, projectPath: '/some/other/project' },
  { id: 'laneconductor-parallel@laneconductor', version: '0.5.0', scope: 'user', enabled: true },
  { id: 'laneconductor-board@laneconductor', version: '0.5.0', scope: 'user', enabled: false },
  { id: 'laneconductor@laneconductor-try', version: '1.0.0', scope: 'local', enabled: true, projectPath: scratch },
  { id: 'laneconductor@elsewhere', version: '1.0.0', scope: 'project', enabled: true, projectPath: '/some/other/project' },
  { id: 'firebase@claude-plugins-official', version: '1', scope: 'user', enabled: true },
  { id: 'laneconductor-extras@laneconductor', version: '1', scope: 'user', enabled: true },
]);

/**
 * A fake `claude`: `plugin marketplace list` prints `listing`; `plugin list --json` prints `listJson` (or fails with exit 1 when it is null);
 * every other call prints RAN <args> and appends cwd + args to the log. Nothing here can touch a real configuration.
 */
function fakeClaude(listing = 'Configured marketplaces:\n', listJson = LIST()) {
  const bin = mk('lc-fake-claude-');
  const log = path.join(bin, 'calls.log');
  const json = path.join(bin, 'list.json');
  if (listJson !== null) fs.writeFileSync(json, listJson);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
if [ "$1 $2 $3" = "plugin marketplace list" ]; then cat <<'EOF'
${listing}EOF
exit 0; fi
if [ "$1 $2 $3" = "plugin list --json" ]; then [ -f "${json}" ] && cat "${json}" && exit 0; exit 1; fi
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
  assert.match(help.stdout, /renames its marketplace to laneconductor-try/);
  assert.equal(run([]).status, 2, 'a scratch path is required');
  assert.match(run(['--nope', 'x']).stderr, /unknown option/);
});

test('dry run prints every command in order, creates nothing and runs no claude command', () => {
  const claude = fakeClaude();
  const scratch = path.join(mk('lc-dry-'), 'scratch');
  const r = run(['--dry-run', scratch], { claude });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(scratch) && !fs.existsSync(copyOf(scratch)), 'nothing was created');
  assert.deepEqual(claude.calls(), [], 'no claude command ran');
  const order = [
    `+ mkdir -p ${scratch}/conductor/tracks`, `git init -q -b main`, 'git add conductor/workflow.json conductor/tracks/.gitkeep .lc-scratch',
    `git -C ${REPO} archive HEAD | tar -x -C ${copyOf(scratch)}`, `sed -i `, `claude plugin marketplace add ${copyOf(scratch)} --scope local`,
    'claude plugin install laneconductor@laneconductor-try --scope local',
    'claude plugin install laneconductor-parallel@laneconductor-try --scope local',
    'claude plugin install laneconductor-board@laneconductor-try --scope local',
    // Step 4: only the enabled, same-named plugins of OTHER marketplaces that apply to this repository (user scope), at local scope.
    'claude plugin disable laneconductor-parallel@laneconductor --scope local',
    'claude plugin disable laneconductor@laneconductor --scope local',
  ];
  let at = -1;
  for (const o of order) { const i = r.stdout.indexOf(o); assert.ok(i > at, `"${o}" missing or out of order in:\n${r.stdout}`); at = i; }
  assert.match(r.stdout, /DRY RUN: the commands below are printed, not run\./);
  for (const must of ['/laneconductor:help', '/mcp', '/laneconductor:board', 'plugin:laneconductor-parallel:lc', 'rm -rf', 'claude plugin marketplace remove laneconductor-try', 'claude plugin uninstall laneconductor-board@laneconductor-try --scope local', 'Your real laneconductor marketplace and installed plugins were not touched.']) assert.ok(r.stdout.includes(must), `what to type mentions ${must}`);
  assert.match(r.stdout, /Undo \(commands to run yourself; the script never runs them\)/);
  // The disable is printed with the scratch repository as its working folder, only at local scope, and never for what must stay enabled.
  for (const d of r.stdout.split('\n').filter((l) => l.includes('plugin disable'))) {
    assert.ok(d.startsWith(`+ (cd ${scratch} && claude plugin disable `), `runs inside the scratch repository: ${d}`);
    assert.ok(d.endsWith(' --scope local)'), `local scope only: ${d}`);
  }
  assert.equal(r.stdout.split('\n').filter((l) => l.includes('plugin disable')).length, 2, 'two ids are disabled: the all-in-one and the parallel plugin of the real marketplace');
  for (const keep of ['laneconductor-board@laneconductor ', 'laneconductor@laneconductor-try --scope local --', 'laneconductor@elsewhere', 'firebase', 'laneconductor-extras', '--scope user', '--scope project']) assert.ok(!r.stdout.split('\n').some((l) => l.includes('plugin disable') && l.includes(keep.trim())), `not disabled: ${keep}`);
  assert.match(r.stdout, /recorded only in .*\.claude\/settings\.local\.json/);
  assert.match(r.stdout, /Deleting the scratch repository \(the last\s+command below\) undoes it/);
  assert.ok(!r.stdout.includes('plugin enable'), 'no enable is needed: deleting the scratch repository is the undo');
});

test('a real run (fake claude) prints each command right before running it, in the scratch repository, at local scope', () => {
  const claude = fakeClaude();
  const scratch = path.join(mk('lc-run-'), 'scratch');
  const r = run([scratch], { claude });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(fs.existsSync(path.join(scratch, '.lc-scratch')) && fs.existsSync(path.join(scratch, 'conductor/workflow.json')), 'the scratch repository was made');
  assert.equal(execFileSync('git', ['-C', scratch, 'log', '--format=%s'], { encoding: 'utf8' }).trim(), 'scratch repository for trying LaneConductor');
  assert.deepEqual(claude.calls().map((c) => c.split(' | ')[1]), [
    `plugin marketplace add ${copyOf(scratch)} --scope local`,
    'plugin install laneconductor@laneconductor-try --scope local',
    'plugin install laneconductor-parallel@laneconductor-try --scope local',
    'plugin install laneconductor-board@laneconductor-try --scope local',
    'plugin disable laneconductor-parallel@laneconductor --scope local',
    'plugin disable laneconductor@laneconductor --scope local',
  ]);
  // The marketplace that was added is a COPY with only its name changed; this repository's own marketplace file is untouched.
  const copy = copyOf(scratch);
  const orig = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
  const renamed = JSON.parse(fs.readFileSync(path.join(copy, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(renamed.name, 'laneconductor-try');
  assert.deepEqual({ ...renamed, name: orig.name }, orig, 'nothing else in the marketplace file changed');
  for (const p of orig.plugins) assert.ok(fs.existsSync(path.join(copy, p.source, '.claude-plugin/plugin.json')), `the copy holds ${p.source}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8')).name, 'laneconductor');
  assert.ok(r.stdout.includes('Your real laneconductor marketplace and installed plugins were not touched.'));
  for (const c of claude.calls()) assert.equal(c.split(' | ')[0], scratch, 'every claude command ran inside the scratch repository');
  const lines = r.stdout.split('\n');
  lines.forEach((l, i) => { if (l.startsWith('RAN ')) assert.ok(lines[i - 1].includes(`claude ${l.slice(4)}`), `"${l}" was not printed right before it ran: ${lines[i - 1]}`); });
  assert.equal(lines.filter((l) => l.startsWith('RAN ')).length, 6);
  assert.ok(!claude.calls().some((c) => /marketplace (remove|update)/.test(c) || / laneconductor( |$)/.test(c.split(' | ')[1] + ' ')) , 'no command names the real laneconductor marketplace');
  // The disables are the ONLY commands that name the owner's real plugins, always at local scope; nothing is uninstalled, enabled or written at user scope.
  const named = claude.calls().map((c) => c.split(' | ')[1]).filter((c) => /@laneconductor( |$)/.test(c));
  assert.deepEqual(named, ['plugin disable laneconductor-parallel@laneconductor --scope local', 'plugin disable laneconductor@laneconductor --scope local']);
  assert.ok(!claude.calls().some((c) => /--scope (user|project)|uninstall|plugin enable/.test(c)), 'no user-scope, project-scope, uninstall or enable command');
  assert.ok(r.stdout.indexOf('plugin disable laneconductor@laneconductor') > r.stdout.indexOf('plugin install laneconductor-board@laneconductor-try'), 'disabled after the installs');
});

test('it refuses this repository, a path inside it, a non-git folder, a repository outside the temp folder without the marker, and a leftover try marketplace', () => {
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
  // The real GitHub marketplace named laneconductor is NOT a clash any more: the copy is named laneconductor-try.
  const real1 = fakeClaude('Configured marketplaces:\n\n  ❯ laneconductor\n    Source: GitHub (meller/laneconductor)\n');
  const s1 = path.join(mk('lc-noclash-'), 'scratch');
  const r1 = run([s1], { claude: real1 });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.equal(real1.calls().length, 6);
  assert.ok(!real1.calls().some((c) => c.includes('marketplace remove')), 'the real marketplace is never removed');
  // A leftover laneconductor-try from an earlier try: stop before adding, say how to remove it, never run the removal.
  const clash = fakeClaude('Configured marketplaces:\n\n  ❯ laneconductor-try\n    Source: Directory (/tmp/lc-try-marketplace-old)\n');
  const scratch = path.join(mk('lc-clash-'), 'scratch');
  copyOf(scratch);
  const r = run([scratch], { claude: clash });
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stdout, /WARNING: a marketplace named laneconductor-try is already configured/);
  assert.match(r.stderr, /pass --allow-name-clash/);
  assert.ok(!clash.calls().some((c) => c.includes('marketplace add')), 'the local marketplace was not added');
  assert.ok(!clash.calls().some((c) => c.includes('marketplace remove')), 'the old marketplace was not removed');
});

test('step 4 disables nothing when no other laneconductor plugin is enabled, and warns (without failing) when the plugin list cannot be read', () => {
  const none = fakeClaude('Configured marketplaces:\n', JSON.stringify([{ id: 'laneconductor@laneconductor', scope: 'user', enabled: false }, { id: 'firebase@x', scope: 'user', enabled: true }]));
  const s1 = path.join(mk('lc-none-'), 'scratch');
  const r1 = run([s1], { claude: none });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /nothing to disable/);
  assert.equal(none.calls().length, 4, 'marketplace add and three installs only');
  const dry = run(['--dry-run', path.join(mk('lc-none2-'), 'scratch')], { claude: none });
  assert.match(dry.stdout, /nothing to disable/);
  // A list that cannot be read, or is not JSON: a warning that names the manual command, and the run still succeeds.
  for (const listJson of [null, 'not json']) {
    const bad = fakeClaude('Configured marketplaces:\n', listJson);
    const r = run([path.join(mk('lc-bad-'), 'scratch')], { claude: bad });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WARNING: .*claude plugin disable laneconductor@<marketplace> --scope local/);
    assert.ok(!bad.calls().some((c) => c.includes('plugin disable')), 'it guessed nothing');
  }
  // A local-scope plugin of the scratch repository itself (same name, another marketplace) is also disabled; one of another project is not.
  const scratch = path.join(mk('lc-own-'), 'scratch');
  const own = fakeClaude('Configured marketplaces:\n', JSON.stringify([
    { id: 'laneconductor@mine', scope: 'local', enabled: true, projectPath: scratch },
    { id: 'laneconductor-board@mine', scope: 'local', enabled: true, projectPath: '/other' },
  ]));
  const r2 = run([scratch], { claude: own });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.deepEqual(own.calls().map((c) => c.split(' | ')[1]).filter((c) => c.startsWith('plugin disable')), ['plugin disable laneconductor@mine --scope local']);
});
