// Track AM-10132, second step: every other command that points at skill files carries the text it uses.
// A command keeps its own short procedure; what it names ("the lane guide (skill file lanes/plan.md)", "ops/tracks.md", "ops/board.md") is
// appended under "Reference", whole when the command needs the whole file, otherwise only the sections it uses. Nothing is written by hand:
// every piece is cut from the shipped skill text. A new pointer in a command needs a new entry here, and a test catches the gap.
import { section, shift, relink } from './plugin-inline.mjs';
import { installBlock } from './plugin-texts.mjs';

const W = (file) => ({ file });
const T = (file, ...heads) => ({ file, heads });
const PARTS = (file, from, to) => ({ file, from, to });
const ADDON = { title: 'The add-on\'s install commands', text: () => `Show these as written when the add-on is missing and I ask for parallel work or isolation; never run them.\n\n${installBlock('parallel')}` };
const TRACKS_SEARCH = T('ops/tracks.md', '## Search first: the default is update, not create');
const TRACK_FILES = T('ops/tracks.md', '## What goes in each track file', '## Splitting a plan that holds a log');
const NEWTRACK = '## newTrack `[name] [description]`';
const UPDATE = '## updateTrack, reportaBug, featureRequest';
const STATUSES = '## The five lane statuses';
const TRANSITIONS = '## Transitions';
const LANES_COMMON = [
  T('ops/lanes-and-statuses.md', STATUSES, TRANSITIONS, '## Lane names', '## Manual moves win'),
  T('ops/tracks.md', '## move `[track-number] [lane:status]`', '## pulse `[track-number] [status] [progress%] [summary?]`', '## comment `[track-number] [body]`'),
  T('SKILL.md', '## Finding a track', '## conversation.md format'),
];
const SETTINGS = W('ops/settings.md');
const FORMS = PARTS('setup/templates.md', '**Track spec forms**', null);
const REASON_LANE = 'the lane command follows its lane guide, which it used to read from the plugin install folder; the guide and the few reference sections it needs are copied in, so nothing is read outside the project';
const lane = (guide, extra = []) => ({ why: REASON_LANE, refs: [W(`lanes/${guide}.md`), ...extra, ...LANES_COMMON] });

export const REFERENCES = {
  setup: { why: 'setup writes the conductor files after the reply "ok" from the scaffold text and templates, which it used to read from the plugin install folder', refs: [
    W('setup/scaffold.md'), PARTS('setup/templates.md', null, '**Track spec forms**')] },
  'new-project': { why: 'new-project writes the conductor files from the scaffold text and templates, which it used to read from the plugin install folder', refs: [
    W('setup/scaffold.md'), PARTS('setup/templates.md', null, '**Track spec forms**'), T('ops/tracks.md', NEWTRACK), W('lanes/brainstorm.md')] },
  plan: lane('plan', [TRACK_FILES]),
  brainstorm: lane('brainstorm', [TRACKS_SEARCH]),
  implement: lane('implement', [W('ops/working-a-track.md'), ADDON]),
  review: lane('review', [W('ops/working-a-track.md'), ADDON]),
  'quality-gate': lane('quality-gate'),
  merge: lane('merge'),
  run: { why: 'run works any lane, so it carries the five lane guides and the working-a-track guardrails it used to read from the plugin install folder', refs: [
    W('ops/working-a-track.md'), ADDON, TRACK_FILES, W('lanes/plan.md'), W('lanes/implement.md'), W('lanes/review.md'), W('lanes/quality-gate.md'), W('lanes/merge.md'), ...LANES_COMMON] },
  new: { why: 'the command names ops/tracks.md (search first, newTrack, the track files); the sections are copied in', refs: [TRACKS_SEARCH, T('ops/tracks.md', NEWTRACK), TRACK_FILES] },
  bug: { why: 'the command names ops/tracks.md and the bug form of the templates; the sections are copied in', refs: [TRACKS_SEARCH, T('ops/tracks.md', NEWTRACK, UPDATE), FORMS] },
  feature: { why: 'the command names ops/tracks.md and the feature form of the templates; the sections are copied in', refs: [TRACKS_SEARCH, T('ops/tracks.md', NEWTRACK, UPDATE), FORMS] },
  comment: { why: 'the command names ops/tracks.md (comment) and the conversation format; both are copied in', refs: [T('ops/tracks.md', '## What goes in each track file', '## comment `[track-number] [body]`'), T('SKILL.md', '## conversation.md format')] },
  move: { why: 'the command names ops/tracks.md and the transition grammar; the sections are copied in', refs: [
    T('ops/tracks.md', '## move `[track-number] [lane:status]`', '## pulse `[track-number] [status] [progress%] [summary?]`'), T('ops/lanes-and-statuses.md', STATUSES, TRANSITIONS, '## Manual moves win')] },
  status: { why: 'the command names ops/tracks.md (status); the section is copied in', refs: [T('ops/tracks.md', '## status')] },
  workflow: { why: 'the command names ops/tracks.md (workflow) and the transition grammar; the sections are copied in', refs: [
    T('ops/tracks.md', '## workflow, workflow set `[lane] [key] [value]`'), T('ops/lanes-and-statuses.md', STATUSES, TRANSITIONS, '## Lane names')] },
  'repair-duplicates': { why: 'the command names the folder and id formats of ops/tracks.md; the section and the track lookup are copied in', refs: [T('ops/tracks.md', NEWTRACK), T('SKILL.md', '## Finding a track')] },
  board: { why: 'the command follows ops/board.md and the settings key it reads; both are copied in (the board script itself belongs to the board add-on and is still found by a Glob: the one read outside the project that remains)', refs: [W('ops/board.md'), SETTINGS] },
  'refresh-board': { why: 'the command follows ops/board.md and the settings key it reads; both are copied in (the board script of the add-on is still found by a Glob)', refs: [W('ops/board.md'), SETTINGS] },
  'show-board': { why: 'the command names step 2 of ops/board.md and the settings file; both are copied in', refs: [T('ops/board.md', '## 2. Find the URL', '## 4. Show', '## Rules'), SETTINGS] },
  deploy: { why: 'the command follows deploy/deploy.md, or deploy/setup-deploy.md for `setup`; both are copied in', refs: [W('deploy/deploy.md'), W('deploy/setup-deploy.md')] },
};
export const REFERENCE_COMMANDS = Object.keys(REFERENCES);
/** The commands that keep one read outside the project on purpose: the board script is a file of another plugin (the board add-on). */
export const BOARD_SCRIPT_COMMANDS = ['board', 'refresh-board'];

