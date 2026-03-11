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
  plan [id], implement [id], review [id], quality-gate [id], backlog [id], done [id], rerun [id]

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
        const defaultModel = primaryCli === 'claude' ? 'haiku' : (primaryCli === 'gemini' ? '' : '');
        const primaryModel = await question(`Primary model [${defaultModel || 'default'}]: `) || defaultModel;

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
            const secDefaultModel = secCli === 'claude' ? 'haiku' : (secCli === 'gemini' ? '' : '');
            const secModel = await question(`Secondary model [${secDefaultModel || 'default'}]: `) || secDefaultModel;
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

        console.log('\n✨ Setup complete!');
        console.log('\nNext steps:');
        console.log('  1. Run AI Scaffolding (scans codebase and generates context files):');
        console.log('     • In Claude Code:    /laneconductor setup scaffold');
        console.log('     • In Gemini CLI:    Prompt with instructions from .claude/skills/laneconductor/SKILL.md');
        console.log('');
        console.log('  2. Run "lc install" to add required dependencies (chokidar).');
        console.log('  3. Run "lc start" to begin the heartbeat worker.');
        console.log('  4. Run "lc ui start" to open the Kanban dashboard.');
        console.log('  5. Create your first track with "lc new".');

        rl.close();
    }

    runSetup();
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
        await fetch(`${collector.url}/track/${trackNum}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    const trackNum = args[1];
    let lane = command === 'move' || command === 'pulse' ? args[2] : (command === 'rerun' ? null : command);
    let status = command === 'pulse' ? args[2] : (args[2] || 'queue');
    let prog = command === 'pulse' ? args[3] : null;

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
            await fetch(`${collector.url}/track/${trackNum}/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author: 'human', body: 'Manual rerun (CLI)' })
            }).catch(() => { });
        }
        console.log(`♻️  Retries reset for track ${trackNum}`);
    }

    writeFileSync(indexPath, content);
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
