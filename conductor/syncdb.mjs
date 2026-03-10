#!/usr/bin/env node
// LaneConductor Database Sync Utility
// Exports track_comments from source DB and imports to target DB
// Usage: node syncdb.mjs --source <psql-url> --target <psql-url> [--export file.json] [--import file.json]

import { Pool } from 'pg';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
let sourceUrl = null, targetUrl = null, exportFile = null, importFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source') sourceUrl = args[++i];
  if (args[i] === '--target') targetUrl = args[++i];
  if (args[i] === '--export') exportFile = args[++i];
  if (args[i] === '--import') importFile = args[++i];
}

async function exportComments(sourceUrl) {
  console.log('📤 Exporting track_comments from source DB...');
  const sourcePool = new Pool({ connectionString: sourceUrl });
  try {
    const result = await sourcePool.query(
      `SELECT tc.*, t.project_id, t.track_number, p.name AS project_name
       FROM track_comments tc
       JOIN tracks t ON t.id = tc.track_id
       JOIN projects p ON p.id = t.project_id
       ORDER BY tc.created_at ASC`
    );
    const comments = result.rows.map(r => ({
      project_name: r.project_name,
      track_number: r.track_number,
      author: r.author,
      body: r.body,
      is_replied: r.is_replied,
      created_at: r.created_at,
    }));
    console.log(`✅ Exported ${comments.length} comments`);
    return comments;
  } finally {
    await sourcePool.end();
  }
}

async function importComments(targetUrl, comments) {
  console.log('📥 Importing track_comments to target DB...');
  const targetPool = new Pool({ connectionString: targetUrl });
  let imported = 0;

  try {
    // Ensure schema exists
    await targetPool.query(`
      CREATE TABLE IF NOT EXISTS track_comments (
        id SERIAL PRIMARY KEY,
        track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        body TEXT,
        is_replied BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    for (const comment of comments) {
      try {
        // Find matching track in target DB
        const trackResult = await targetPool.query(
          `SELECT t.id FROM tracks t
           JOIN projects p ON p.id = t.project_id
           WHERE p.name = $1 AND t.track_number = $2`,
          [comment.project_name, comment.track_number]
        );

        if (trackResult.rows.length > 0) {
          const trackId = trackResult.rows[0].id;
          await targetPool.query(
            `INSERT INTO track_comments (track_id, author, body, is_replied, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [trackId, comment.author, comment.body, comment.is_replied, comment.created_at]
          );
          imported++;
        }
      } catch (err) {
        console.warn(`⚠️ Failed to import comment for ${comment.project_name}/${comment.track_number}:`, err.message);
      }
    }
    console.log(`✅ Imported ${imported} comments to target DB`);
  } finally {
    await targetPool.end();
  }
}

async function touchTrackFiles(repoPath) {
  console.log('🔄 Touching track files to trigger worker sync...');
  const tracksDir = join(repoPath, 'conductor', 'tracks');
  const files = readdirSync(tracksDir).filter(f => f.startsWith('0') && f.includes('-'));

  let touched = 0;
  for (const dir of files) {
    const planPath = join(tracksDir, dir, 'plan.md');
    try {
      const now = new Date();
      // Touch file by updating its modification time
      const { utimesSync } = await import('fs');
      utimesSync(planPath, now, now);
      touched++;
    } catch (err) {
      // Ignore missing files
    }
  }
  console.log(`✅ Touched ${touched} track files`);
}

async function main() {
  if (!sourceUrl || !targetUrl) {
    console.error('Usage: node syncdb.mjs --source <psql-url> --target <psql-url>');
    console.error('  --export <file>: Export to JSON file (default: stdout)');
    console.error('  --import <file>: Import from JSON file (default: use exported data)');
    process.exit(1);
  }

  try {
    // Step 1: Export comments
    const comments = await exportComments(sourceUrl);

    // Step 2: Save to file if specified
    if (exportFile) {
      writeFileSync(exportFile, JSON.stringify(comments, null, 2), 'utf8');
      console.log(`💾 Saved to ${exportFile}`);
    }

    // Step 3: Import to target
    const importCommentsList = importFile
      ? JSON.parse(readFileSync(importFile, 'utf8'))
      : comments;
    await importComments(targetUrl, importCommentsList);

    console.log('✅ Database sync complete!');
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
}

main();
