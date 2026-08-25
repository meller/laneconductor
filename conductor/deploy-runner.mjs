// Track 1085 Phase 5: shared deploy execution logic, extracted from
// bin/lc.mjs's `lc deploy` command so both the CLI and the worker's dispatch
// handler (conductor/laneconductor.sync.mjs) run identical code.

import { readFileSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Runs the configured deploy command(s) for `env` from
// <projectRoot>/conductor/deploy.json, logging to
// conductor/logs/deploy-<env>-<timestamp>.log. Pass `{ echo: true }` to also
// stream output to process.stdout (used by the interactive CLI path).
export async function runDeploy(projectRoot, env, { echo = false, extraEnv = {} } = {}) {
  const deployJsonPath = join(projectRoot, 'conductor', 'deploy.json');
  if (!existsSync(deployJsonPath)) {
    return { ok: false, error: 'No deploy.json found. Run "lc setup-deploy" first.', logFile: null };
  }

  const deployConfig = JSON.parse(readFileSync(deployJsonPath, 'utf8'));
  const envConfig = deployConfig.environments?.[env];
  if (!envConfig) {
    const available = Object.keys(deployConfig.environments || {}).join(', ') || 'none';
    return {
      ok: false,
      error: `No deployment config for environment "${env}". Available environments: ${available}`,
      logFile: null,
    };
  }

  // Support both a single `command` string and a `commands` array
  const commands = envConfig.commands
    ? envConfig.commands
    : envConfig.command
      ? [{ label: env, command: envConfig.command }]
      : [];

  if (commands.length === 0) {
    return { ok: false, error: `No deploy command(s) configured for environment "${env}".`, logFile: null };
  }

  const logsDir = join(projectRoot, 'conductor', 'logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, `deploy-${env}-${Date.now()}.log`);
  const logStream = createWriteStream(logFile, { flags: 'a' });

  // Track AM-1119 Phase 4 (Task 2): accumulated so a successful run can
  // resolve the deployed URL from real command output (GCP Cloud Run —
  // its URL includes a hash GCP assigns at deploy time, unknowable ahead
  // of time) when deploy.json didn't already supply a predictable one
  // (Firebase Hosting — see deployConfig.js's `expected_url`).
  let capturedOutput = '';
  const log = (line) => {
    logStream.write(line);
    capturedOutput += line;
    if (echo) process.stdout.write(line);
  };

  const runCommand = (cmdStr, label) => new Promise((resolve) => {
    log(`▶ ${label}: ${cmdStr}\n`);
    // stdin: 'inherit' only for the interactive CLI path (echo) — a human
    // at a terminal can answer a deploy script's own confirmation prompts.
    // Everywhere else (a dispatched worker run, track 1085) stdin is
    // 'ignore': closed immediately, so a script that reads from it hits EOF
    // and fails/cancels fast instead of hanging forever with no one able to
    // answer. A well-behaved script should also check `[ -t 0 ]` before
    // prompting at all (this project's own scripts/deploy.sh does) — this
    // is the fallback for scripts that don't.
    const proc = spawn(cmdStr, {
      shell: true,
      cwd: projectRoot,
      stdio: [echo ? 'inherit' : 'ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv }
    });
    const stepStart = Date.now();
    proc.stdout.on('data', d => log(d.toString()));
    proc.stderr.on('data', d => log(d.toString()));
    proc.on('close', (code) => {
      const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      log(code === 0
        ? `\n✅ ${label} done (${elapsed}s)\n`
        : `\n❌ ${label} failed (exit ${code}, ${elapsed}s)\n`);
      resolve(code);
    });
  });

  const totalStart = Date.now();
  log(`🚀 Deploying to ${env} (${commands.length} step${commands.length > 1 ? 's' : ''})...\n\n`);

  for (const step of commands) {
    const label = step.label || step.command;
    const code = await runCommand(step.command, label);
    if (code !== 0) {
      log(`\nDeployment stopped at step: ${label}\n`);
      logStream.end();
      return { ok: false, exitCode: code, failedStep: label, logFile };
    }
  }

  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  log(`✅ Deployment to ${env} complete! (${elapsed}s)\n`);
  logStream.end();

  const url = resolveDeployedUrl(envConfig, capturedOutput);
  if (url && echo) process.stdout.write(`🔗 Live URL: ${url}\n`);

  return { ok: true, exitCode: 0, logFile, url };
}

// Track AM-1119 Phase 4 (Task 2): deploy.json's own `expected_url` (set by
// deployConfig.js's buildDeployJson for Firebase Hosting, whose default
// domain is a deterministic function of the project id) wins when present
// — no parsing needed, and it's right even if the CLI's own wording
// changes. Otherwise falls back to scanning captured stdout/stderr for a
// URL a deploy CLI printed — covers GCP Cloud Run (`gcloud run deploy`
// prints "Service URL: https://...") and anything else that prints a plain
// https:// URL on its own. Returns null, not a guess, when nothing is
// found — an absent app_url is honest; a wrong one is not.
export function resolveDeployedUrl(envConfig, output) {
  if (envConfig?.expected_url) return envConfig.expected_url;
  const serviceUrlMatch = output.match(/Service URL:\s*(https?:\/\/\S+)/i);
  if (serviceUrlMatch) return serviceUrlMatch[1];
  const genericMatch = output.match(/https?:\/\/\S+\.(?:web\.app|firebaseapp\.com|run\.app|vercel\.app)\S*/i);
  return genericMatch ? genericMatch[0] : null;
}
