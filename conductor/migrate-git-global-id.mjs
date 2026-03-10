#!/usr/bin/env node
// One-off migration: backfill git_global_id for all projects that have a git_remote.
// Run: node conductor/migrate-git-global-id.mjs

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';

// Load .env
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const { db } = config;

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? db.host,
  port: Number(process.env.DB_PORT ?? db.port),
  database: process.env.DB_NAME ?? db.name,
  user: process.env.DB_USER ?? db.user,
  password: process.env.DB_PASSWORD ?? db.password,
  ssl: (process.env.DB_SSL ?? db.ssl) ? { rejectUnauthorized: false } : false,
});

// UUID v5 using built-in crypto (no extra deps)
function uuidV5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(ns).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function gitGlobalId(gitRemote) {
  if (!gitRemote) return null;
  const normalised = gitRemote.toLowerCase().replace(/\.git$/, '');
  return uuidV5(URL_NAMESPACE, normalised);
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, name, git_remote FROM projects WHERE git_remote IS NOT NULL AND git_remote != ''`
  );

  if (rows.length === 0) {
    console.log('No projects with git_remote found — nothing to backfill.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    const uuid = gitGlobalId(row.git_remote);
    await pool.query(
      `UPDATE projects SET git_global_id = $1 WHERE id = $2`,
      [uuid, row.id]
    );
    console.log(`✅ Project ${row.id} (${row.name}): git_global_id = ${uuid}`);
  }

  await pool.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
