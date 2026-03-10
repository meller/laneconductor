const fs = require('fs');

const collectorPath = 'conductor/collector/index.mjs';
const uiPath = 'ui/server/index.mjs';

const collectorCode = fs.readFileSync(collectorPath, 'utf8');
let uiCode = fs.readFileSync(uiPath, 'utf8');

// The marker in ui endpoint: // ── Static SPA fallback
const hookPointText = 'server.listen(PORT,';
const hookPointIndex = uiCode.indexOf(hookPointText);

if (hookPointIndex !== -1) {
    // 1. Extract endpoints from app.get('/health' to // ── Main ──
    const appStartRegex = /app\.get\('\/health'/;
    const appStartMatch = collectorCode.match(appStartRegex);
    let endpointsStart = appStartMatch.index;

    const endpointsEnd = collectorCode.indexOf('// ── Main ─');
    let endpointsText = collectorCode.slice(endpointsStart, endpointsEnd).trim();

    // Remove overlapping or conflicting routes / middlewares already in ui
    endpointsText = endpointsText.replace(/app\.get\('\/health', \(_req, res\) => res\.json\(\{ ok: true \}\)\);/g, '');
    endpointsText = endpointsText.replace(/app\.use\('\/v1', v1Router\);/g, ''); 
    
    // Replace ', auth,' with ', collectorAuth,' for the routes
    endpointsText = endpointsText.replace(/, auth,/g, ', collectorAuth,');

    const finalMergeCode = `
// ============================================================================
// ── MERGED COLLECTOR ENDPOINTS START ────────────────────────────────────────
// ============================================================================

const COLLECTOR_TOKEN_ENV = process.env.COLLECTOR_0_TOKEN ?? null;
async function collectorAuth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return res.status(401).json({ error: 'unauthorized' });

  if (COLLECTOR_TOKEN_ENV && bearer === COLLECTOR_TOKEN_ENV) return next();

  try {
    let queryArgs = [bearer];
    let queryStr = 'SELECT project_id FROM workers WHERE machine_token = \\$1';
    const requestedProject = req.query.project_id || req.body.project_id;
    if (requestedProject) {
      queryStr += ' AND project_id = \\$2';
      queryArgs.push(requestedProject);
    }
    const { rows } = await pool.query(queryStr, queryArgs);
    if (rows.length > 0) {
      req.worker_project_id = rows[0].project_id;
      req.machine_token = bearer;
      return next();
    }
  } catch (err) {
    console.error('[collector] auth DB error:', err);
  }
  res.status(401).json({ error: 'unauthorized' });
}

import { createHash } from 'crypto';
const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
function uuidV5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(ns).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return h.slice(0,8) + '-' + h.slice(8,12) + '-' + h.slice(12,16) + '-' + h.slice(16,20) + '-' + h.slice(20,32);
}
function gitGlobalId(gitRemote) {
  if (!gitRemote) return null;
  const normalised = gitRemote.toLowerCase().replace(/\\.git$/, '');
  return uuidV5(URL_NAMESPACE, normalised);
}

${endpointsText}

// ============================================================================
// ── MERGED COLLECTOR ENDPOINTS END ──────────────────────────────────────────
// ============================================================================

`;

    uiCode = uiCode.slice(0, hookPointIndex) + finalMergeCode + uiCode.slice(hookPointIndex);
    fs.writeFileSync(uiPath, uiCode);
    console.log('SUCCESS: Injected merged endpoints into UI server.');
} else {
    console.error('ERROR: Could not find hook point in ui/server/index.mjs');
}

