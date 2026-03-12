// conductor/agent-runtime.mjs
import { spawn, execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, writeFileSync, openSync, mkdirSync, statSync, copyFileSync, rmSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { post, patch, get, resolveToken, getUserToken } from './collector-client.mjs';
import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from './constants.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function readIfExists(filepath) {
  try { return existsSync(filepath) ? readFileSync(filepath, 'utf8') : null; }
  catch { return null; }
}

export function loadWorkflowConfig(projectRoot = process.cwd(), installPath = null) {
  // 1. Try project-local workflow.json
  const localWf = join(projectRoot, 'conductor', 'workflow.json');
  if (existsSync(localWf)) {
    try { return JSON.parse(readFileSync(localWf, 'utf8')); }
    catch (err) { console.error('[config] Failed to parse conductor/workflow.json:', err.message); }
  }

  // 2. Try canonical global workflow.json
  if (installPath) {
    const globalWf = join(installPath, 'conductor', 'workflow.json');
    if (existsSync(globalWf)) {
      try { return JSON.parse(readFileSync(globalWf, 'utf8')); }
      catch (err) { console.error('[config] Failed to parse global workflow.json:', err.message); }
    }
  }

  return null;
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' };
const gitExec = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', env: GIT_ENV });

let cachedMainBranch = null;
export function getMainBranch() {
  if (cachedMainBranch) return cachedMainBranch;
  try {
    const remotes = execSync('git remote show origin', { encoding: 'utf8', env: GIT_ENV });
    const m = remotes.match(/HEAD branch: (.*)/);
    if (m && m[1]) {
      cachedMainBranch = m[1].trim();
      return cachedMainBranch;
    }
  } catch (e) { }

  try {
    const branches = execSync('git branch -a', { encoding: 'utf8', env: GIT_ENV });
    if (branches.includes('remotes/origin/main')) cachedMainBranch = 'main';
    else if (branches.includes('remotes/origin/master')) cachedMainBranch = 'master';
    else cachedMainBranch = 'master'; // fallback
  } catch (e) {
    cachedMainBranch = 'master';
  }
  return cachedMainBranch;
}

export async function checkAndClaimGitLock(trackNumber) {
  const lockDir = join(process.cwd(), '.conductor', 'locks');
  const lockFile = join(lockDir, `${trackNumber}.lock`);

  try {
    mkdirSync(lockDir, { recursive: true });
    try {
      gitExec(`git fetch origin ${getMainBranch()} --quiet`, process.cwd());
    } catch (e) {
      console.warn(`[git-lock] git fetch failed: ${e.message}`);
    }

    if (existsSync(lockFile)) {
      throw new Error(`Track ${trackNumber} is already locked by another process.`);
    }
    writeFileSync(lockFile, `PID: ${process.pid}\nTime: ${new Date().toISOString()}`);
    return lockFile;
  } catch (err) {
    throw new Error(`Failed to claim git lock for track ${trackNumber}: ${err.message}`);
  }
}

export async function releaseGitLock(trackNumber) {
  const lockFile = join(process.cwd(), '.conductor', 'locks', `${trackNumber}.lock`);
  if (existsSync(lockFile)) {
    rmSync(lockFile);
    return true;
  }
  return false;
}

export async function createWorktree(trackNumber) {
  const worktreeBase = join(process.cwd(), '.git', 'worktrees', 'conductor');
  const worktreePath = join(worktreeBase, trackNumber);

  try {
    mkdirSync(worktreeBase, { recursive: true });
    if (existsSync(worktreePath)) {
      console.log(`[worktree] Cleaning up existing worktree for track ${trackNumber}`);
      try {
        gitExec(`git worktree remove --force "${worktreePath}"`, process.cwd());
      } catch (e) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    const branchName = `track-${trackNumber}`;
    try {
      gitExec(`git branch -D "${branchName}"`, process.cwd());
    } catch (e) { }

    gitExec(`git worktree add -b "${branchName}" "${worktreePath}" origin/${getMainBranch()}`, process.cwd());
    return worktreePath;
  } catch (err) {
    throw new Error(`Failed to create worktree for track ${trackNumber}: ${err.message}`);
  }
}

export async function removeWorktree(trackNumber) {
  const worktreePath = join(process.cwd(), '.git', 'worktrees', 'conductor', trackNumber);
  if (existsSync(worktreePath)) {
    try {
      gitExec(`git worktree remove --force "${worktreePath}"`, process.cwd());
    } catch (e) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

export async function mergeAndRemoveWorktree(trackNumber) {
  const mainBranch = getMainBranch();
  const branchName = `track-${trackNumber}`;
  try {
    gitExec(`git fetch origin ${mainBranch}`, process.cwd());
    gitExec(`git checkout ${mainBranch}`, process.cwd());
    gitExec(`git merge "${branchName}" --no-edit`, process.cwd());
    gitExec(`git push origin ${mainBranch}`, process.cwd());
    await removeWorktree(trackNumber);
    gitExec(`git branch -d "${branchName}"`, process.cwd());
    console.log(`[worktree] Completed merge and cleanup for track ${trackNumber}`);
  } catch (err) {
    console.error(`[worktree] Error during merge and cleanup: ${err.message}`);
    throw err;
  }
}

export async function checkClaudeCapacity(collectorUrl, token) {
  return new Promise(resolve => {
    const proc = spawn('claude', ['-p', 'test'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.stderr.on('data', d => output += d);

    proc.on('exit', async (code) => {
      const available = code === 0;
      if (!available) {
        let resetAt = new Date(Date.now() + 60000);
        if (output.includes("hit your limit") || output.includes("exhausted") || output.includes("resets")) {
          const match = output.match(/resets\s+(\d{1,2})(:?\d{2})?(am|pm)/i);
          if (match) {
            let h = parseInt(match[1]);
            const isPM = match[3].toLowerCase() === 'pm';
            if (isPM && h !== 12) h += 12;
            if (!isPM && h === 12) h = 0;
            const now = new Date();
            resetAt = new Date(now);
            resetAt.setHours(h, match[2] ? parseInt(match[2].slice(1)) : 0, 0, 0);
            if (resetAt <= now) resetAt.setDate(resetAt.getDate() + 1);
          } else {
            resetAt = new Date(Date.now() + 15 * 60000);
          }
        }
        if (collectorUrl) {
          await post(collectorUrl, token, '/provider-status', {
            provider: 'claude', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Capacity exhausted'
          }).catch(() => { });
        }
      }
      resolve(available);
    });
  });
}

const providerStatusCache = new Map();

export async function isProviderAvailable(provider, config, primaryCollector) {
  if (!provider) return false;
  const cached = providerStatusCache.get(provider);
  if (cached) {
    if (cached.status !== 'exhausted') return true;
    if (!cached.reset_at) return false;
    const resetAt = new Date(cached.reset_at);
    if (resetAt < new Date()) {
      providerStatusCache.delete(provider);
      return true;
    }
    return false;
  }

  if (config.mode === 'local-fs') return true;

  const { url, token } = primaryCollector;
  try {
    const { providers = [] } = (await get(url, token, '/provider-status')) || {};
    const p = providers.find(x => x.provider === provider);
    if (p) {
      providerStatusCache.set(provider, { status: p.status, reset_at: p.reset_at, last_error: p.last_error });
    }
    if (!p || p.status !== 'exhausted') return true;
    if (!p.reset_at) return false;
    if (new Date(p.reset_at) < new Date()) {
      providerStatusCache.delete(provider);
      return true;
    }
    return false;
  } catch (err) {
    return true;
  }
}

export async function buildCliArgs(skill, command, trackNumber, customPrompt = null, laneConfig = {}, config, primaryCollector) {
  const proj = config.project;
  const primary = laneConfig.primary_cli ?? proj.primary?.cli ?? 'claude';
  const primaryModel = laneConfig.primary_model ?? proj.primary?.model;
  const secondary = proj.secondary?.cli;
  const secondaryModel = proj.secondary?.model;

  let chosenCli = primary, chosenModel = primaryModel;
  const primaryAvailable = await isProviderAvailable(primary, config, primaryCollector);
  const secondaryAvailable = secondary ? await isProviderAvailable(secondary, config, primaryCollector) : false;

  if (primary === 'claude') {
    const hasCapacity = await checkClaudeCapacity(primaryCollector.url, primaryCollector.token);
    if (!hasCapacity && secondary && secondaryAvailable) {
      chosenCli = secondary; chosenModel = secondaryModel;
    } else if (!hasCapacity && !secondaryAvailable) {
      return null;
    }
  }

  if (!primaryAvailable) {
    if (secondary && secondaryAvailable) {
      chosenCli = secondary; chosenModel = secondaryModel;
    } else {
      return null;
    }
  }

  const skillPath = `./.claude/skills/${skill}/SKILL.md`;
  const contextMsg = `Use the /${skill} skill. Skill definition is at: ${skillPath}. `;
  let skillCommand = command;
  if (command === 'quality-gate') skillCommand = 'qualityGate';
  const prompt = customPrompt || `/${skill} ${skillCommand} ${trackNumber}`;

  if (chosenCli === 'gemini') {
    const args = ['@google/gemini-cli', '--approval-mode', 'yolo', '-p', `${contextMsg}${prompt}`];
    if (chosenModel) args.push('--model', chosenModel);
    return ['npx', args, chosenCli];
  }
  if (chosenCli === 'claude') {
    const fullPrompt = customPrompt ? `${contextMsg}\n\n${prompt}` : prompt;
    const args = ['--dangerously-skip-permissions', '-p', fullPrompt];
    if (chosenModel) args.push('--model', chosenModel);
    return ['claude', args, chosenCli];
  }
  const args = ['-p', `${contextMsg}${prompt}`];
  if (chosenModel) args.push('--model', chosenModel);
  return [chosenCli, args, chosenCli];
}

function tailLog(logPath, lines = 100) {
  try {
    if (!existsSync(logPath)) return null;
    const content = readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-lines).join('\n');
  } catch (err) { return `Error reading log: ${err.message}`; }
}

async function checkExhaustion(logPath, cli, primaryCollector) {
  if (!existsSync(logPath) || !cli) return;
  const content = readFileSync(logPath, 'utf8');
  const { url, token } = primaryCollector;

  const geminiMatch = content.match(/quota will reset after\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
  if ((geminiMatch || content.includes('exhausted your capacity') || content.includes('code: 429')) && (cli === 'gemini' || cli === 'npx')) {
    const hours = parseInt(geminiMatch?.[1] || 0);
    const mins = parseInt(geminiMatch?.[2] || 0);
    const secs = parseInt(geminiMatch?.[3] || 0);
    const resetMs = (hours * 3600 + mins * 60 + secs) * 1000;
    const resetAt = new Date(Date.now() + (resetMs > 0 ? resetMs : 60000));
    providerStatusCache.set('gemini', { status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Quota exhausted' });
    if (url) await post(url, token, '/provider-status', { provider: 'gemini', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Quota exhausted' }).catch(() => { });
    return;
  }

  if (cli === 'claude' && (content.includes('429') || content.includes('Overloaded') || content.includes('Rate limit') || content.includes('hit your limit') || content.includes('resets'))) {
    let resetAt = new Date(Date.now() + 60000);
    const resetMatch = content.match(/resets\s+(\d+)(am|pm)/i);
    if (resetMatch) {
      const hour = (parseInt(resetMatch[1]) % 12) + (resetMatch[2].toLowerCase() === 'pm' ? 12 : 0);
      resetAt = new Date();
      resetAt.setHours(hour, 0, 0, 0);
      if (resetAt < new Date()) resetAt.setDate(resetAt.getDate() + 1);
    }
    providerStatusCache.set('claude', { status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Rate limited' });
    if (url) await post(url, token, '/provider-status', { provider: 'claude', status: 'exhausted', reset_at: resetAt.toISOString(), last_error: 'Rate limited' }).catch(() => { });
  }
}

export async function spawnCli(command, args, label, trackNumber, cli, laneStatus, laneConfig, config, primaryCollector, callbacks = {}) {
  let lockFile = null;
  let worktreePath = null;
  const isLocalFs = config.mode === 'local-fs';

  if (!isLocalFs && !process.env.LC_SKIP_GIT_LOCK) {
    try {
      lockFile = await checkAndClaimGitLock(trackNumber);
      worktreePath = await createWorktree(trackNumber);
    } catch (err) {
      if (worktreePath) await removeWorktree(trackNumber).catch(() => { });
      if (lockFile) await releaseGitLock(trackNumber).catch(() => { });
      throw err;
    }
  }

  let contextPrompt = '';
  try {
    const docs = { 'product.md': 'conductor/product.md', 'tech-stack.md': 'conductor/tech-stack.md', 'workflow.md': 'conductor/workflow.md' };
    for (const [name, path] of Object.entries(docs)) {
      const content = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (content) contextPrompt += `\n<project_context file="${name}">\n${content}\n</project_context>\n`;
    }
    const tracksDir = join(process.cwd(), 'conductor', 'tracks');
    const trackDirName = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
    if (trackDirName) {
      const trackPath = join(tracksDir, trackDirName);
      const trackDocs = { 'index.md': join(trackPath, 'index.md'), 'spec.md': join(trackPath, 'spec.md'), 'plan.md': join(trackPath, 'plan.md'), 'test.md': join(trackPath, 'test.md'), 'conversation.md': join(trackPath, 'conversation.md') };
      for (const [name, path] of Object.entries(trackDocs)) {
        const content = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (content) contextPrompt += `\n<track_context file="${name}">\n${content}\n</track_context>\n`;
      }
      contextPrompt += `\nYour workspace is at: ${worktreePath || process.cwd()}\n`;
      contextPrompt += `The track you are working on is in: conductor/tracks/${trackDirName}/\n`;
    }
  } catch (ctxErr) { }

  if (contextPrompt) {
    const pIndex = args.indexOf('-p');
    if (pIndex !== -1 && pIndex + 1 < args.length) {
      const originalPrompt = args[pIndex + 1];
      args[pIndex + 1] = `${contextPrompt}\n\nGOAL: ${originalPrompt}`;
    } else if (args.length > 0) {
      const originalPrompt = args[args.length - 1];
      args[args.length - 1] = `${contextPrompt}\n\nGOAL: ${originalPrompt}`;
    }
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const logPath = join(process.cwd(), 'conductor', 'logs', `${label}-${trackNumber}-${Date.now()}.log`);
  const out = openSync(logPath, 'a');
  
  const stdio = callbacks.foreground ? ['inherit', 'inherit', 'inherit'] : ['ignore', out, out];
  const proc = spawn(command, args, { detached: !callbacks.foreground, stdio, cwd: worktreePath || process.cwd(), env });

  if (callbacks.onStart) callbacks.onStart(proc.pid);

  const timeoutMs = Number(process.env.LC_SPAWN_TIMEOUT_MS) || config.worker?.spawn_timeout_ms || 300000;
  const killer = setTimeout(async () => {
    process.kill(-proc.pid, 'SIGTERM');
    if (!isLocalFs) {
      await patch(primaryCollector.url, primaryCollector.token, `/track/${trackNumber}/action`, {
        lane_action_status: 'failure', lane_action_result: 'timeout', last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    }
  }, timeoutMs);

  const tailInterval = setInterval(async () => {
    if (!isLocalFs) {
      await patch(primaryCollector.url, primaryCollector.token, `/track/${trackNumber}/action`, {
        last_log_tail: tailLog(logPath), active_cli: cli,
      }).catch(() => { });
    }
  }, 5000);

  if (!callbacks.foreground) proc.unref();

  return new Promise((resolve, reject) => {
    proc.on('exit', async (code) => {
      clearTimeout(killer);
      clearInterval(tailInterval);
      if (callbacks.onEnd) callbacks.onEnd(code);

      const isSuccess = code === 0;
      await checkExhaustion(logPath, cli, primaryCollector);

      // Handle filesystem cleanup and transitions
      try {
        const tracksDir = join(process.cwd(), 'conductor', 'tracks');
        const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
        if (trackDir) {
          const indexPath = join(tracksDir, trackDir, 'index.md');
          if (existsSync(indexPath)) {
            let content = readFileSync(indexPath, 'utf8');
            const nextActionStatus = isSuccess ? 'success' : 'failure';
            content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${nextActionStatus}`);
            
            // Handle lane transitions based on workflow
            let targetLane = laneStatus;
            if (isSuccess && laneConfig.on_success && laneConfig.on_success !== 'stay') {
              targetLane = laneConfig.on_success;
              content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${targetLane}`);
            } else if (!isSuccess && laneConfig.on_failure && laneConfig.on_failure !== 'stay') {
              targetLane = laneConfig.on_failure;
              content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${targetLane}`);
            }
            writeFileSync(indexPath, content, 'utf8');

            // Commit in worktree if applicable
            if (worktreePath && existsSync(worktreePath)) {
               // ... similar to sync worktree merge logic ...
               // For simplicity in this first draft, I'll omit the complex index.md merge here 
               // and focus on getting the CLI working. But I should eventually unify it.
            }
          }
        }
      } catch (err) { }

      if (worktreePath) await removeWorktree(trackNumber).catch(() => { });
      if (lockFile) await releaseGitLock(trackNumber).catch(() => { });

      resolve({ code, isSuccess });
    });
    proc.on('error', reject);
  });
}