export const REF_NOTICE = 'This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin\'s install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.';

const names = (heads) => heads.map((h) => h.replace(/^#+ /, '').replace(/ `\[.*$/, '')).join('; ');
/** Wording fixes for text that is copied into a command (the skill itself is not touched). */
const tidy = (text) => text
  .replace('(for example `plan:success`: planned, parked)', '(for example `plan:success`: the plan is written and parked)')
  .replace('the commands are in `ADD-ONS.md`.', 'the install commands are under "The add-on\'s install commands" below.')
  .replace('follow `ops/board.md` from "No URL: create".', 'run the `/laneconductor:board` command, which carries that procedure.');

function render(item, readSkill) {
  if (item.title) return `### ${item.title}\n\n${item.text()}`;
  const text = readSkill(item.file);
  let body;
  let label = `\`${item.file}\``;
  if (item.heads) {
    body = item.heads.map((h) => shift(section(text, h), 2)).join('\n\n');
    label += ` (${names(item.heads)})`;
  } else if (item.from !== undefined || item.to !== undefined) {
    const a = item.from ? text.indexOf(item.from) : 0;
    const b = item.to ? text.indexOf(item.to) : text.length;
    if (a < 0 || b < 0) throw new Error(`inline: marker not found in ${item.file}`);
    body = shift(text.slice(a, b).replace(/^# .*\n+/, '').replace(/\s+$/, ''), 2);
    label += item.from ? ' (the track forms)' : ' (the file templates)';
  } else {
    body = shift(text.replace(/^# .*\n+/, '').replace(/\s+$/, ''), 2);
  }
  return `### ${label}\n\n${tidy(relink(body, item.file))}`;
}

/** The "Reference" part of a command that points at skill files; null when the command has none. */
export function referenceBlock(name, readSkill) {
  const spec = REFERENCES[name];
  if (!spec) return null;
  const heading = name === 'setup' || name === 'new-project' ? '## Reference: scaffold' : '## Reference';
  return `${heading}\n\nFrom the skill files this command names, copied here: whole files, or only the sections the command uses.\n\n${spec.refs.map((r) => render(r, readSkill)).join('\n\n')}`;
}

/** Puts the notice after the first paragraph of a command body (its opening line), so it is read before the steps. */
export function withNotice(body) {
  const i = body.indexOf('\n\n');
  return i < 0 ? `${body}\n\n${REF_NOTICE}` : `${body.slice(0, i)}\n\n${REF_NOTICE}${body.slice(i)}`;
}
