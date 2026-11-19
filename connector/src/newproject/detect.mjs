// Reads an EXISTING repository and proposes the answers of the new-project interview (track AM-10130), so that adding LaneConductor to a
// project the person already has asks only for a confirmation, not for facts the files already state. Read-only: it writes nothing.
//
// Honesty rules, the same as the scaffold's: a command is proposed only when the project really has it (a script, a Makefile target, a
// toolchain default that exists by convention), never because a config file hints that it might; what cannot be read is left out, and the
// scaffold renders an honest placeholder for it. Everything it used is listed in `evidence`, so the person can correct a wrong guess.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const readText = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } };
const readJson = (dir, rel) => { try { return JSON.parse(readText(dir, rel)); } catch { return null; } };
const firstExisting = (dir, rels) => rels.find((r) => exists(dir, r)) ?? null;

/** npm's own placeholder: `npm init` writes it, and it fails on purpose. It is not a test command. */
const PLACEHOLDER_TEST = /no test specified/i;

/** Dependency name -> framework label. First match in this order wins. */
const FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['@remix-run/node', 'Remix'], ['astro', 'Astro'],
  ['@nestjs/core', 'NestJS'], ['fastify', 'Fastify'], ['express', 'Express'], ['koa', 'Koa'], ['hono', 'Hono'],
  ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['electron', 'Electron'],
];
/** Dev dependency -> test runner label. */
const RUNNERS = [['vitest', 'Vitest'], ['jest', 'Jest'], ['mocha', 'Mocha'], ['ava', 'AVA'], ['@playwright/test', 'Playwright'], ['cypress', 'Cypress']];
/** Files that say where the project is hosted or packaged. */
const HOSTING = [
  ['vercel.json', 'Vercel'], ['netlify.toml', 'Netlify'], ['fly.toml', 'Fly.io'], ['firebase.json', 'Firebase'], ['Dockerfile', 'a container image (Dockerfile)'],
  ['render.yaml', 'Render'], ['wrangler.toml', 'Cloudflare'], ['serverless.yml', 'Serverless framework'], ['app.yaml', 'Google App Engine'],
];
const LINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', 'biome.json', 'biome.jsonc', '.prettierrc', '.prettierrc.json', 'ruff.toml', '.golangci.yml', '.rubocop.yml', 'rustfmt.toml'];

/** The command that runs a package.json script with the project's package manager. `test` and `start` have the short form. */
function scriptCommand(manager, script) {
  if (manager === 'yarn') return script === 'test' ? 'yarn test' : `yarn ${script}`;
  if (manager === 'bun') return script === 'test' ? 'bun run test' : `bun run ${script}`;
  return script === 'test' ? `${manager} test` : `${manager} run ${script}`;
}

