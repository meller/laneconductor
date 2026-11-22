// Track AM-10156: the base `deploy` text (Markdown only, no script) says what connector/src/deploys.mjs computes. Text-level proof for the
// record, status, history, rollback, failure recovery and release notes; the logic itself is in deploys.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REQUIRED_KEYS, lintRecord, parseRecord } from '../src/deploys.mjs';
import { COMMANDS } from '../src/commands.mjs';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const DEPLOY = read('.claude/skills/laneconductor/deploy/deploy.md');
const SETUP = read('.claude/skills/laneconductor/deploy/setup-deploy.md');
const flat = (s) => s.replace(/\s+/g, ' ');
const section = (name) => {
  const m = new RegExp(`^## ${name}.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(DEPLOY);
  assert.ok(m, `deploy.md has a section ${name}`);
  return flat(m[1]).trim();
};

test('deploy text: the lane guide parts other tests rely on are still there', () => {
  assert.match(DEPLOY, /^# deploy `\[env\]`/);
  assert.match(DEPLOY, /Run only when the user asks for it by name\./);
  assert.match(DEPLOY, /Before step 1, offer the stack's deploy pack if it is missing/);
  assert.match(DEPLOY, /^1\. Read `conductor\/deploy\.json`\.$/m);
  assert.match(DEPLOY, /<!-- generated: skill offers for this lane -->/);
});

// TC-1
test('TC-1 record: the text writes one record per run, with every field of REQ-1, never a secret; its example passes the lint', () => {
  const t = section('The record');
  assert.match(t, /conductor\/deploys\/<env>-<UTC timestamp>\.md/);
  assert.match(t, /kept in git/);
  const block = /```\n([\s\S]*?)```/.exec(DEPLOY.slice(DEPLOY.indexOf('## The record')))[1];
  for (const k of REQUIRED_KEYS) assert.ok(block.includes(`${k}:`), `the record example has ${k}`);
  assert.deepEqual(block.split('\n').filter(Boolean).map((l) => l.split(':')[0]), REQUIRED_KEYS, 'the same keys in the same order as the lint');
  assert.match(DEPLOY, /^6\. Write the record \(below\), also when the run failed\./m);
  assert.match(t, /never written/);
  assert.match(t, /looks like a token, a password or a key/);
  assert.match(t, /production: yes/);
  assert.match(t, /kind: rollback/);
  assert.match(t, /restored record/);
  // the example, with its placeholders filled in, is a record the lint accepts and the parser reads back
  const filled = block.replace('<short commit>', 'abc1234').replace('<the local build version>', '1.2.3').replace(/<the command[^>]*>/, 'bash infra/deploy.sh prod')
    .replace('success | failed', 'success').replace('<who said yes>', 'the owner').replace(/<file name[^>]*>/, 'none');
  assert.deepEqual(lintRecord(filled).problems, []);
  assert.equal(parseRecord(filled, 'prod-20261122T101500Z.md').version, '1.2.3');
  for (const key of ['rollback', 'service', 'version', 'liveVersionUrl', 'liveVersionField']) assert.ok(DEPLOY.includes(`\`${key}\``), `deploy.json key ${key} is described`);
  // the build version order
  const order = flat(DEPLOY);
  assert.ok(order.indexOf("environment's `version` command") < order.indexOf('the `version` in `package.json`'));
  assert.ok(order.indexOf('the `version` in `package.json`') < order.indexOf('git describe --tags --always'));
});

// TC-2 / TC-11 in words
test('TC-11 status: the read-only steps, the three versions, the comparison order, and "not checked" without liveVersionUrl', () => {
  const t = section('status');
  assert.match(t, /^Read only: no file changes and nothing is deployed\./);
  assert.match(t, /Local build version/);
  assert.match(t, /Last record: the newest record of the environment with `result: success` \(a good rollback counts\)/);
  assert.match(t, /only when the environment sets `liveVersionUrl`, one read-only GET/);
  assert.match(t, /say "the live version is not checked"/);
  assert.match(t, /git rev-list --count <recorded commit>\.\.HEAD/);
  const drift = t.indexOf('drift when the live version differs'), ahead = t.indexOf('else ahead'), sync = t.indexOf('else in sync');
  assert.ok(drift > 0 && ahead > drift && sync > ahead, 'drift, then ahead, then in sync');
  assert.match(t, /ahead of the last deploy by N commits/);
  assert.match(t, /outside the records/);
  assert.match(t, /the live server was not checked/);
  assert.match(t, /No deploy recorded for <env>/);
});

// TC-9
test('TC-9 history: newest first with time, version, commit, result, who and the live mark; a rollback is an entry', () => {
  const t = section('history');
  assert.match(t, /^Read only\./);
  assert.match(t, /newest first.*time, version, commit, result, who approved it, and a mark on the live one/);
  assert.match(t, /A rollback is an entry too/);
  assert.match(t, /failed run is listed as failed/);
});

