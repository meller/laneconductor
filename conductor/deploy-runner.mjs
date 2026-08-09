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
export async function runDeploy(projectRoot, env, { echo = false } = {}) {
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

  const log = (line) => {
    logStream.write(line);
    if (echo) process.stdout.write(line);
  };

  const runCommand = (cmdStr, label) => new Promise((resolve) => {
    log(`▶ ${label}: ${cmdStr}\n`);
    const proc = spawn(cmdStr, { shell: true, cwd: projectRoot });
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
  return { ok: true, exitCode: 0, logFile };
}