function packageManager(dir, pkg) {
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) return declared;
  if (exists(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (exists(dir, 'yarn.lock')) return 'yarn';
  if (exists(dir, 'bun.lockb') || exists(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

/** The first paragraph of the README after its title, as one line; null when there is none. */
function readmeSummary(text) {
  if (!text) return null;
  const paras = text.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const p = paras.find((x) => !/^(#|!\[|\[!\[|<|```|---|\||[-*] )/.test(x));
  return p ? p.replace(/\s+/g, ' ').slice(0, 300) : null;
}
const readmeTitle = (text) => (text ?? '').match(/^#\s+(.+)$/m)?.[1].trim() ?? null;

/** A Makefile target by name: `test:` at the start of a line. */
const makeTarget = (text, name) => new RegExp(`^${name}\\s*:(?!=)`, 'm').test(text ?? '');

/** The `run:` command lines of the GitHub Actions workflows, with the file they came from. */
function ciRuns(dir) {
  const out = [];
  const wf = '.github/workflows';
  let files = [];
  try { files = fs.readdirSync(path.join(dir, wf)).filter((f) => /\.ya?ml$/.test(f)).sort(); } catch { /* none */ }
  for (const f of files) for (const m of (readText(dir, `${wf}/${f}`) ?? '').matchAll(/^\s*-?\s*run:\s*(.+)$/gm)) out.push({ file: `${wf}/${f}`, cmd: m[1].trim() });
  return out;
}

/** What an older LaneConductor left: the conductor folder, its config, and the track folders by naming form and lane. */
function scanExisting(dir) {
  const existing = { conductor: exists(dir, 'conductor'), config: exists(dir, '.laneconductor.json'), files: [], tracks: { count: 0, prefixed: 0, bare: 0, foreign: [], lanes: {} } };
  if (!existing.conductor) return existing;
  try { existing.files = fs.readdirSync(path.join(dir, 'conductor'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch { /* unreadable */ }
  let entries = [];
  try { entries = fs.readdirSync(path.join(dir, 'conductor/tracks'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* none */ }
  existing.tracks.count = entries.length;
  for (const name of entries) {
    if (/^[A-Za-z]{1,4}-\d+(-|$)/.test(name)) existing.tracks.prefixed += 1;
    else if (/^\d+(-|$)/.test(name)) existing.tracks.bare += 1;
    else existing.tracks.foreign.push(name);
    const lane = (readText(dir, `conductor/tracks/${name}/index.md`) ?? '').match(/^\*\*Lane\*\*:\s*(\S+)/m)?.[1];
    if (lane) existing.tracks.lanes[lane] = (existing.tracks.lanes[lane] ?? 0) + 1;
  }
  return existing;
}

const OPEN_LICENCE = /\b(MIT License|Apache License|GNU (Affero |Lesser )?General Public License|BSD [23]-Clause|ISC License|Mozilla Public License|The Unlicense|Creative Commons)\b/i;
const PUBLIC_README = /\bpublic(ly)?\s+(demo|repo|repository|project)\b|\bpublic demo\b|\bopen[- ]source\b|\bopen-sourced\b/i;

/**
 * Whether the tracks are committed with the code or private (git-ignored). Decided from facts, never asked: private when there is a public
 * signal (the README says public, public demo or open source; an open-source LICENSE file; a package.json `license` other than UNLICENSED or
 * proprietary) or the repository has no remote yet (nothing to share); committed when there is a remote and no public signal.
 * @returns {{ mode: 'private'|'committed', reason: string }} the reason is the clause that follows "because" in the declared line
 */
export function decideTracks(dir) {
  const root = path.resolve(dir);
  const readmeFile = firstExisting(root, ['README.md', 'readme.md', 'README.rst', 'README']);
  const readme = readmeFile ? readText(root, readmeFile) : null;
  if (readme && PUBLIC_README.test(readme)) return { mode: 'private', reason: `the ${readmeFile} says this is public` };
  const licFile = firstExisting(root, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'licence', 'LICENCE']);
  if (licFile && OPEN_LICENCE.test(readText(root, licFile) ?? '')) return { mode: 'private', reason: `${licFile} is an open-source licence` };
  const lic = readJson(root, 'package.json')?.license;
  if (typeof lic === 'string' && lic.trim() && !/^(UNLICENSED|proprietary|SEE LICENSE IN)/i.test(lic.trim())) return { mode: 'private', reason: `package.json says the licence is ${lic.trim()}` };
  const remote = spawnSync('git', ['remote'], { cwd: root, encoding: 'utf8' });
  const hasRemote = remote.status === 0 && remote.stdout.trim() !== '';
  if (!hasRemote) return { mode: 'private', reason: 'the repository has no remote yet, so there is nothing to share' };
  return { mode: 'committed', reason: 'there is a remote and nothing says the project is public' };
}

/**
 * Proposes the interview answers for the repository in `dir`.
 * @returns {{ answers: object, evidence: string[], existing: object }} `answers` feeds `writeScaffold`; `evidence` says what each
 *   guess came from (show it, and ask only to confirm); `existing` describes an older conductor/ folder, if any.
 */
export function detectProject(dir) {
  const root = path.resolve(dir);
  const evidence = [];
  const answers = { stack: {}, commands: {} };
  const pkg = readJson(root, 'package.json');
  const readme = readText(root, firstExisting(root, ['README.md', 'readme.md', 'README.rst', 'README']) ?? '');
  const readmeFile = firstExisting(root, ['README.md', 'readme.md', 'README.rst', 'README']);
  const runs = ciRuns(root);
  const makefile = readText(root, 'Makefile');

  // ---- name and summary ----
  const pkgName = typeof pkg?.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : '';
  const pyName = (readText(root, 'pyproject.toml') ?? '').match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
  answers.name = pkgName || pyName || readmeTitle(readme) || path.basename(root);
  evidence.push(`name "${answers.name}" from ${pkgName ? 'package.json' : pyName ? 'pyproject.toml' : readmeTitle(readme) ? readmeFile : 'the folder name'}`);
  const desc = typeof pkg?.description === 'string' ? pkg.description.trim() : '';
  const sumReadme = readmeSummary(readme);
  answers.summary = desc || sumReadme || `${answers.name} (what it is for is not stated in the repository; fill in conductor/product.md)`;
  if (desc) evidence.push('summary from the package.json description');
  else if (sumReadme) evidence.push(`summary from the first paragraph of ${readmeFile}`);
  else evidence.push('no description in package.json or README: the summary is a placeholder');

  // ---- language and framework ----
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const other = [];
  if (pkg) {
    const ts = exists(root, 'tsconfig.json') || 'typescript' in deps;
    const node = typeof pkg.engines?.node === 'string' ? ` (Node ${pkg.engines.node})` : ' (Node)';
    answers.stack.language = `${ts ? 'TypeScript' : 'JavaScript'}${node}`;
    const fw = FRAMEWORKS.find(([d]) => d in deps);
    if (fw) answers.stack.framework = fw[1];
    evidence.push(`language${fw ? ' and framework' : ''} from the package.json dependencies${ts && exists(root, 'tsconfig.json') ? ' and tsconfig.json' : ''}`);
  } else if (exists(root, 'pyproject.toml') || exists(root, 'requirements.txt') || exists(root, 'setup.py')) {
    answers.stack.language = 'Python';
    evidence.push('language from the Python project files');
  } else if (exists(root, 'go.mod')) { answers.stack.language = 'Go'; evidence.push('language from go.mod'); }
  else if (exists(root, 'Cargo.toml')) { answers.stack.language = 'Rust'; evidence.push('language from Cargo.toml'); }
  else if (exists(root, 'Gemfile')) { answers.stack.language = 'Ruby'; evidence.push('language from Gemfile'); }
  else if (exists(root, 'pom.xml') || exists(root, 'build.gradle') || exists(root, 'build.gradle.kts')) { answers.stack.language = 'Java or Kotlin'; evidence.push('language from the build files'); }

  // ---- commands: only those that exist ----
  const manager = packageManager(root, pkg);
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const hasScript = (s) => typeof scripts[s] === 'string' && scripts[s].trim() !== '';
  const pick = (key, names) => { const s = names.find(hasScript); if (s) answers.commands[key] = scriptCommand(manager, s); return s; };
  if (hasScript('test') && !PLACEHOLDER_TEST.test(scripts.test)) answers.commands.test = scriptCommand(manager, 'test');
  else if (hasScript('test')) evidence.push('package.json has only the placeholder test script ("no test specified"): no test command proposed');
  pick('lint', ['lint']);
  pick('typecheck', ['typecheck', 'type-check', 'check-types', 'tsc']);
  pick('build', ['build']);
  pick('coverage', ['coverage', 'test:coverage', 'test:cov']);
  pick('e2e', ['test:e2e', 'e2e']);
  if (pkg && Object.keys(answers.commands).length) evidence.push(`commands from the package.json scripts, run with ${manager}`);
  if (pkg && !hasScript('lint') && LINT_CONFIGS.some((f) => exists(root, f))) evidence.push(`a lint config exists (${LINT_CONFIGS.find((f) => exists(root, f))}) but there is no lint script: no lint command proposed`);
  // Toolchains without a package.json, or a Makefile, name their commands by convention.
  if (!answers.commands.test) {
    if (makeTarget(makefile, 'test')) { answers.commands.test = 'make test'; evidence.push('test command from the Makefile target "test"'); }
    else if ((readText(root, 'pyproject.toml') ?? '').includes('pytest') || exists(root, 'pytest.ini') || exists(root, 'tox.ini')) { answers.commands.test = 'pytest'; evidence.push('test command from the pytest configuration'); }
    else if (exists(root, 'go.mod')) { answers.commands.test = 'go test ./...'; evidence.push('test command from go.mod'); }
    else if (exists(root, 'Cargo.toml')) { answers.commands.test = 'cargo test'; evidence.push('test command from Cargo.toml'); }
  }
  if (!answers.commands.lint && makeTarget(makefile, 'lint')) { answers.commands.lint = 'make lint'; evidence.push('lint command from the Makefile target "lint"'); }
  if (!answers.commands.build && !pkg && makeTarget(makefile, 'build')) { answers.commands.build = 'make build'; evidence.push('build command from the Makefile target "build"'); }

  // ---- testing ----
  const runner = RUNNERS.filter(([d]) => d in deps).map(([, l]) => l);
  const testScript = hasScript('test') ? scripts.test : '';
  if (/node --test/.test(testScript)) runner.unshift('node --test');
  if (answers.commands.test) answers.stack.testing = runner.length ? `${[...new Set(runner)].join(', ')} (\`${answers.commands.test}\`)` : `\`${answers.commands.test}\``;
  else if (runner.length) answers.stack.testing = [...new Set(runner)].join(', ');

  // ---- CI, lint config, hosting ----
  if (runs.length) {
    const files = [...new Set(runs.map((r) => r.file))];
    other.push(`CI: GitHub Actions (${files.join(', ')})`);
    evidence.push(`CI found: ${files.join(', ')}`);
    const named = Object.values(answers.commands);
    const inCi = runs.filter((r) => named.some((c) => r.cmd === c || r.cmd.startsWith(`${c} `))).length;
    if (inCi) evidence.push(`CI runs ${inCi} of the commands above, which confirms them`);
    if (!answers.commands.test) {
      const ci = runs.find((r) => /^(npm|pnpm|yarn|bun)( run)? test\b|^pytest\b|^go test\b|^cargo test\b|^make test\b/.test(r.cmd));
      if (ci) { answers.commands.test = ci.cmd; evidence.push(`test command from the CI file ${ci.file}`); }
    }
  }
  const lint = LINT_CONFIGS.find((f) => exists(root, f));
  if (lint) other.push(`Lint and format config: ${lint}`);
  const host = HOSTING.filter(([f]) => exists(root, f)).map(([, l]) => l);
  if (host.length) { answers.stack.hosting = host.join(', '); evidence.push(`hosting hints from the files in the repository root: ${host.join(', ')}`); }
  if (other.length) answers.stack.other = other;
  const srcDirs = ['src', 'lib', 'app', 'server', 'packages', 'cmd'].filter((d) => exists(root, d));
  if (srcDirs.length) evidence.push(`source folders: ${srcDirs.join(', ')}`);

  const tracks = decideTracks(root);
  answers.tracks = tracks.mode;
  evidence.push(`tracks ${tracks.mode === 'private' ? 'private (git-ignored)' : 'committed'}: ${tracks.reason}`);
  const existing = scanExisting(root);
  if (existing.conductor) {
    const t = existing.tracks;
    const lanes = Object.entries(t.lanes).map(([l, c]) => `${c} in ${l}`).join(', ');
    evidence.push(`conductor/ already exists: ${existing.files.length} file(s), ${t.count} track folder(s) in conductor/tracks (${t.prefixed} with initials, ${t.bare} with a bare number${t.foreign.length ? `, ${t.foreign.length} in another form: ${t.foreign.join(', ')}` : ''})${lanes ? `; lanes: ${lanes}` : ''}`);
  }
  if (existing.config) evidence.push('an older settings file (.laneconductor.json) is present; it is left as it is');
  return { answers, evidence, existing };
}
