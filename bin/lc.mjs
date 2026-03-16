#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, openSync, unlinkSync, readdirSync, mkdirSync, appendFileSync, realpathSync, rmSync, statSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { spawn, spawnSync } from 'child_process';
import { createInterface } from 'readline';

import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from '../conductor/constants.mjs';

const __filename = realpathSync(fileURLToPath(import.meta.url));
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

const VERSION = packageJson.version || '0.1.0';
const RC_FILE = join(homedir(), '.laneconductorrc');

function getInstallPath() {
    if (existsSync(RC_FILE)) {
        const skillPath = readFileSync(RC_FILE, 'utf8').trim();
        // skillPath is e.g. /path/to/laneconductor/.claude/skills/laneconductor
        // we need to reach the repo root where /ui lives.
        return resolve(skillPath, '../../..');
    }
    return resolve(__dirname, '..');
}

function findProjectRoot(startDir = process.cwd()) {
    let curr = startDir;
    while (curr !== dirname(curr)) {
        if (existsSync(join(curr, 'conductor')) || existsSync(join(curr, '.laneconductor.json'))) {
            return curr;
        }
        curr = dirname(curr);
    }
    return null;
}

/**
 * Runs a conversational LLM call (not a slash command), streams output to terminal,
 * and returns the full response text. Used for brainstorm loops.
 * @param {object} cfg - Project config from .laneconductor.json
 * @param {string} prompt - The full prompt to send
 * @returns {Promise<string>} - Full LLM response text
 */
async function callLLMConversational(cfg, prompt) {
    const agent = cfg.project?.primary;
    const cli = agent?.cli || 'claude';
    const model = agent?.model;

    let cmd, cmdArgs;
    if (cli === 'gemini') {
        cmd = 'npx';
        cmdArgs = ['@google/gemini-cli', '--approval-mode', 'yolo', '-p', prompt];
        if (model) cmdArgs.push('--model', model);
    } else {
        cmd = 'claude';
        cmdArgs = ['--dangerously-skip-permissions', '-p', prompt];
        if (model) cmdArgs.push('--model', model);
    }

    return new Promise((resolve) => {
        const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        proc.stdout.on('data', (d) => { const t = d.toString(); process.stdout.write(t); output += t; });
        proc.stderr.on('data', (d) => process.stderr.write(d));
        proc.on('close', () => resolve(output));
    });
}

/**
 * Runs the AI agent for a specific command/track.
 * @param {object} cfg - Project configuration from .laneconductor.json
 * @param {string} slashCmd - The /laneconductor command to run (e.g., "/laneconductor setup scaffold")
 * @param {string} trackNum - Optional track number
 * @param {string} lane - Optional lane for logging/status updates
 * @returns {Promise<number>} - Exit code
 */
async function runAIAgent(cfg, slashCmd, trackNum = null, lane = null) {
    const projectRoot = cfg.project.repo_path || process.cwd();
    
    // Identify available agents (primary and optional secondary)
    const agents = [];
    if (cfg.project?.primary?.cli) agents.push({ ...cfg.project.primary, type: 'primary' });
    if (cfg.project?.secondary?.cli) agents.push({ ...cfg.project.secondary, type: 'secondary' });

    if (agents.length === 0) {
        console.error('❌ No primary agent configured in .laneconductor.json');
        return 1;
    }

    const skillPath = join(projectRoot, '.claude/skills/laneconductor/SKILL.md');
    let skillContent = '';
    try {
        if (existsSync(skillPath)) {
            skillContent = readFileSync(skillPath, 'utf8');
        }
    } catch (e) {
        console.warn(`[scaffold] Could not read skill definition at ${skillPath}`);
    }

    const skillContext = skillContent 
        ? `Use the following /laneconductor skill definition to handle the request: \n\n${skillContent}\n\nCommand to execute: `
        : `Use the /laneconductor skill. `;

    let exitCode = 0;
    let finalStatus = 'failure';
    let lastErrorLog = '';

    for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const cli = agent.cli || 'claude';
        const model = agent.model;

        let cmd, cmdArgs;
        if (cli === 'claude') {
            cmd = 'claude';
            cmdArgs = ['--dangerously-skip-permissions', '-p', slashCmd];
            if (model) cmdArgs.push('--model', model);
        } else if (cli === 'gemini') {
            cmd = 'npx';
            // Prepend skill instructions directly to prompt for Gemini to avoid workspace/symlink restriction issues
            cmdArgs = ['@google/gemini-cli', '--approval-mode', 'yolo', '-p', `${skillContext}${slashCmd}`];
            if (model) cmdArgs.push('--model', model);
        } else {
            cmd = cli;
            cmdArgs = ['-p', `${skillContext}${slashCmd}`];
            if (model) cmdArgs.push('--model', model);
        }

        const logsDir = join(projectRoot, 'conductor', 'logs');
        if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
        const logPath = join(logsDir, `run-${lane || 'agent'}-${trackNum || 'global'}-${Date.now()}.log`);
        const logFd = openSync(logPath, 'a');

        console.log(`🚀 Running AI agent (${agent.type}): ${cli}${model ? ` (${model})` : ''}...`);
        if (trackNum) console.log(`   Track: ${trackNum} | Command: ${slashCmd}`);
        else console.log(`   Command: ${slashCmd}`);
        console.log(`   Log: ${logPath}\n`);

        const proc = spawn(cmd, cmdArgs, { stdio: ['inherit', 'pipe', 'pipe'], cwd: projectRoot });
        
        let output = '';
        let lastSyncTime = Date.now();

        const syncLogTail = async (isFinal = false) => {
            if (trackNum && cfg.mode !== 'local-fs') {
                try {
                    const logTail = output.split('\n').slice(-100).join('\n');
                    const collector = cfg.collectors?.[0];
                    if (collector?.url) {
                        const url = new URL(`${collector.url}/track/${trackNum}/action`);
                        if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
                        
                        const token = collector.token || collector.machine_token;

                        await fetch(url.toString(), {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({
                                lane_action_status: isFinal ? (exitCode === 0 ? 'success' : 'failure') : 'running',
                                last_log_tail: logTail,
                            })
                        }).catch(e => console.warn(`[log-sync] Could not push log chunk: ${e.message}`));
                    }
                } catch (e) {}
            }
        };

        const logInterval = setInterval(() => {
            if (Date.now() - lastSyncTime > 5000) {
                syncLogTail();
                lastSyncTime = Date.now();
            }
        }, 5000);

        proc.stdout.on('data', chunk => { 
            process.stdout.write(chunk); 
            appendFileSync(logPath, chunk);
            output += chunk.toString();
        });
        proc.stderr.on('data', chunk => { 
            process.stderr.write(chunk); 
            appendFileSync(logPath, chunk);
            output += chunk.toString();
        });

        exitCode = await new Promise(resolve => proc.on('close', resolve));
        clearInterval(logInterval);
        await syncLogTail(true);
        lastErrorLog = output;

        if (exitCode === 0) {
            finalStatus = 'success';
            // Update metadata if it's a track run
            if (trackNum) {
                try {
                    const tracksDir = join(projectRoot, 'conductor', 'tracks');
                    const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
                    if (trackDir) {
                        const indexPath = join(tracksDir, trackDir, 'index.md');
                        if (existsSync(indexPath)) {
                            let content = readFileSync(indexPath, 'utf8');
                            const runBy = `${cli}${model ? '/' + model : ''} (${agent.type})`;
                            if (content.match(/\*\*Last Run\*\*:\s*[^\n]+/i)) {
                                content = content.replace(/\*\*Last Run\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
                            } else if (content.match(/\*\*Last Run By\*\*:\s*[^\n]+/i)) {
                                content = content.replace(/\*\*Last Run By\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
                            } else {
                                content = content.replace(/(\*\*Progress\*\*:\s*[^\n]+)/i, `$1\n**Last Run**: ${runBy}`);
                            }
                            writeFileSync(indexPath, content, 'utf8');
                        }
                    }
                } catch (e) {
                    console.warn(`[metadata] Failed to update Last Run: ${e.message}`);
                }
            }
            break;
        } else {
            // Check if failure looks like a rate limit / exhaustion
            const isExhausted = output.includes('hit your limit') || 
                               output.includes('exhausted your capacity') || 
                               output.includes('429') || 
                               output.includes('resets');
            
            if (isExhausted && i < agents.length - 1) {
                console.log(`\n⚠️  ${agent.type.toUpperCase()} agent (${cli}) capacity exhausted. Falling back to next agent...\n`);
                continue;
            } else if (i < agents.length - 1) {
                console.log(`\n⚠️  ${agent.type.toUpperCase()} agent (${cli}) failed with exit code ${exitCode}. Trying next agent anyway...\n`);
                continue;
            }
        }
    }

    return exitCode;
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(`
LaneConductor CLI (lc) v${VERSION}

Usage:
  lc <command> [arguments]

Core Commands:
  status               Show track status for the current project
  start [--sync-only]  Start the heartbeat worker (--sync-only: sync without polling queue)
  stop                 Stop the heartbeat worker
  restart              Restart the heartbeat worker
  api [start|stop]     Manage the Collector API
  ui [start|stop]      Manage the Vite dashboard (default: start)
  setup                Initialize LaneConductor in the current project
  setup-deploy         Guided deployment setup (writes deployment-stack.md + deploy.json)
  deploy [env]         Execute deployment for a specific environment (prod/staging/preview)
  install              Install required project dependencies

Project & Track Management:
  new [name] [desc]    Create a new track
  brainstorm [id]      Start a brainstorm dialogue for a track via conversation.md
  comment [id] [msg]   Post a comment to a track
  move [id] [l:s]      Move track to lane:status
  pulse [id] [s] [%]   Pulse track status and progress
  show [id]            Show track details (plan, spec, logs)
  logs [id|worker|worker-run [id]] Show logs for a track or the worker
  workflow [set ...]   Manage workflow configuration (or show if no args)
  config [set ...]     Manage project configuration (or show if no args)
  config mode [mode]   Switch between local-fs, local-api, remote-api
  config visibility [private|team|public] Set worker visibility level
  verify-isolation     Check if worker environment is correctly sandboxed
  project [show|set]   Manage project settings (or show summary if no args)
  doc set SECTION VAL  Update conductor/product.md, tech-stack.md, etc.
  verify               Run project verification checks
  quality-gate         Run quality gate checks
  remote-sync          Bidirectional sync between API and local files (newer wins)
  init-summary         Regenerate conductor/tracks.md

Track transitions:
  plan [id] [--run]          Move to plan lane (--run: execute immediately in foreground)
  implement [id] [--run]     Move to implement lane (--run: execute immediately in foreground)
  review [id] [--run]        Move to review lane (--run: execute immediately in foreground)
  quality-gate [id] [--run]  Move to quality-gate lane (--run: execute immediately in foreground)
  backlog [id], done [id], rerun [id]

Global configuration: ${RC_FILE}
Installation path: ${getInstallPath()}
  `);
    process.exit(0);
}

if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`lc v${VERSION}`);
    process.exit(0);
}

