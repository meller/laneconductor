#!/usr/bin/env node
// Ranks recipes against the tags of a project interview (track AM-10117, Phase 2). Read-only: it applies nothing.
//   lc-recipe-match.mjs [--tag <t>[,<t>]]... [--answers <file>] [--all] [--vocabulary]
//                       [--shipped <skill dir>] [--personal <library dir>] [--repo <project dir>]
//                       [--ref-root <dir>]... [--no-freshness] [--limit <n>]
// Libraries, in order: the shipped one inside the skill, then the person's own (--personal, else LC_RECIPES, else recipes.path in
// <repo>/.laneconductor.json). Prints one JSON object: libraries read, matches (at most five), note, and the tag vocabulary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_MATCHES, recommend } from '../src/recipes/match.mjs';
import { createRefResolver, defaultRoots } from '../src/recipes/references.mjs';

const USAGE = `Usage: lc-recipe-match.mjs [--tag <t>[,<t>]]... [--answers <file>] [--all] [--vocabulary]
                          [--shipped <skill dir>] [--personal <library dir>] [--repo <project dir>]
                          [--ref-root <dir>]... [--no-freshness] [--limit <n>]

  --tag          A stack tag from the interview (gcp, firebase-hosting, nodejs22); repeatable or comma separated.
  --answers      A JSON file with { "tags": [...] }.
  --all          List every recipe (no tags needed), no limit.
  --vocabulary   Print only the stack tags the libraries use, to pick interview tags from.
  --no-freshness Skip the check of cited reference repos.
`;

const here = path.dirname(fileURLToPath(import.meta.url));
// The skill folder: the plugin keeps it at <plugin>/skills/laneconductor (this file is <plugin>/server/bin), the repo at .claude/skills/laneconductor.
const defaultShipped = () => ['../../skills/laneconductor', '../../.claude/skills/laneconductor'].map((r) => path.resolve(here, r)).find((d) => fs.existsSync(path.join(d, 'SKILL.md'))) ?? null;

const argv = process.argv.slice(2);
const o = { tags: [], roots: [], limit: MAX_MATCHES, freshness: true, all: false, vocab: false, shipped: undefined, personal: null, repo: process.cwd() };
try {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--tag') o.tags.push(...val().split(','));
    else if (a === '--answers') o.tags.push(...(JSON.parse(fs.readFileSync(path.resolve(val()), 'utf8')).tags ?? []));
    else if (a === '--all') o.all = true;
    else if (a === '--vocabulary') o.vocab = true;
    else if (a === '--shipped') o.shipped = path.resolve(val());
    else if (a === '--personal') o.personal = val();
    else if (a === '--repo') o.repo = path.resolve(val());
    else if (a === '--ref-root') o.roots.push(path.resolve(val()));
    else if (a === '--no-freshness') o.freshness = false;
    else if (a === '--limit') { o.limit = Number(val()); if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error('--limit must be a positive integer'); } else if (a === '--help' || a === '-h') { process.stdout.write(USAGE); process.exit(0); } else throw new Error(`Unknown argument ${a}`);
  }
  const out = await recommend({
    shipped: o.shipped === undefined ? defaultShipped() : o.shipped,
    personal: o.personal,
    repo: o.repo,
    tags: o.tags,
    limit: o.all ? null : o.limit,
    resolver: o.freshness ? createRefResolver({ roots: o.roots.length ? o.roots : defaultRoots() }) : null,
  });
  process.stdout.write(`${JSON.stringify(o.vocab ? { libraries: out.libraries, vocabulary: out.vocabulary, note: out.note } : out, null, 2)}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n${USAGE}`);
  process.exit(2);
}