// TC-3, TC-10
test('TC-3 rollback: a version is chosen (a list and a question without one), the exact command comes first, the yes names environment, version and command', () => {
  const t = section('rollback');
  assert.match(DEPLOY, /^# deploy `\[env\]`, `status \[env\]`, `history \[env\]`, `rollback \[env\] \[version\]`/);
  assert.match(t, /With no version: list the versions as `history` does, only the ones with `result: success`.*and ask which version\. Stop until the answer comes/);
  assert.match(t, /a version, a commit of at least 7 characters or a record file name/);
  assert.match(t, /None: say so, name the versions recorded and stop/);
  assert.ok(t.indexOf('Show the exact command before anything runs') < t.indexOf('Wait for a yes that names the environment, the version and the command'), 'the command is shown before the yes');
  assert.match(t, /"yes, roll back prod to 1\.0\.0 with <command>"/);
  assert.match(t, /A bare "yes" is not enough/);
  assert.match(t, /the environment's `rollback` command, with `\{service\}`, `\{version\}` and `\{commit\}` filled in/);
  assert.match(t, /redeploy that record's commit from a clean checkout: `git worktree add --detach/);
  assert.match(t, /Cloud Run: `gcloud run services update-traffic <service> --to-revisions=<revision>=100`.*\(verified in its help\)/);
  assert.match(t, /Firebase Hosting: redeploy the older commit \(the default\), or `firebase hosting:clone <site>:<channel> <site>:live`.*a console rollback was not verified/);
  assert.match(t, /Ask whether to open a track for the cause with `new`; do not open one unasked/);
});

test('TC-3 safety: git reset and a force push appear only in the sentence that forbids them; every deploy and rollback waits for a yes naming the command', () => {
  const lines = DEPLOY.split('\n');
  for (const [i, l] of lines.entries()) {
    if (/git reset|force push|push --force|push -f|--hard/.test(l)) assert.match(l, /Never `git reset` or a force push on main\./, `line ${i + 1} mentions a reset or a force push outside the never-sentence`);
  }
  assert.equal((DEPLOY.match(/git reset/g) || []).length, 1);
  assert.match(flat(DEPLOY), /wait for a yes that names them/);
  assert.match(flat(DEPLOY), /Nothing here runs from a build step/);
  assert.match(flat(DEPLOY), /Never write a secret into a record, a log or a message/);
  assert.match(flat(DEPLOY), /Show the environment \(say so when it is production\).*the exact command.*and ask/);
  assert.match(flat(DEPLOY), /^.*4\. After the yes, run the command/);
});

// TC-4
test('TC-4 failure: the log tail is read, the failed step is named, a fix is offered, and only that step is re-run after a yes', () => {
  const t = section('When a deploy fails');
  assert.match(t, /^Nothing changes without a yes\./);
  assert.match(t, /Read the last 40 lines of the log \(`tail -n 40`\) and the exit status\. Name the failed step/);
  assert.match(t, /never one that looks like a secret/);
  assert.match(t, /Write the record with `result: failed` and say the live version did not change/);
  assert.match(t, /After a yes, apply it and re-run only the failed step, not the steps before it that succeeded/);
  assert.match(t, /stop after one more attempt.*offer `rollback`/);
  assert.match(flat(DEPLOY), /When it failed, follow "When a deploy fails"/);
});

// TC-5
test('TC-5 release notes: the tracks finished since the previous good record, from their history, no model', () => {
  const t = section('Shipped since the last deploy');
  assert.match(t, /^Plain Markdown, no model\./);
  assert.match(t, /newest record of the environment with `result: success` \(none: every finished track\)/);
  assert.match(t, /whose `\*\*Lane\*\*` is `done`.*last dated line of its `history\.md`/);
  assert.match(t, /a date alone counts to the end of that day/);
  assert.match(t, /oldest first, as `- <id>: <title> \(<date>\)`/);
  assert.match(t, /a done track with no dated line is named apart, not guessed/);
});

test('setup-deploy: asks for the optional keys, the deploys folder and the live version, still never a secret', () => {
  const s = flat(SETUP);
  for (const k of ['rollback', 'service', 'version', 'liveVersionUrl']) assert.ok(s.includes(`\`${k}\``), `${k} is asked for`);
  assert.match(s, /conductor\/deploys\//);
  assert.match(s, /never asks for or reads a secret/);
  assert.ok(!/https?:\/\/(?!example\.com|localhost)/.test(SETUP), 'only example hosts');
});

test('the deploy command names the subcommands in its argument hint and its text', () => {
  const c = COMMANDS.find((x) => x.name === 'deploy');
  assert.match(c.args[0].hint, /status/);
  assert.match(c.args[0].hint, /rollback/);
  assert.match(c.args[0].hint, /history/);
  assert.match(c.args[0].description, /`status`.*`history`.*`rollback`/);
  assert.match(c.procedure, /`deploy\/deploy\.md`/);
  assert.match(c.procedure, /never deploy or roll back without my yes/);
});

// TC-7: the base plugin stays Markdown only for this track
test('TC-7 the base plugin has no script added: only text, JSON and the icon ship', () => {
  const root = path.join(REPO, 'plugins/laneconductor');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = walk(root).filter((f) => !/\.(md|json|png)$/.test(f) && !/\/LICENSE$/.test(f));
  assert.deepEqual(bad.map((f) => path.relative(root, f)), []);
  assert.ok(!walk(root).some((f) => /deploys\.mjs$/.test(f)), 'the logic module ships with the add-ons, not the base');
});
