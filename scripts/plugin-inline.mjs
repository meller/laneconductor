// Track AM-10132: the front-door commands of the base plugin (setup, next, new-project) carry their whole procedure in the command body.
// Why: a command that says "read the skill file ops/next.md" makes the model read a file in the plugin's install folder
// (~/.claude/plugins/cache/...), which is outside the project. Interactively that raises the confusing "Allow this read outside the working
// directories?" question; headless (`claude -p`) the read is denied and the model cannot even find the folder. So at build time the text is
// copied, from the single source (.claude/skills/laneconductor, after the base's own edits), into the generated command body. The skill files stay
// the source and the reference; nothing is written by hand twice. The other commands still point at the lane guides (see the track).
import path from 'node:path';

export const INLINED_COMMANDS = ['setup', 'next', 'new-project'];

const levelOf = (line) => line.match(/^(#+) /)?.[1].length ?? 0;

/** The lines of the section that starts at the exact heading line, up to (not including) the next heading of the same or a higher level. */
export function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) throw new Error(`inline: heading not found (update scripts/plugin-inline.mjs): ${JSON.stringify(heading)}`);
  const level = levelOf(heading);
  let end = start + 1;
  while (end < lines.length && !(levelOf(lines[end]) > 0 && levelOf(lines[end]) <= level)) end += 1;
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

/** Moves every heading of a block down by n levels. */
const shift = (text, n) => text.replace(/^(#+) /gm, (_, h) => `${'#'.repeat(h.length + n)} `);

/** A Markdown link to another skill file becomes the skill-relative path in code (a link relative to the skill folder would not resolve from a command). */
export function relink(text, fromRel) {
  return text.replace(/\[([^\]]+)\]\(([^)#\s]+\.md)(#[^)]*)?\)/g, (_, _label, target) => `\`${path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), target))}\``);
}

/** Replaces text that must exist; a missing anchor throws, so a changed source fails the build instead of dropping an edit. */
function edit(text, rel, pairs) {
  let out = text;
  for (const [from, to] of pairs) {
    const found = from instanceof RegExp ? from.test(out) : out.includes(from);
    if (!found) throw new Error(`inline edit for ${rel}: source text not found (update scripts/plugin-inline.mjs): ${JSON.stringify(String(from).slice(0, 80))}`);
    out = out.replace(from, () => to);
  }
  return out;
}

/** The scaffold script belongs to the add-on and lives in its install folder; finding it is a search outside the project, so the inline text does the scaffold by hand. */
function newProjectText(text) {
  return edit(text, 'ops/new-project.md', [
    [/The scaffold script named below[\s\S]*?Do not recommend the\nadd-on for this\./,
      'Do the scaffold by hand, as step 3 describes: the result is the same as the add-on\'s scaffold script gives. Do not search for that script (it lives in\nthe add-on\'s install folder, outside the project) and do not recommend the add-on for this.'],
    [/- If the scaffold script is present[\s\S]*?yourself the same way\./, '- Read the files yourself; do not look for a script to do it.'],
    [/Do not add the walking-skeleton track to an existing project: pass `--no-first-track` to the scaffold script, or skip it by hand,\nand suggest planning the first real track instead\./,
      'Do not add the walking-skeleton track to an existing project; suggest planning the first real track instead.'],
    [/Record the answers as you go, as the JSON that\nthe scaffold script reads: /, 'Record the answers as you go: '],
    [/Run `node <path to the scaffold script>[\s\S]*?apply these rules over them:/,
      'Show what you would create and what you would skip because it exists, and ask for a yes; after the yes, create the files. The files and templates are\nin the skill files [../setup/scaffold.md](../setup/scaffold.md) and [../setup/templates.md](../setup/templates.md); apply these rules over them:'],
    ['The scaffold script writes it.', 'Create it by hand as [tracks.md](tracks.md) describes.'],
  ]);
}

/** The recommendation block says an add-on counts as installed when a Glob under the plugin cache finds its script; that Glob is a read outside the project, so the inline text does not use it. */
const detectNoGlob = (text) => text.replace(/its connector tools exist \(.*?\), or its agent/g, 'its connector tools are among your tools, or its agent').replace(/It counts as installed when Glob `[^`]+` under `~\/\.claude\/plugins\/cache` \(installed plugins only\) finds `[^`]+`\./g,
  'It has no tool or agent to look for, and finding its files means searching the plugin install folder, which is outside the project and not read here: offer it as an option, once, and say it can be ignored if it is already installed.');

const SOURCES = {
  setup: 'the skill file `setup/setup.md`, then the existing-repository path of `ops/new-project.md` (in "The path in detail"), with the recommendation block',
  'new-project': 'the skill file `ops/new-project.md`, in full',
  next: 'the skill file `ops/next.md`, in full, then what it needs from `ops/lanes-and-statuses.md` (in "Reference")',
};
const notice = (name) => `This command carries its whole procedure below: it is the text of ${SOURCES[name]}. Do not Glob or Read the plugin's install folder (\`~/.claude/plugins/...\`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the text are references only.`;

/**
 * The body of one inlined command. `readSkill(rel)` returns the text of a skill file as the base plugin ships it (the generated
 * recommendation block already inserted). Deterministic: only source text and fixed words.
 */
export function inlineBody(name, readSkill) {
  if (name === 'setup') {
    const np = relink(newProjectText(readSkill('ops/new-project.md')), 'ops/new-project.md')
      .replace('Instead of the nine questions of step 2, read the project and ask only to confirm:', 'Read the project and ask only to confirm:')
      .replace('## 1. Detect the situation', '## Detect the situation')
      .replace('## 3. Scaffold', '## Create the files');
    const main = edit(relink(readSkill('setup/setup.md'), 'setup/setup.md').replace(/^# .*\n+/, ''), 'setup/setup.md', [
      [/Follow `ops\/new-project\.md`, its existing-repository path \(the folder has a `\.git`, or files other than\n`conductor\/`\), and when the folder is empty its new-project path\. In short:/,
        'Follow the existing-repository path in "The path in detail" below (the folder has a `.git`, or files other than `conductor/`); when the folder is empty, the new-project\npath of `ops/new-project.md` applies and `/laneconductor:new-project` is the command for it. In short:'],
    ]);
    return [
      'Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it. Look for no program other than `git`, and read no settings file.',
      notice('setup'),
      detectNoGlob(main.replace(/\s+$/, '')),
      `## The path in detail\n\nFrom \`ops/new-project.md\`: how to read the project and what the confirmation message holds, then how the files are created.\n\n${shift(section(np, '## Detect the situation'), 1)}\n\n${shift(section(np, '## Create the files'), 1)}`,
    ].join('\n\n');
  }
  if (name === 'new-project') {
    const np = relink(newProjectText(readSkill('ops/new-project.md')), 'ops/new-project.md').replace(/^# new-project: .*\n+/, '');
    return [
      'New project: `$ARGUMENTS` (nothing given means ask me). This runs only because I named it.',
      notice('new-project'),
      detectNoGlob(np.replace(/\s+$/, '')),
    ].join('\n\n');
  }
  if (name === 'next') {
    const next = edit(relink(readSkill('ops/next.md'), 'ops/next.md').replace(/^# .*\n+/, ''), 'ops/next.md', [
      ['`.laneconductor.json`\n(`ops/settings.md`);', '`.laneconductor.json`;'],
    ]);
    const lanes = readSkill('ops/lanes-and-statuses.md');
    const pieces = [
      section(lanes, '## The five lane statuses'),
      section(lanes, '## The two meanings of `done`'),
      section(lanes, '## Transitions (track 1020\'s grammar)'),
    ].map((s) => shift(s, 1)).join('\n\n').replace('(for example `plan:success`: planned, parked)', '(for example `plan:success`: the plan is written and parked)');
    return [
      'What\'s next: `$ARGUMENTS` (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. In Claude Code, type it as `/laneconductor:next`; the commands in the card are written in that form.',
      notice('next'),
      `${detectNoGlob(next)}\n\n## Reference: lanes, statuses and transitions\n\nFrom \`ops/lanes-and-statuses.md\`; the whole reference you need for the card.\n\n${pieces}`,
    ].join('\n\n');
  }
  throw new Error(`inline: not an inlined command: ${name}`);
}