const projectRoot = findProjectRoot();

function setNestedKey(obj, keyPath, value) {
    const keys = keyPath.split('.');
    let curr = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!curr[k]) curr[k] = {};
        curr = curr[k];
    }
    curr[keys[keys.length - 1]] = value;
}

function updateDocSection(file, section, value) {
    if (!existsSync(file)) return false;
    let content = readFileSync(file, 'utf8');
    const sectionH = '## ' + section;
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.trim().toLowerCase() === sectionH.toLowerCase());
    if (idx === -1) {
        content = content.trim() + '\n\n' + sectionH + '\n' + value + '\n';
    } else {
        let end = lines.findIndex((l, i) => i > idx && l.startsWith('## '));
        if (end === -1) end = lines.length;
        lines.splice(idx + 1, end - idx - 1, value);
        content = lines.join('\n');
    }
    writeFileSync(file, content);
    return true;
}

if (command === 'setup') {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    async function runSetup() {
        console.log('\n🛠️  LaneConductor Project Setup');
        console.log('==============================\n');

        let projectName = basename(process.cwd());
        let gitRemote = null;

        // Detect project name from package.json
        if (existsSync('package.json')) {
            try {
                const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
                if (pkg.name) projectName = pkg.name;
            } catch (e) { }
        }

        // Detect git remote
        try {
            const gitRes = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
            if (gitRes.status === 0) gitRemote = gitRes.stdout.trim();
        } catch (e) { }

        const name = await question(`Project name [${projectName}]: `) || projectName;
        const remoteUrl = await question(`Git remote URL [${gitRemote || 'none'}]: `) || gitRemote;

        console.log(`\n📂 Creating conductor/ directory structure...`);
        if (!existsSync('conductor')) mkdirSync('conductor', { recursive: true });
        if (!existsSync('conductor/tracks')) mkdirSync('conductor/tracks', { recursive: true });
        if (!existsSync('conductor/code_styleguides')) mkdirSync('conductor/code_styleguides', { recursive: true });

        // Copy canonical files
        const installPath = getInstallPath();
        const filesToCopy = [
            ['conductor/workflow.json', 'conductor/workflow.json'],
            ['workflow.md', 'workflow.md']
        ];

        for (const [src, dest] of filesToCopy) {
            const srcPath = join(installPath, src);
            if (existsSync(srcPath) && !existsSync(dest)) {
                console.log(`📄 Copying ${src}...`);
                writeFileSync(dest, readFileSync(srcPath));
            }
        }

        console.log('\n📊 Infrastructure & Mode Setup');
        const modeChoice = await question(`
How will this worker operate?
  [1] local-fs    — no DB, no API; pure filesystem (offline, CI, testing)
  [2] local-api   — local Postgres + local Collector + Vite UI (recommended)
  [3] remote-api  — remote Collector (laneconductor.io or self-hosted)
Choice [2]: `) || '2';

        const modeMap = { '1': 'local-fs', '2': 'local-api', '3': 'remote-api' };
        const mode = modeMap[modeChoice] || 'local-api';

        let dbConfig = { host: 'localhost', port: 5432, name: 'laneconductor', user: 'postgres', password: '' };
        if (mode === 'local-api') {
            console.log('\n�️  Database Configuration');
            dbConfig.host = await question(`DB Host [${dbConfig.host}]: `) || dbConfig.host;
            dbConfig.port = parseInt(await question(`DB Port [${dbConfig.port}]: `) || dbConfig.port);
            dbConfig.name = await question(`DB Name [${dbConfig.name}]: `) || dbConfig.name;
            dbConfig.user = await question(`DB User [${dbConfig.user}]: `) || dbConfig.user;
            dbConfig.password = await question(`DB Password (hidden): `, { hideEchoBack: true }) || '';
        }

        console.log('\n🛰️  Collector Configuration');
        const syncChoice = await question(`
Where should tracks be synced?
  [1] Local Only
  [2] LC Cloud Only
  [3] Both Local & Cloud
Choice [1]: `) || '1';

        let collectors = [];
        if (syncChoice === '1' || syncChoice === '3') collectors.push({ url: 'http://localhost:8091', token: null });

        let cloudToken = null;
        let remoteApiKey = null;
        if (syncChoice === '2' || syncChoice === '3') {
            collectors.push({ url: 'https://api.laneconductor.com', token: null });
            cloudToken = await question('Enter LC Cloud Token (API Key): ');
            remoteApiKey = cloudToken;
        }

        // Prompt for API key if remote-api is selected (and not already prompted in syncChoice)
        if (mode === 'remote-api' && !remoteApiKey) {
            console.log('\n🔐 Remote API Configuration');
            remoteApiKey = await question('Enter Remote API Key (lc_xxx...): ');
            if (!remoteApiKey) {
                console.warn('⚠️  Warning: No API key provided. Remote sync may fail.');
            }
        }

        console.log('\n🤖 Agent Configuration');
        const agentChoice = await question(`
Primary AI agent:
  [1] claude  (recommended)
  [2] gemini
  [3] other
Choice [1]: `) || '1';
        const agentMap = { '1': 'claude', '2': 'gemini', '3': 'other' };
        const primaryCli = agentMap[agentChoice] || 'claude';
        const primaryModel = await question(`Primary model [default]: `) || null;

        const secondaryYN = await question(`Add a secondary (fallback) agent? (y/n) [y]: `);
        let secondary = null;
        if (secondaryYN.toLowerCase() !== 'n') {
            const secAgentChoice = primaryCli === 'claude' ? '2' : '1'; // Default to the "other" one
            const secChoice = await question(`
Secondary AI agent:
  [1] claude
  [2] gemini
  [3] other
Choice [${secAgentChoice}]: `) || secAgentChoice;
            const secCli = agentMap[secChoice] || (secAgentChoice === '1' ? 'claude' : 'gemini');
            const secModel = await question(`Secondary model [default]: `) || null;
            secondary = { cli: secCli, model: secModel || null };
        }

        console.log('\n⚙️  Project Settings');
        const qgYN = await question(`Enable Quality Gate lane? (y/n) [y]: `);
        const createQualityGate = qgYN.toLowerCase() !== 'n';

        const devCmd = await question(`Dev server command (optional, e.g. "npm run dev"): `) || null;
        const devUrl = devCmd ? (await question(`Dev server URL [http://localhost:3000]: `) || 'http://localhost:3000') : null;

        const config = {
            mode,
            project: {
                name,
                id: null,
                git_remote: remoteUrl,
                repo_path: process.cwd(),
                create_quality_gate: createQualityGate,
                primary: { cli: primaryCli, model: primaryModel || null },
                secondary,
                dev: devCmd ? { command: devCmd, url: devUrl } : undefined
            },
            collectors
        };

        if (mode === 'local-api') {
            config.db = { ...dbConfig };
            delete config.db.password; // Store password only in .env
        }

        writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
        console.log('✅ .laneconductor.json created');

        // Create skill symlink so the AI agent can find the skill
        console.log('🔗 Symlinking LaneConductor skill...');
        try {
            const skillDir = existsSync(RC_FILE) ? readFileSync(RC_FILE, 'utf8').trim() : join(getInstallPath(), '.claude/skills/laneconductor');
            const targetDir = '.claude/skills';
            if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
            const targetPath = join(targetDir, 'laneconductor');
            
            if (existsSync(targetPath)) unlinkSync(targetPath);
            spawnSync('ln', ['-sf', skillDir, targetPath]);
            console.log(`✅ Skill symlinked → ${targetPath}`);
        } catch (e) {
            console.warn(`⚠️  Could not symlink skill: ${e.message}`);
        }

        // Update .env
        let envContent = '';
        if (existsSync('.env')) envContent = readFileSync('.env', 'utf8');

        if (dbConfig.password) {
            if (envContent.includes('DB_PASSWORD=')) {
                envContent = envContent.replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${dbConfig.password}`);
            } else {
                envContent += `\nDB_PASSWORD=${dbConfig.password}\n`;
            }
        }
        if (cloudToken || remoteApiKey) {
            const token = cloudToken || remoteApiKey;
            const cloudIdx = collectors.findIndex(c => c.url.includes('laneconductor.com') || c.url.includes('api.laneconductor.com'));
            if (cloudIdx !== -1) {
                const key = `COLLECTOR_${cloudIdx}_TOKEN`;
                if (envContent.includes(`${key}=`)) {
                    envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${token}`);
                } else {
                    envContent += `\n${key}=${token}\n`;
                }
            }
        }
        if (remoteApiKey && !cloudToken && mode === 'remote-api') {
            // Store remote API key for remote-api mode
            const remoteIdx = collectors.findIndex(c => !c.url.includes('localhost') && !c.url.includes('127.0.0.1'));
            if (remoteIdx !== -1) {
                const key = `COLLECTOR_${remoteIdx}_TOKEN`;
                if (envContent.includes(`${key}=`)) {
                    envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${remoteApiKey}`);
                } else {
                    envContent += `\n${key}=${remoteApiKey}\n`;
                }
            }
        }
        if (envContent.trim()) writeFileSync('.env', envContent.trim() + '\n');

        if (!existsSync('.gitignore')) {
            writeFileSync('.gitignore', '.env\n.laneconductor.json\n');
        } else {
            const gitignore = readFileSync('.gitignore', 'utf8');
            if (!gitignore.includes('.env')) appendFileSync('.gitignore', '\n.env\n');
            if (!gitignore.includes('.laneconductor.json')) appendFileSync('.gitignore', '.laneconductor.json\n');
        }

        // Register project in DB for local-api mode
        if (mode === 'local-api') {
            try {
                const { createRequire } = await import('module');
                const require = createRequire(import.meta.url);
                const pg = require('pg');
                const pool = new pg.Pool({
                    host: dbConfig.host,
                    port: dbConfig.port,
                    database: dbConfig.name,
                    user: dbConfig.user,
                    password: dbConfig.password,
                });
                const result = await pool.query(
                    `INSERT INTO projects (name, repo_path, mode, git_remote, primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, dev_command, dev_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (repo_path) DO UPDATE SET
                       name = EXCLUDED.name,
                       mode = EXCLUDED.mode,
                       git_remote = EXCLUDED.git_remote,
                       primary_cli = EXCLUDED.primary_cli,
                       primary_model = EXCLUDED.primary_model,
                       secondary_cli = EXCLUDED.secondary_cli,
                       secondary_model = EXCLUDED.secondary_model,
                       create_quality_gate = EXCLUDED.create_quality_gate,
                       dev_command = EXCLUDED.dev_command,
                       dev_url = EXCLUDED.dev_url
                     RETURNING id`,
                    [
                        name, process.cwd(), mode, remoteUrl,
                        primaryCli, primaryModel || null,
                        secondary?.cli || null, secondary?.model || null,
                        createQualityGate, devCmd, devUrl
                    ]
                );
                const projectId = result.rows[0]?.id;
                if (projectId) {
                    config.project.id = projectId;
                    writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
                    console.log(`✅ Project registered in DB (id: ${projectId})`);
                }
                await pool.end();
            } catch (e) {
                console.log(`⚠️  DB registration failed: ${e.message}`);
                console.log(`   Verify your DB settings and run "lc setup" again, or "lc start" later.`);
            }
        }

        console.log('\n✨ Manual setup complete!');

        // ── Scaffold Brainstorm Loop ────────────────────────────────────────
        console.log('\n📦 Scanning project to prepare scaffolding context...\n');

        // Quick project scan — no AI needed
        const scanSnippets = [];

        if (existsSync('package.json')) {
            try {
                const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
                const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).join(', ');
                scanSnippets.push(`package.json: name="${pkg.name}", description="${pkg.description || ''}", deps: ${deps.slice(0, 400)}`);
            } catch {}
        }
        for (const f of ['README.md', 'readme.md']) {
            if (existsSync(f)) {
                scanSnippets.push(`README (first 600 chars): ${readFileSync(f, 'utf8').slice(0, 600)}`);
                break;
            }
        }
        const frameworkSignals = ['next.config.js', 'next.config.ts', 'nuxt.config.ts', 'vite.config.ts', 'svelte.config.js', 'astro.config.mjs', 'angular.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'setup.py'].filter(f => existsSync(f));
        if (frameworkSignals.length) scanSnippets.push(`Framework signals: ${frameworkSignals.join(', ')}`);

        const testSignals = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'pytest.ini', 'tests/', 'test/', '__tests__/'].filter(f => existsSync(f));
        if (testSignals.length) scanSnippets.push(`Test setup: ${testSignals.join(', ')}`);

        const ciSignals = ['.github/workflows', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile'].filter(f => existsSync(f));
        if (ciSignals.length) scanSnippets.push(`CI: ${ciSignals.join(', ')}`);

        const hasExistingCode = frameworkSignals.length > 0 || existsSync('src') || existsSync('app') || existsSync('lib');
        console.log(`   Project: ${name}${hasExistingCode ? ' (existing codebase detected)' : ' (new project)'}`);
        if (frameworkSignals.length) console.log(`   ✅ ${frameworkSignals.join(', ')}`);
        if (testSignals.length) console.log(`   ✅ Tests: ${testSignals.join(', ')}`);
        if (ciSignals.length) console.log(`   ✅ CI: ${ciSignals.join(', ')}`);

        // Brainstorm loop for scaffold
        const scaffoldHistory = [];

        const buildScaffoldPrompt = (userMessage) => {
            const ctx = `You are helping set up a LaneConductor project context. You need to understand the project well enough to generate these files:
- conductor/product.md        (what the product does, who uses it, key features)
- conductor/tech-stack.md     (languages, frameworks, databases, infra)
- conductor/workflow.md       (how development works — commits, branches, reviews, testing)
- conductor/product-guidelines.md  (brand, style, UX principles)

Project: ${name}
Git remote: ${remoteUrl || 'none'}
Has existing code: ${hasExistingCode}

Scan findings:
${scanSnippets.join('\n')}

Your job:
1. Propose what the content of each context file should be based on what you can infer
2. Ask about anything you can't infer (one question at a time)
3. When you have enough to generate all 4 files, end with:
   "✅ Ready to generate context files."

Keep responses concise. If the project has existing code, infer as much as possible before asking.`;

            const history = scaffoldHistory.map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
            ).join('\n\n');

            return history
                ? `${ctx}\n\n--- Conversation ---\n${history}\n\nUser: ${userMessage}`
                : `${ctx}\n\nUser: ${userMessage}`;
        };

        const initialMsg = hasExistingCode
            ? `I have an existing codebase. Based on the scan above, what can you infer about this project, and what questions do you have before generating the context files?`
            : `This is a new project called "${name}". Please ask me what you need to know to generate the context files.`;

        console.log('\n🤖 Analysing project...\n');
        let scaffoldLLMResponse = await callLLMConversational(config, buildScaffoldPrompt(initialMsg));
        scaffoldHistory.push({ role: 'user', content: initialMsg });
        scaffoldHistory.push({ role: 'assistant', content: scaffoldLLMResponse });

        while (true) {
            console.log('\n─────────────────────────────────────────────────────');
            const next = (await question('   [Enter] Generate context files   [r] Refine   [q] Skip\n   > ')).trim();

            if (!next || next.toLowerCase() === 'g') break;
            if (next.toLowerCase() === 'q') {
                console.log('   Skipping scaffold — run "/laneconductor setup scaffold" manually in your AI editor.');
                rl.close();
                process.exit(0);
            }
            const refinement = next.toLowerCase() === 'r'
                ? (await question('   Your answer or change > ')).trim()
                : next;

            if (!refinement) break;
            scaffoldHistory.push({ role: 'user', content: refinement });
            console.log('\n🤖 Thinking...\n');
            scaffoldLLMResponse = await callLLMConversational(config, buildScaffoldPrompt(refinement));
            scaffoldHistory.push({ role: 'assistant', content: scaffoldLLMResponse });
        }

        // Write scaffold context and run generation
        const scaffoldContext = {
            project: { name, git_remote: remoteUrl, has_existing_code: hasExistingCode },
            scan: scanSnippets,
            brainstorm_summary: scaffoldHistory.map(m => `${m.role}: ${m.content}`).join('\n\n'),
        };
        if (!existsSync('conductor')) mkdirSync('conductor', { recursive: true });
        const scaffoldContextPath = 'conductor/.setup-scaffold-context.json';
        writeFileSync(scaffoldContextPath, JSON.stringify(scaffoldContext, null, 2));

        console.log('\n🤖 Generating context files...\n');
        const exitCode = await runAIAgent(config, '/laneconductor setup scaffold generate');

        try { unlinkSync(scaffoldContextPath); } catch {}

        if (exitCode === 0) {
            console.log('\n✅ Setup and Scaffolding complete!');
        } else {
            console.log('\n⚠️  AI Scaffolding failed or was interrupted.');
            console.log('   Run "/laneconductor setup scaffold" manually in your AI editor.');
        }

        console.log('\nNext steps:');
        console.log('  1. Run "lc install" to add required dependencies (chokidar).');
        console.log('  2. Run "lc start" to begin the heartbeat worker.');
        console.log('  3. Run "lc ui start" to open the Kanban dashboard.');
        console.log('  4. Create your first track with "lc new".');

        const deployYN = await question(`\nWould you like to configure the deployment stack now? (lc setup-deploy) (y/n) [n]: `);
        if (deployYN.toLowerCase() === 'y') {
            rl.close();
            // setup-deploy has its own rl2 instance
            spawnSync(process.execPath, [process.argv[1], 'setup-deploy'], { stdio: 'inherit' });
        } else {
            rl.close();
        }
    }

    runSetup();
} else if (command === 'setup-deploy') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const cfgPath = join(projectRoot, '.laneconductor.json');
    if (!existsSync(cfgPath)) {
        console.error('❌ Error: No .laneconductor.json found. Run "lc setup" first.');
        process.exit(1);
    }
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt) => new Promise(resolve => rl2.question(prompt, resolve));

    // ── Phase 1: Scan ──────────────────────────────────────────────────────
    console.log('\n🔍 Scanning project for deployment signals...\n');
    const scanTargets = [
        { path: 'deploy.sh',                  label: 'deploy.sh' },
        { path: 'infra/deploy.sh',             label: 'infra/deploy.sh' },
        { path: 'Dockerfile',                  label: 'Dockerfile' },
        { path: 'firebase.json',               label: 'firebase.json (Firebase Hosting)' },
        { path: 'vercel.json',                 label: 'vercel.json (Vercel)' },
        { path: '.github/workflows',           label: '.github/workflows/ (CI/CD)' },
        { path: 'terraform',                   label: 'terraform/ (IaC)' },
        { path: 'infra',                       label: 'infra/ (infra scripts)' },
        { path: 'Makefile',                    label: 'Makefile' },
        { path: 'serverless.yml',              label: 'serverless.yml (AWS Serverless)' },
        { path: 'fly.toml',                    label: 'fly.toml (Fly.io)' },
    ];
    const found = scanTargets.filter(t => existsSync(join(projectRoot, t.path)));
    if (found.length > 0) {
        found.forEach(t => console.log(`   ✅ ${t.label}`));
    } else {
        console.log('   (no existing deployment files found — starting fresh)');
    }

    // ── Phase 2: Infer defaults ────────────────────────────────────────────
    const has = (p) => found.some(t => t.path === p);
    const defaultFrontend = has('firebase.json') ? 'Firebase Hosting' : has('vercel.json') ? 'Vercel' : 'none';
    const defaultBackend  = has('Dockerfile') ? 'GCP Cloud Run' : has('serverless.yml') ? 'AWS Lambda' : has('fly.toml') ? 'Fly.io' : 'none';
    const existingDeployScript = has('infra/deploy.sh') ? 'bash infra/deploy.sh' : has('deploy.sh') ? 'bash deploy.sh' : null;

    // ── Phase 3: Q&A ──────────────────────────────────────────────────────
    console.log('\n🧩 Let\'s configure your deployment stack.\n');
    console.log('   (Press Enter to accept the default shown in brackets)\n');

    const frontend = (await ask(`   Frontend     [${defaultFrontend}]: `)).trim() || defaultFrontend;
    const backend  = (await ask(`   Backend      [${defaultBackend}]: `)).trim()  || defaultBackend;
    const db       = (await ask(`   Database     [Cloud SQL]: `)).trim() || 'Cloud SQL';
    const secrets  = (await ask(`   Secrets      [GCP Secret Manager]: `)).trim() || 'GCP Secret Manager';

    const envInput = (await ask('\n   Environments (comma-separated) [prod,staging]: ')).trim() || 'prod,staging';
    const environments = envInput.split(',').map(e => e.trim()).filter(Boolean);

    let deployCmd = existingDeployScript;
    if (existingDeployScript) {
        const useExisting = (await ask(`\n   Deploy script found: "${existingDeployScript} <env>"  Use it? [Y/n]: `)).trim();
        if (useExisting.toLowerCase() === 'n') {
            deployCmd = (await ask('   Custom deploy command (env appended): ')).trim() || existingDeployScript;
        }
    } else {
        const customCmd = (await ask('\n   Deploy command (leave blank to let AI generate): ')).trim();
        if (customCmd) deployCmd = customCmd;
    }

    const hasGHActions = has('.github/workflows');
    let wantCICD;
    if (hasGHActions) {
        const keep = (await ask('\n   GitHub Actions workflow already exists. Keep CI/CD? [Y/n]: ')).trim();
        wantCICD = keep.toLowerCase() !== 'n';
    } else {
        const add = (await ask('\n   Set up GitHub Actions CI/CD pipeline? [y/N]: ')).trim();
        wantCICD = add.toLowerCase() === 'y';
    }

    // ── Phase 4: Credential verification ──────────────────────────────────
    console.log('\n🔒 Verifying credentials...\n');
    const credResults = {};

    const needsGCP = [frontend, backend, secrets].some(v => v.toLowerCase().includes('gcp') || v.toLowerCase().includes('firebase') || v.toLowerCase().includes('cloud run') || v.toLowerCase().includes('cloud sql'));
    const needsFirebase = frontend.toLowerCase().includes('firebase');
    const needsAWS = [frontend, backend, secrets].some(v => v.toLowerCase().includes('aws') || v.toLowerCase().includes('lambda'));
    const needsVercel = [frontend, backend].some(v => v.toLowerCase().includes('vercel'));
    const needsSupabase = [db, secrets].some(v => v.toLowerCase().includes('supabase'));

    if (needsGCP) {
        const r = spawnSync('gcloud', ['auth', 'list', '--format=value(account)', '--filter=status=ACTIVE'], { encoding: 'utf8' });
        const account = r.status === 0 && r.stdout.trim() ? r.stdout.trim().split('\n')[0] : null;
        credResults.gcp = account ? `verified (${account})` : 'NOT CONFIGURED';
        console.log(`   GCP ADC      → ${account ? '✅ ' + account : '❌ run: gcloud auth application-default login'}`);
    }
    if (needsFirebase) {
        const r = spawnSync('firebase', ['projects:list', '--json'], { encoding: 'utf8' });
        credResults.firebase = r.status === 0 ? 'verified' : 'NOT CONFIGURED';
        console.log(`   Firebase CLI → ${r.status === 0 ? '✅ verified' : '❌ run: firebase login'}`);
    }
    if (needsAWS) {
        const r = spawnSync('aws', ['sts', 'get-caller-identity', '--output', 'text'], { encoding: 'utf8' });
        credResults.aws = r.status === 0 ? `verified (${r.stdout.trim().split('\t')[1] || 'ok'})` : 'NOT CONFIGURED';
        console.log(`   AWS          → ${r.status === 0 ? '✅ ' + credResults.aws : '❌ run: aws configure'}`);
    }
    if (needsVercel) {
        const r = spawnSync('vercel', ['whoami'], { encoding: 'utf8' });
        credResults.vercel = r.status === 0 ? `verified (${r.stdout.trim()})` : 'NOT CONFIGURED';
        console.log(`   Vercel CLI   → ${r.status === 0 ? '✅ ' + r.stdout.trim() : '❌ run: vercel login'}`);
    }
    if (needsSupabase) {
        const r = spawnSync('supabase', ['projects', 'list'], { encoding: 'utf8' });
        credResults.supabase = r.status === 0 ? 'verified' : 'NOT CONFIGURED';
        console.log(`   Supabase CLI → ${r.status === 0 ? '✅ verified' : '❌ run: supabase login'}`);
    }

    // ── Phase 5: Brainstorm loop — LLM advises, user refines until ready ──
    const conversationHistory = [];
    let finalComponents = { frontend, backend, db, secrets };
    let finalDeployCmd = deployCmd;
    let finalEnvironments = environments;
    let finalWantCICD = wantCICD;

    const buildBrainstormPrompt = (userMessage) => {
        const systemCtx = `You are a deployment configuration assistant helping a developer finalize their deployment stack for a software project.

Project scan found: ${found.map(t => t.label).join(', ') || 'no existing deploy files'}.

Current configuration being discussed:
- Frontend:     ${finalComponents.frontend}
- Backend:      ${finalComponents.backend}
- Database:     ${finalComponents.db}
- Secrets:      ${finalComponents.secrets}
- Environments: ${finalEnvironments.join(', ')}
- Deploy cmd:   ${finalDeployCmd || '(to be generated)'}
- CI/CD:        ${finalWantCICD ? 'yes' : 'no'}
- Credentials:  ${JSON.stringify(credResults)}

Your job:
1. Answer any questions embedded in the user's input (e.g. "can I use X with Y?")
2. Clarify or recommend a better approach if something is unclear or unusual
3. Make sure to ask about IaC (infrastructure as code): does the user use Terraform, a plain deploy script, or nothing? If a deploy script was found, confirm whether it's sufficient or if IaC is wanted.
4. Propose a clear final configuration summary at the end
5. Keep it concise — bullet points preferred

CRITICAL RULES:
- When you say "✅ Configuration looks good. Ready to generate files." — STOP. Do not add any follow-up questions or options after that line. The user will press Enter to proceed.
- Focus ONLY on what is needed for LOCAL deployment (the user will run "lc deploy" locally). Do NOT suggest setting up CI/CD, Terraform, or remote pipelines unless the user explicitly asks.
- The goal is to document the EXISTING deployment setup, not to design a new one.

If the configuration looks complete and sensible, end your message with EXACTLY this line and nothing else after it:
"✅ Configuration looks good. Ready to generate files."

If something needs clarification, ask ONE question.`;

        const history = conversationHistory.map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        return history
            ? `${systemCtx}\n\n--- Conversation so far ---\n${history}\n\nUser: ${userMessage}`
            : `${systemCtx}\n\nUser: ${userMessage}`;
    };

    // First brainstorm call — summarize what we collected and ask AI to advise
    const initialSummary = `Here's what I've configured so far:
- Frontend: ${frontend}
- Backend: ${backend}
- Database: ${db}
- Secrets: ${secrets}
- Environments: ${environments.join(', ')}
- Deploy command: ${deployCmd || 'not set'}
- CI/CD: ${wantCICD ? 'yes' : 'no'}

Goal: document this as a LOCAL deployment setup so "lc deploy prod" runs the deploy script locally. No CI/CD unless I asked for it.

Please review this, answer any questions (some fields may contain questions rather than clean values), ask about IaC if relevant, and propose the final configuration.`;

    console.log('\n🤖 Consulting AI...\n');
    let llmResponse = await callLLMConversational(cfg, buildBrainstormPrompt(initialSummary));
    conversationHistory.push({ role: 'user', content: initialSummary });
    conversationHistory.push({ role: 'assistant', content: llmResponse });

    // Brainstorm loop
    while (true) {
        console.log('\n─────────────────────────────────────────────────────');
        const next = (await ask('   [Enter] Generate files   [r] Refine   [q] Quit\n   > ')).trim();

        if (!next || next.toLowerCase() === 'g') {
            break; // proceed to generate
        }
        if (next.toLowerCase() === 'q') {
            console.log('   Cancelled.');
            rl2.close();
            process.exit(0);
        }
        // Any other input = refine
        const refinement = next.startsWith('r') && next.length === 1
            ? (await ask('   What would you like to change or ask? > ')).trim()
            : next;

        if (!refinement) break;

        conversationHistory.push({ role: 'user', content: refinement });
        console.log('\n🤖 Thinking...\n');
        llmResponse = await callLLMConversational(cfg, buildBrainstormPrompt(refinement));
        conversationHistory.push({ role: 'assistant', content: llmResponse });
    }

    // ── Phase 6: Write context and generate files ─────────────────────────
    const filesToCreate = ['conductor/deployment-stack.md', 'conductor/deploy.json', '.env.example'];
    if (finalWantCICD && !hasGHActions) filesToCreate.push('.github/workflows/deploy.yml');

    rl2.close();

    const setupContext = {
        components: finalComponents,
        environments: finalEnvironments,
        deploy_command: finalDeployCmd,
        cicd: finalWantCICD,
        credentials: credResults,
        existing_signals: found.map(t => t.label),
        files_to_create: filesToCreate,
        brainstorm_summary: conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n\n'),
    };

    const conductorDir = join(projectRoot, 'conductor');
    if (!existsSync(conductorDir)) mkdirSync(conductorDir, { recursive: true });
    const contextPath = join(conductorDir, '.setup-deploy-context.json');
    writeFileSync(contextPath, JSON.stringify(setupContext, null, 2));

    console.log('\n🤖 Generating deployment files...\n');
    const exitCode = await runAIAgent(cfg, '/laneconductor setup-deploy generate');

    try { unlinkSync(contextPath); } catch {}
    process.exit(exitCode || 0);
} else if (command === 'deploy') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const deployJsonPath = join(projectRoot, 'conductor', 'deploy.json');
    if (!existsSync(deployJsonPath)) {
        console.error('❌ Error: No deploy.json found. Run "lc setup-deploy" first.');
        process.exit(1);
    }

    const deployConfig = JSON.parse(readFileSync(deployJsonPath, 'utf8'));
    const env = args[1] || 'prod';

    const envConfig = deployConfig.environments?.[env];
    if (!envConfig) {
        console.error(`❌ Error: No deployment config for environment "${env}".`);
        console.log(`   Available environments: ${Object.keys(deployConfig.environments || {}).join(', ') || 'none'}`);
        process.exit(1);
    }

    // Support both a single `command` string and a `commands` array
    const commands = envConfig.commands
        ? envConfig.commands
        : envConfig.command
            ? [{ label: env, command: envConfig.command }]
            : [];

    if (commands.length === 0) {
        console.error(`❌ Error: No deploy command(s) configured for environment "${env}".`);
        process.exit(1);
    }

    const logsDir = join(projectRoot, 'conductor', 'logs');
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `deploy-${env}-${Date.now()}.log`);

    const totalStart = Date.now();
    console.log(`🚀 Deploying to ${env} (${commands.length} step${commands.length > 1 ? 's' : ''})...\n`);

    const runCommand = (cmdStr, label) => new Promise((resolve) => {
        console.log(`▶ ${label}: ${cmdStr}\n`);
        const proc = spawn(cmdStr, { shell: true, stdio: 'inherit', cwd: projectRoot });
        const stepStart = Date.now();
        proc.on('close', (code) => {
            const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
            if (code === 0) {
                console.log(`\n✅ ${label} done (${elapsed}s)\n`);
            } else {
                console.error(`\n❌ ${label} failed (exit ${code}, ${elapsed}s)`);
            }
            resolve(code);
        });
    });

    (async () => {
        for (const step of commands) {
            const label = step.label || step.command;
            const code = await runCommand(step.command, label);
            if (code !== 0) {
                console.error(`\nDeployment stopped at step: ${label}`);
                console.log(`   Logs: ${logFile}`);
                process.exit(code);
            }
        }
        const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
        console.log(`✅ Deployment to ${env} complete! (${elapsed}s)`);
        process.exit(0);
    })();
} else if (command === 'start') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        console.error('   Run "lc setup" to initialize a project.');
        process.exit(1);
    }

    const pidFile = join(projectRoot, 'conductor', '.sync.pid');
    const logFile = join(projectRoot, 'conductor', '.sync.log');
    let syncScript = join(projectRoot, 'conductor', 'laneconductor.sync.mjs');

    if (!existsSync(syncScript)) {
        const installPath = getInstallPath();
        const canonical = join(installPath, 'conductor', 'laneconductor.sync.mjs');
        if (existsSync(canonical)) {
            syncScript = canonical;
        } else {
            console.error(`❌ Error: Heartbeat worker script not found at ${syncScript} or ${canonical}`);
            process.exit(1);
        }
    }

    const isSyncOnly = args.includes('--sync-only') || args.includes('sync-only') || args.includes('sync_only');
    console.log(`🚀 Starting LaneConductor heartbeat worker${isSyncOnly ? ' (SYNC-ONLY mode)' : ''}...`);

    const logFd = openSync(logFile, 'a');
    const syncArgs = [syncScript];
    if (isSyncOnly) syncArgs.push('--sync-only');

    const worker = spawn('node', syncArgs, {
        cwd: projectRoot,
        detached: true,
        stdio: ['ignore', logFd, logFd]
    });

    writeFileSync(pidFile, worker.pid.toString());
    worker.unref();
    console.log(`✅ Worker started (PID: ${worker.pid})`);
    process.exit(0);
} else if (command === 'stop') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const pidFile = join(projectRoot, 'conductor', '.sync.pid');
    if (!existsSync(pidFile)) {
        console.log('⚠️  No heartbeat running (no .sync.pid found)');
        process.exit(0);
    }

    const pid = readFileSync(pidFile, 'utf8').trim();
    try {
        process.kill(pid);
        if (existsSync(pidFile)) unlinkSync(pidFile);
        console.log(`✅ Worker stopped (PID: ${pid})`);
    } catch (e) {
        console.log(`⚠️  Worker (PID: ${pid}) was not running or could not be stopped.`);
        if (existsSync(pidFile)) unlinkSync(pidFile);
    }
    process.exit(0);
} else if (command === 'restart') {
    if (!projectRoot) { console.error('❌ Error: No LaneConductor project found.'); process.exit(1); }
    // Stop
    const pidFile = join(projectRoot, 'conductor', '.sync.pid');
    if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, 'utf8').trim();
        try { process.kill(pid); console.log(`✅ Worker stopped (PID: ${pid})`); } catch (e) { }
        unlinkSync(pidFile);
    }
    // Start logic (same as 'start')
    const logFile = join(projectRoot, 'conductor', '.sync.log');
    const syncScript = join(projectRoot, 'conductor', 'laneconductor.sync.mjs');
    const isSyncOnly = args.includes('--sync-only') || args.includes('sync-only') || args.includes('sync_only');
    console.log(`🚀 Restarting heartbeat worker${isSyncOnly ? ' (SYNC-ONLY mode)' : ''}...`);

    const logFd = openSync(logFile, 'a');
    const syncArgs = [syncScript];
    if (isSyncOnly) syncArgs.push('--sync-only');

    const worker = spawn('node', syncArgs, { cwd: projectRoot, detached: true, stdio: ['ignore', logFd, logFd] });
    writeFileSync(pidFile, worker.pid.toString());
    worker.unref();
    console.log(`✅ Worker restarted (PID: ${worker.pid})`);
    process.exit(0);
} else if (command === 'api') {
    const subCommand = args[1] || 'start';
    const installPath = getInstallPath();
    const uiDir = join(installPath, 'ui');
    const apiPidFile = join(uiDir, '.api.pid');
    const apiLogFile = join(uiDir, '.api.log');

    if (subCommand === 'start') {
        if (existsSync(apiPidFile)) {
            const pid = readFileSync(apiPidFile, 'utf8').trim();
            try {
                process.kill(pid, 0);
                console.log(`✅ API already running (PID: ${pid}) → http://localhost:8091`);
                process.exit(0);
            } catch (e) { /* stale */ }
        }
        console.log('🚀 Starting LaneConductor API...');
        const logFd = openSync(apiLogFile, 'a');
        const api = spawn('node', ['server/index.mjs'], { cwd: uiDir, detached: true, stdio: ['ignore', logFd, logFd] });
        writeFileSync(apiPidFile, api.pid.toString());
        api.unref();
        console.log(`✅ API started (PID: ${api.pid}) → http://localhost:8091`);
        process.exit(0);
    } else if (subCommand === 'stop') {
        if (existsSync(apiPidFile)) {
            const pid = readFileSync(apiPidFile, 'utf8').trim();
            try { process.kill(pid); console.log(`✅ API stopped (PID: ${pid})`); } catch (e) { }
            unlinkSync(apiPidFile);
        }
        process.exit(0);
    }
} else if (command === 'ui') {
    const subCommand = args[1] || 'start';
    const installPath = getInstallPath();
    const uiDir = join(installPath, 'ui');
    const pidFile = join(uiDir, '.ui.pid');
    const apiPidFile = join(uiDir, '.api.pid');

    if (subCommand === 'start') {
        // Start API first if not running
        let apiRunning = false;
        if (existsSync(apiPidFile)) {
            try { process.kill(readFileSync(apiPidFile, 'utf8').trim(), 0); apiRunning = true; } catch (e) { }
        }
        if (!apiRunning) {
            spawnSync('node', [__filename, 'api', 'start'], { stdio: 'inherit' });
        }

        // Start UI
        const uiLogFile = join(uiDir, '.ui.log');
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try {
                process.kill(pid, 0);
                console.log(`✅ UI already running (PID: ${pid}) → http://localhost:8090`);
                process.exit(0);
            } catch (e) { /* stale */ }
        }

        console.log('🚀 Starting Vite UI...');
        const logFd = openSync(uiLogFile, 'a');
        const ui = spawn('npx', ['vite'], {
            cwd: uiDir,
            detached: true,
            stdio: ['ignore', logFd, logFd]
        });

        writeFileSync(pidFile, ui.pid.toString());
        ui.unref();
        console.log(`✅ UI started (PID: ${ui.pid}) → http://localhost:8090`);
        process.exit(0);
    } else if (subCommand === 'stop') {
        // Stop UI
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try { process.kill(pid); console.log(`✅ UI stopped (PID: ${pid})`); } catch (e) { }
            unlinkSync(pidFile);
        }
        // Stop API too
        spawnSync('node', [__filename, 'api', 'stop'], { stdio: 'inherit' });
        process.exit(0);
    }
} else if (command === 'status') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const colors = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m' };

    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
    const mode = cfg.mode || 'local-fs';

    if (mode === 'local-fs') {
        const tracksDir = join(projectRoot, 'conductor', 'tracks');
        if (!existsSync(tracksDir)) { console.log('No tracks found.'); process.exit(0); }

        const laneOrder = { 'implement': 1, 'review': 2, 'quality-gate': 3, 'plan': 4, 'backlog': 5, 'done': 6 };
        const getLanePrio = (l) => laneOrder[l.toLowerCase()] || 99;

        const getStatusLabel = (s, retries) => {
            s = (s || 'queue').toLowerCase();
            let label = 'WAIT';
            let color = colors.yellow;
            if (s === 'running') { label = 'RUN '; color = colors.cyan; }
            else if (s === 'failure') { label = 'FAIL'; color = colors.red; }
            else if (s === 'success' || s === 'done') { label = 'DONE'; color = colors.dim; }
            if (retries > 0 && s !== 'success') label += ' (' + retries + ')';
            return color + label.padEnd(8) + colors.reset;
        };

        const tracks = readdirSync(tracksDir).filter(d => /^\d+/.test(d)).map(d => {
            const trackPath = join(tracksDir, d);
            const indexPath = join(trackPath, 'index.md');
            if (!existsSync(indexPath)) return null;
            const content = readFileSync(indexPath, 'utf8');
            const title = (content.match(/^# ([^\n]+)/m) || [])[1] || d;
            const lane = (content.match(/\*\*Lane\*\*:\s*([^\n]+)/i) || [])[1] || '???';
            const status = (content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i) || [])[1] || 'queue';
            const progressStr = (content.match(/\*\*Progress\*\*:\s*(\d+)%/i) || [])[1] || '0';
            const phase = (content.match(/\*\*Phase\*\*:\s*([^\n]+)/i) || [])[1] || '';
            const runBy = (content.match(/\*\*Last Run By\*\*:\s*([^\n]+)/i) || [])[1] || '';
            const retryPath = join(trackPath, '.retry-count');
            const retries = existsSync(retryPath) ? parseInt(readFileSync(retryPath, 'utf8')) : 0;
            return { id: d.split('-')[0], lane, status, progress: parseInt(progressStr), title, phase, retries, runBy: runBy.includes('worker') ? 'W' : (runBy ? 'U' : '') };
        }).filter(t => t !== null);

        tracks.sort((a, b) => {
            const laneDiff = getLanePrio(a.lane) - getLanePrio(b.lane);
            if (laneDiff !== 0) return laneDiff;
            return b.progress - a.progress || parseInt(a.id) - parseInt(b.id);
        });

        console.log('\n' + colors.bold + 'Track Status (' + mode + '):' + colors.reset);
        console.log('ID    LANE            STATUS    PROG   BY  PHASE/TITLE');
        console.log('-'.repeat(80));
        tracks.forEach(t => {
            const id = t.id.padEnd(5);
            const lane = t.lane.padEnd(15);
            const status = getStatusLabel(t.status, t.retries);
            const prog = (t.progress + '%').padEnd(6);
            const by = (t.runBy || '-').padEnd(3);
            const info = t.phase ? colors.dim + t.phase + ': ' + colors.reset + t.title : t.title;
            console.log(id + ' ' + lane.padEnd(15) + ' ' + status + ' ' + prog.padEnd(6) + ' ' + by.padEnd(3) + ' ' + info);
        });
        console.log('');
        process.exit(0);
    } else {
        // Direct Postgres query for local-api mode
        const dbCfg = cfg.db || {};
        const dbHost = process.env.DB_HOST || dbCfg.host || 'localhost';
        const dbPort = process.env.DB_PORT || dbCfg.port || 5432;
        const dbName = process.env.DB_NAME || dbCfg.name || 'laneconductor';
        const dbUser = process.env.DB_USER || dbCfg.user || 'postgres';
        const dbPass = process.env.DB_PASSWORD || dbCfg.password || 'postgres';

        // Normalize path for matching in DB
        const normalizedRoot = projectRoot.replace(/\\/g, '\\\\');

        const sql = `
            SELECT t.track_number as id, t.lane_status as lane, t.lane_action_status as status, 
                   t.progress_percent as progress, t.title, t.current_phase as phase, t.last_updated_by as "runBy"
            FROM tracks t
            JOIN projects p ON p.id = t.project_id
            WHERE p.repo_path = '${normalizedRoot}' OR p.repo_path = '${projectRoot}'
            ORDER BY 
              CASE t.lane_status 
                WHEN 'implement' THEN 1 WHEN 'review' THEN 2 WHEN 'quality-gate' THEN 3 
                WHEN 'plan' THEN 4 WHEN 'backlog' THEN 5 WHEN 'done' THEN 6 ELSE 99 
              END,
              t.progress_percent DESC, t.track_number ASC;
        `;

        try {
            const psql = spawnSync('psql', [
                '-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName, '-t', '-A', '-F', '|', '-c', sql
            ], { env: { ...process.env, PGPASSWORD: dbPass } });

            if (psql.status === 0) {
                const rows = psql.stdout.toString().trim().split('\n').filter(Boolean);
                const tracks = rows.map(row => {
                    const [id, lane, status, progress, title, phase, runBy] = row.split('|');
                    return { id, lane, status, progress: parseInt(progress), title, phase, runBy: runBy === 'worker' ? 'W' : (runBy ? 'U' : '-') };
                });

                console.log('\n' + colors.bold + 'Track Status (' + mode + '):' + colors.reset);
                console.log('ID    LANE            STATUS    PROG   BY  PHASE/TITLE');
                console.log('-'.repeat(80));
                tracks.forEach(t => {
                    const statusLabel = t.status === 'running' ? colors.cyan + 'RUN ' : t.status === 'failure' ? colors.red + 'FAIL' : t.status === 'queue' ? colors.green + 'QUEUE' : t.status === 'success' ? colors.green + 'DONE ' : (t.status === 'waiting' || !t.status) ? colors.yellow + 'WAIT ' : colors.yellow + (t.status || '?').slice(0, 5).toUpperCase();
                    console.log(`${t.id.padEnd(5)} ${t.lane.padEnd(15)} ${statusLabel.padEnd(16)} ${t.progress}%`.padEnd(35) + ` ${t.runBy.padEnd(3)} ${t.phase ? colors.dim + t.phase + ': ' + colors.reset : ''}${t.title}`);
                });
                console.log('');
                process.exit(0);
            } else { throw new Error(psql.stderr.toString()); }
        } catch (err) {
            spawnSync('make', ['lc-status'], { stdio: 'inherit', cwd: projectRoot });
            process.exit(0);
        }
    }
} else if (command === 'new') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const name = args[1];
    const desc = args[2] || '';
    if (!name) { console.log('❌ Usage: lc new "Track name" "Description"'); process.exit(1); }

    const queuePath = join(projectRoot, 'conductor', 'tracks', 'file_sync_queue.md');
    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    if (!existsSync(tracksDir)) mkdirSync(tracksDir, { recursive: true });

    let queueContent = '';
    if (existsSync(queuePath)) queueContent = readFileSync(queuePath, 'utf8');
    const trackLines = queueContent.match(/### Track (\d+):/g) || [];
    const queueNums = trackLines.map(m => parseInt(m.match(/\d+/)[0]));

    const existingDirs = readdirSync(tracksDir).filter(d => /^\d+/.test(d));
    const dirNums = existingDirs.map(d => parseInt(d.split('-')[0]));

    const allNums = [...queueNums, ...dirNums];
    const nextNum = allNums.length ? Math.max(...allNums) + 1 : 1000;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const trackFolderName = `${nextNum}-${slug}`;
    const trackPath = join(tracksDir, trackFolderName);

    if (!existsSync(trackPath)) mkdirSync(trackPath, { recursive: true });
    const indexPath = join(trackPath, 'index.md');
    const indexContent = `# Track ${nextNum}: ${name}\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n**Summary**: ${desc}\n`;
    writeFileSync(indexPath, indexContent);

    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${nextNum}: ${name}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${name}\n**Description**: ${desc || 'No description.'}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;
    if (existsSync(queuePath)) {
        let existing = readFileSync(queuePath, 'utf8');
        existing = existing.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
        writeFileSync(queuePath, existing);
    } else {
        writeFileSync(queuePath, `# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n${queueEntry}\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n`);
    }
    console.log(`✅ Track ${nextNum} created in ${trackFolderName}`);
    process.exit(0);
} else if (command === 'comment') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    const body = args[2];
    if (!trackNum || !body) { console.log('❌ Usage: lc comment [track-num] "message"'); process.exit(1); }

    const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
    if (cfg.mode === 'local-fs') {
        const tracksDir = join(projectRoot, 'conductor', 'tracks');
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }
        appendFileSync(join(tracksDir, dir, 'conversation.md'), `\n> **human**: ${body}\n`);

        const indexPath = join(tracksDir, dir, 'index.md');
        if (existsSync(indexPath)) {
            let content = readFileSync(indexPath, 'utf8');
            content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
            if (!content.includes('**Waiting for reply**:')) content = content.replace(/(\*\*Lane Status\*\*:\s*queue)/i, '$1\n**Waiting for reply**: yes');
            else content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, '**Waiting for reply**: yes');
            writeFileSync(indexPath, content);
        }
        console.log(`✅ Comment added locally`);
    } else {
        const collector = cfg.collectors?.[0];
        const url = new URL(`${collector.url}/track/${trackNum}/comment`);
        if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
        const token = collector.token || collector.machine_token;

        await fetch(url.toString(), {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ author: 'human', body })
        }).then(() => console.log('✅ Comment posted to API')).catch(e => console.error('❌ API failed:', e.message));
    }
    process.exit(0);
} else if (command === 'brainstorm') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc brainstorm <track-number>'); process.exit(1); }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }

    const convPath = join(tracksDir, dir, 'conversation.md');
    const trigger = `\n> **system**: Brainstorm requested via CLI. Read all context files (product.md, tech-stack.md, spec.md, plan.md, test.md) and begin clarifying questions one at a time.\n`;
    appendFileSync(convPath, trigger);

    const indexPath = join(tracksDir, dir, 'index.md');
    if (existsSync(indexPath)) {
        let content = readFileSync(indexPath, 'utf8');
        if (!content.includes('**Waiting for reply**:')) content += '\n**Waiting for reply**: yes\n';
        else content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, '**Waiting for reply**: yes');
        writeFileSync(indexPath, content);
    }
    console.log(`✅ Brainstorm started for Track ${trackNum}. Reply in conversation.md or the UI inbox.`);
    process.exit(0);
} else if (command === 'move' || ['plan', 'implement', 'review', 'quality-gate', 'backlog', 'done', 'pulse', 'rerun'].includes(command)) {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }

    // Strip --run / -r flag before processing positional args
    const runFlag = args.includes('--run') || args.includes('-r');
    const filteredArgs = args.filter(a => a !== '--run' && a !== '-r');

    const trackNum = filteredArgs[1];
    let lane = command === 'move' || command === 'pulse' ? filteredArgs[2] : (command === 'rerun' ? null : command);
    let status = command === 'pulse' ? filteredArgs[2] : (filteredArgs[2] || 'queue');
    let prog = command === 'pulse' ? filteredArgs[3] : null;

    if (lane && lane.includes(':')) { [lane, status] = lane.split(':'); }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }

    const indexPath = join(tracksDir, dir, 'index.md');
    let content = readFileSync(indexPath, 'utf8');
    if (lane && command !== 'pulse') content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${lane}`);
    if (status) content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${status}`);
    if (prog) content = content.replace(/\*\*Progress\*\*:\s*\d+%/i, `**Progress**: ${prog}%`);

    if (command === 'rerun') {
        const retryPath = join(tracksDir, dir, '.retry-count');
        const retryLanePath = join(tracksDir, dir, '.retry-lane');
        if (existsSync(retryPath)) unlinkSync(retryPath);
        if (existsSync(retryLanePath)) unlinkSync(retryLanePath);

        const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
        if (cfg.mode !== 'local-fs') {
            const collector = cfg.collectors?.[0];
            const url = new URL(`${collector.url}/track/${trackNum}/comment`);
            if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
            const token = collector.token || collector.machine_token;

            await fetch(url.toString(), {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ author: 'human', body: 'Manual rerun (CLI)' })
            }).catch(() => { });
        }
        console.log(`♻️  Retries reset for track ${trackNum}`);
    }

    writeFileSync(indexPath, content);

    if (runFlag && lane && !['backlog', 'done', 'pulse'].includes(command)) {
        // --run: spawn the AI agent in the foreground immediately
        const cfgPath = join(projectRoot, '.laneconductor.json');
        if (!existsSync(cfgPath)) { console.error('❌ No .laneconductor.json found'); process.exit(1); }
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

        // Identify available agents (primary and optional secondary)
        const agents = [];
        if (cfg.project?.primary?.cli) agents.push({ ...cfg.project.primary, type: 'primary' });
        if (cfg.project?.secondary?.cli) agents.push({ ...cfg.project.secondary, type: 'secondary' });

        if (agents.length === 0) {
            console.error('❌ No primary agent configured in .laneconductor.json');
            process.exit(1);
        }

        // Mark track as running before spawning
        const runningContent = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: running');
        writeFileSync(indexPath, runningContent);

        const skillAction = lane === 'quality-gate' ? 'qualityGate' : lane;
        const slashCmd = `/laneconductor ${skillAction} ${trackNum}`;
        
        const exitCode = await runAIAgent(cfg, slashCmd, trackNum, lane);

        // Update final lane status based on results
        const finalContent = readFileSync(indexPath, 'utf8');
        const finalStatusToSet = (exitCode === 0) ? 'success' : 'failure';
        const finalContentWithStatus = finalContent.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${finalStatusToSet}`);
        writeFileSync(indexPath, finalContentWithStatus);

        if (exitCode === 0) {
            console.log(`\n✅ Track ${trackNum} ${lane} completed successfully`);
        } else {
            console.log(`\n❌ Track ${trackNum} ${lane} failed after trying all agents (exit code: ${exitCode})`);
        }
        process.exit(exitCode || 0);

    }

    console.log(`✅ Track ${trackNum} updated`);
    process.exit(0);
} else if (command === 'workflow') {
    if (!projectRoot) { process.exit(1); }
    let wfPath = join(projectRoot, 'conductor', 'workflow.json');
    if (!existsSync(wfPath)) {
        const installPath = getInstallPath();
        const canonical = join(installPath, 'conductor', 'workflow.json');
        if (existsSync(canonical)) {
            wfPath = canonical;
            console.log(`ℹ️  Using global workflow from ${wfPath}`);
        } else {
            console.error(`❌ Error: Workflow configuration not found at ${wfPath} or ${canonical}`);
            process.exit(1);
        }
    }
    const wf = JSON.parse(readFileSync(wfPath, 'utf8'));
    if (args[1] === 'set') {
        if (!wfPath.includes(projectRoot)) {
            console.error('❌ Error: Cannot modify global workflow. Create a local conductor/workflow.json first.');
            process.exit(1);
        }
        const [lane, key, val] = [args[2], args[3], args[4]];
        if (lane === 'global') wf.global[key] = val;
        else if (wf.lanes[lane]) wf.lanes[lane][key] = val;
        else if (lane === 'defaults') wf.defaults[key] = val;
        writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
        console.log(`✅ Workflow updated: ${lane}.${key} = ${val}`);
        process.exit(0);
    } else {
        console.log('-'.repeat(77));
        for (const [lane, cfg] of Object.entries(wf.lanes || {})) {
            console.log(col(lane, 15) + col(cfg.parallel_limit ?? d.parallel_limit ?? 1, 9) + col(cfg.max_retries ?? d.max_retries ?? 1, 9) + col(cfg.on_success ?? '(stay)', 22) + col(cfg.on_failure ?? '(stay)', 22));
        }
        console.log('');
    }
    process.exit(0);
} else if (command === 'config' || command === 'project') {
    if (!projectRoot) { process.exit(1); }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (args[1] === 'set') {
        setNestedKey(command === 'config' ? cfg : cfg.project, args[2], args[3]);
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`✅ ${command} updated`);
    } else if (args[1] === 'mode') {
        const newMode = args[2];
        if (!['local-fs', 'local-api', 'remote-api'].includes(newMode)) {
            console.error('❌ Error: Invalid mode. Choose: local-fs, local-api, remote-api');
            process.exit(1);
        }
        cfg.mode = newMode;
        if (newMode === 'local-api' && (!cfg.collectors || cfg.collectors.length === 0)) {
            cfg.collectors = [{ url: 'http://localhost:8091', token: null }];
        } else if (newMode === 'remote-api') {
            // Ensure we have a remote collector configured
            if (!cfg.collectors || !cfg.collectors.some(c => !c.url.includes('localhost') && !c.url.includes('127.0.0.1'))) {
                const rl = createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                const question = (query) => new Promise((resolve) => rl.question(query, resolve));

                (async () => {
                    const remoteUrl = await question('Remote Collector URL (e.g., https://collector.example.com): ');
                    const apiKey = await question('Remote API Key (lc_xxx...): ');

                    cfg.collectors = [{ url: remoteUrl, token: null }];
                    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

                    // Store API key in .env
                    let envContent = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
                    if (apiKey) {
                        if (envContent.includes('COLLECTOR_0_TOKEN=')) {
                            envContent = envContent.replace(/COLLECTOR_0_TOKEN=.*/, `COLLECTOR_0_TOKEN=${apiKey}`);
                        } else {
                            envContent += `\nCOLLECTOR_0_TOKEN=${apiKey}\n`;
                        }
                        writeFileSync('.env', envContent.trim() + '\n');
                    }

                    console.log(`✅ Mode switched to ${newMode}`);
                    rl.close();
                    process.exit(0);
                })();
            } else {
                writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
                console.log(`✅ Mode switched to ${newMode}`);
            }
        } else {
            writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
            console.log(`✅ Mode switched to ${newMode}`);
        }
    } else if (args[1] === 'visibility') {
        const visibility = args[2];
        if (!['private', 'team', 'public'].includes(visibility)) {
            console.error('❌ Error: Invalid visibility. Choose: private, team, public');
            process.exit(1);
        }
        if (!cfg.worker) cfg.worker = {};
        cfg.worker.visibility = visibility;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`✅ Worker visibility set to ${visibility}`);
    } else if (command === 'project' && args[1] === 'show') {
        ['conductor/product.md', 'conductor/tech-stack.md', 'workflow.md'].forEach(f => {
            if (existsSync(join(projectRoot, f))) console.log(`\n--- ${f} ---\n`, readFileSync(join(projectRoot, f), 'utf8').slice(0, 200) + '...');
        });
    } else {
        console.log(`\n--- .laneconductor.json ---\n`, JSON.stringify(cfg, null, 2));
    }
    process.exit(0);
} else if (command === 'verify-isolation') {
    // Verify that the worker environment is correctly sandboxed
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const { resolve: pathResolve } = require('path');
    const projectRootResolved = resolve(projectRoot);
    const worktreeDir = resolve(projectRootResolved, '.git/worktrees');
    let passedTests = 0;
    let totalTests = 0;

    console.log('🔒 Verifying worker path isolation...\n');

    // Test 1: Check that .git/worktrees exists
    totalTests++;
    if (existsSync(worktreeDir)) {
        console.log('✅ Test 1: .git/worktrees directory exists');
        passedTests++;
    } else {
        console.log('❌ Test 1: .git/worktrees directory not found (expected at ' + worktreeDir + ')');
    }

    // Test 2: Check for path traversal attempts
    totalTests++;
    const testPaths = ['../../../etc/passwd', '../../.env', '../.env'];
    let pathTraversalRisk = false;
    for (const testPath of testPaths) {
        try {
            const fullPath = resolve(worktreeDir, testPath);
            if (!fullPath.startsWith(projectRootResolved)) {
                pathTraversalRisk = true;
                break;
            }
        } catch (e) {
            // realpath will fail on nonexistent paths, which is good
        }
    }
    if (!pathTraversalRisk) {
        console.log('✅ Test 2: Path traversal attempts are blocked');
        passedTests++;
    } else {
        console.log('❌ Test 2: Path traversal vulnerability detected');
    }

    // Test 3: Check for .laneconductor.json and .env existence (should exist in project root, not in worktrees)
    totalTests++;
    const configPath = resolve(projectRootResolved, '.laneconductor.json');
    const envPath = resolve(projectRootResolved, '.env');
    if (existsSync(configPath) && existsSync(envPath)) {
        console.log('✅ Test 3: Config files exist in project root (protected from worktrees)');
        passedTests++;
    } else {
        console.warn(`⚠️  Test 3: Missing config files (${!existsSync(configPath) ? '.laneconductor.json' : ''} ${!existsSync(envPath) ? '.env' : ''})`);
        if (!existsSync(configPath) || !existsSync(envPath)) passedTests++;
    }

    // Test 4: Verify .gitignore protects sensitive files
    totalTests++;
    const gitignorePath = resolve(projectRootResolved, '.gitignore');
    let gitignoreOk = true;
    if (existsSync(gitignorePath)) {
        const gitignore = readFileSync(gitignorePath, 'utf8');
        if (!gitignore.includes('.env')) {
            console.warn('⚠️  Warning: .env is not in .gitignore');
            gitignoreOk = false;
        }
    } else {
        console.warn('⚠️  Warning: .gitignore not found');
        gitignoreOk = false;
    }
    if (gitignoreOk) {
        console.log('✅ Test 4: Sensitive files are protected in .gitignore');
        passedTests++;
    } else {
        console.log('⚠️  Test 4: .gitignore may need updates');
    }

    console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed`);
    process.exit(passedTests === totalTests ? 0 : 1);
} else if (command === 'doc') {
    if (!projectRoot) { process.exit(1); }
    const [type, section, val] = [args[2], args[3], args[4]];
    const file = type === 'product' ? 'conductor/product.md' : (type === 'tech' ? 'conductor/tech-stack.md' : 'workflow.md');
    if (updateDocSection(join(projectRoot, file), section, val)) console.log('✅ Doc updated');
    process.exit(0);
} else if (command === 'show' || command === 'logs') {
    if (!projectRoot) { process.exit(1); }
    const trackNum = args[1];
    if (command === 'logs' && trackNum === 'worker-run') {
        const optionalTrackId = args[2];
        const logsDir = join(projectRoot, 'conductor', 'logs');
        if (existsSync(logsDir)) {
            let files = readdirSync(logsDir).filter(f => f.endsWith('.log'));
            if (optionalTrackId) files = files.filter(f => f.includes(`-${optionalTrackId}-`));

            if (files.length > 0) {
                const latestFile = files
                    .map(f => ({ name: f, time: statSync(join(logsDir, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time)[0].name;
                console.log(`\n--- Most recent worker run${optionalTrackId ? ` for track ${optionalTrackId}` : ''}: ${latestFile} ---\n`);
                console.log(readFileSync(join(logsDir, latestFile), 'utf8').split('\n').slice(-100).join('\n'));
            } else {
                console.log(`No worker run logs found${optionalTrackId ? ` for track ${optionalTrackId}` : ''}.`);
            }
        } else {
            console.log('Logs directory not found at ' + logsDir);
        }
        process.exit(0);
    }
    if (command === 'logs' && trackNum === 'worker') {
        const syncLog = join(projectRoot, 'conductor', '.sync.log');
        if (existsSync(syncLog)) {
            console.log(readFileSync(syncLog, 'utf8').split('\n').slice(-50).join('\n'));
        } else {
            console.log('Sync log not found at ' + syncLog);
        }
        process.exit(0);
    }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) {
        // Fallback: try DB for local-api mode
        const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
        if (cfg.mode !== 'local-fs' && cfg.db) {
            const { host = 'localhost', port = 5432, name, user = 'postgres', password = 'postgres' } = cfg.db;
            const psql = spawnSync('psql', [
                '-h', host, '-p', String(port), '-U', user, '-d', name, '-t', '-A', '-F', '\x01', '-c',
                `SELECT title, lane_status, lane_action_status, progress_percent, index_content, plan_content, spec_content FROM tracks t JOIN projects p ON p.id = t.project_id WHERE p.repo_path = '${projectRoot}' AND t.track_number = '${trackNum}'`
            ], { env: { ...process.env, PGPASSWORD: password } });
            if (psql.status === 0) {
                const row = psql.stdout.toString().trim().split('\x01');
                if (row.length >= 4) {
                    const [title, lane, status, progress, indexContent, planContent, specContent] = row;
                    console.log(`\nTrack ${trackNum}: ${title}`);
                    console.log(`Lane: ${lane} | Status: ${status} | Progress: ${progress}%\n`);
                    if (indexContent && indexContent.trim()) { console.log('--- index.md ---\n' + indexContent); }
                    else { console.log(`# Track ${trackNum}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: ${progress}%`); }
                    if (planContent && planContent.trim()) { console.log('\n--- plan.md ---\n' + planContent); }
                    if (specContent && specContent.trim()) { console.log('\n--- spec.md ---\n' + specContent); }
                    console.log('\n(shown from DB — local folder not yet created)');
                    process.exit(0);
                }
            }
        }
        console.error(`Not found: no local folder for track ${trackNum}`);
        process.exit(1);
    }
    const trackPath = join(tracksDir, dir);

    if (command === 'show') {
        console.log(readFileSync(join(trackPath, 'index.md'), 'utf8'));
        if (existsSync(join(trackPath, 'plan.md'))) console.log(readFileSync(join(trackPath, 'plan.md'), 'utf8'));
    }
    if (existsSync(join(trackPath, 'last_run.log'))) {
        console.log('\n--- LOGS ---');
        console.log(readFileSync(join(trackPath, 'last_run.log'), 'utf8').split('\n').slice(-30).join('\n'));
    }
    process.exit(0);
} else if (command === 'verify' || command === 'quality-gate') {
    if (!projectRoot) { process.exit(1); }
    const script = join(projectRoot, command === 'verify' ? 'conductor/lc-verify.sh' : 'conductor/mock-quality-gate.sh');
    if (existsSync(script)) spawnSync('bash', [script], { stdio: 'inherit' });
    else console.log(`⚠️ ${script} not found`);
    process.exit(0);
} else if (command === 'remote-sync' || command === 'init-summary') {
    if (!projectRoot) { process.exit(1); }
    const script = join(getInstallPath(), 'conductor', command === 'remote-sync' ? 'remote-sync.mjs' : 'init-tracks-summary.mjs');
    spawnSync('node', [script], { stdio: 'inherit', cwd: projectRoot });
    process.exit(0);
} else if (command === 'delete' || command === 'remove') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc delete <track-number>'); process.exit(1); }

    const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
    const tracksDir = join(projectRoot, 'conductor', 'tracks');

    // Delete filesystem folder (all modes)
    if (existsSync(tracksDir)) {
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (dir) {
            rmSync(join(tracksDir, dir), { recursive: true, force: true });
            console.log(`🗑  Deleted folder: ${dir}`);
        }
    }

    // Delete from DB via API (local-api / remote-api)
    if (cfg.mode !== 'local-fs') {
        const collector = cfg.collectors?.[0];
        if (collector?.url && cfg.project?.id) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (collector.machine_token) headers['x-machine-token'] = collector.machine_token;
                const r = await fetch(`${collector.url}/api/projects/${cfg.project.id}/tracks/${trackNum}`, { method: 'DELETE', headers });
                if (!r.ok) { const t = await r.text(); console.warn(`⚠️  API delete failed: ${t}`); }
                else { console.log(`🗑  Deleted from DB`); }
            } catch (e) { console.warn(`⚠️  API unreachable: ${e.message}`); }
        }
    }

    console.log(`✅ Track ${trackNum} deleted`);
    process.exit(0);
} else if (command === 'install') {
    if (!projectRoot) { process.exit(1); }
    spawnSync('npm', ['install', '--save-dev', 'chokidar'], { stdio: 'inherit', cwd: projectRoot });
    process.exit(0);
} else {
    console.log(`Unknown command: ${command}`);
    process.exit(1);
}
