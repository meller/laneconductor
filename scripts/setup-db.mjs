import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Load .env
if (fs.existsSync(path.join(rootDir, '.env'))) {
    const env = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
    env.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) process.env[key.trim()] = value.trim();
    });
}

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
};

async function setup() {
    // 1. Create Database if it doesn't exist
    const client = new pg.Client({ ...dbConfig, database: 'postgres' });
    try {
        await client.connect();
        const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'laneconductor'");
        if (res.rowCount === 0) {
            console.log('🏗️ Creating database "laneconductor"...');
            await client.query('CREATE DATABASE laneconductor');
        } else {
            console.log('✅ Database "laneconductor" already exists.');
        }
    } catch (err) {
        console.error('❌ Error checking/creating database:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }

    // 2. Connect to the new database
    const pool = new pg.Pool({ ...dbConfig, database: 'laneconductor' });

    try {
        // All schema initialization is now handled by Atlas migrations
        const dbUrl = `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/laneconductor?sslmode=disable`;

        console.log('🏗️ Applying migrations with Atlas...');
        try {
            // Ensure schema.sql is fresh
            execSync('node scripts/atlas-prisma.mjs', { stdio: 'inherit' });

            const atlasBin = process.platform === 'win32' ? path.join(rootDir, 'bin', 'atlas.exe') : 'atlas';
            execSync(`"${atlasBin}" migrate apply --url "${dbUrl}"`, { stdio: 'inherit' });
        } catch (err) {
            console.error('❌ Atlas migration failed:', err.message);
            // Fallback: if atlas fails (e.g. not installed on linux), show warning
            if (process.platform !== 'win32') {
                console.warn('⚠️ Make sure Atlas CLI is installed: curl -sSf https://atlasgo.sh | sh');
            }
            process.exit(1);
        }

        console.log('✅ Base schema and migrations applied.');

        // 3. Upsert current project
        const configPath = path.join(rootDir, '.laneconductor.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const repoPath = config.project.repo_path || rootDir;
            const name = config.project.name || 'laneconductor';

            console.log(`🏗️ Registering project "${name}"...`);
            const upsertRes = await pool.query(`
                INSERT INTO projects (name, repo_path, primary_cli, primary_model, create_quality_gate)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (repo_path) DO UPDATE SET
                    name = EXCLUDED.name,
                    primary_cli = EXCLUDED.primary_cli,
                    primary_model = EXCLUDED.primary_model,
                    create_quality_gate = EXCLUDED.create_quality_gate
                RETURNING id
            `, [
                name,
                repoPath,
                config.project.primary.cli || 'claude',
                config.project.primary.model || 'haiku',
                config.project.create_quality_gate || false
            ]);

            const projectId = upsertRes.rows[0].id;
            if (config.project.id !== projectId) {
                config.project.id = projectId;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                console.log(`✅ Updated .laneconductor.json with project ID: ${projectId}`);
            }
        }

    } catch (err) {
        console.error('❌ Error initializing database:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

setup();
