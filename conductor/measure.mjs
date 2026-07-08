/**
 * measure.mjs — autoresearch KPI measurement module
 * Zero external dependencies. Uses Node 18+ native fetch.
 *
 * Usage:
 *   import { measureKpi, measureTrack } from './measure.mjs';
 *   const result = await measureKpi({ source: 'hn-api', sourceConfig: 'item_id=12345', threshold: 50, target: 100 });
 *
 * CLI:
 *   node conductor/measure.mjs --track 1052
 *   node conductor/measure.mjs --track 1052 --dry-run
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} KpiSpec
 * @property {string} source         - 'hn-api' | 'reddit-api' | 'manual' | 'custom-url'
 * @property {string} [sourceConfig] - item_id=12345 or full URL
 * @property {number} threshold      - minimum value to pass
 * @property {number} [target]       - goal value (informational)
 * @property {string} [indexPath]    - path to index.md (for 'manual' source)
 */

/**
 * @typedef {Object} KpiResult
 * @property {number|null} actual
 * @property {number}      target
 * @property {number}      threshold
 * @property {boolean}     passed
 * @property {object}      raw
 * @property {string}      measured_at  - ISO timestamp
 * @property {string}      [error]
 */

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function measureHnApi(sourceConfig) {
  const idMatch = (sourceConfig || '').match(/item_id[=:](\d+)/i) || (sourceConfig || '').match(/^(\d+)$/);
  if (!idMatch) throw new Error(`hn-api: cannot parse item_id from sourceConfig: "${sourceConfig}"`);
  const itemId = idMatch[1];
  const url = `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`hn-api: HTTP ${res.status} from ${url}`);
  const data = await res.json();
  if (!data || data.type === undefined) throw new Error(`hn-api: item ${itemId} not found or deleted`);
  return { actual: data.score ?? 0, raw: { score: data.score, descendants: data.descendants, title: data.title, url: data.url } };
}

async function measureRedditApi(sourceConfig) {
  // sourceConfig can be a full post URL or just the path
  let url = sourceConfig;
  if (!url.endsWith('.json')) url = url.replace(/\/$/, '') + '.json';
  if (!url.startsWith('http')) url = 'https://www.reddit.com' + url;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'laneconductor-kpi/1.0' } });
  if (!res.ok) throw new Error(`reddit-api: HTTP ${res.status} from ${url}`);
  const data = await res.json();
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error(`reddit-api: unexpected response shape from ${url}`);
  return { actual: post.ups ?? 0, raw: { ups: post.ups, num_comments: post.num_comments, score: post.score, title: post.title } };
}

function measureManual(indexPath) {
  if (!indexPath || !existsSync(indexPath)) throw new Error(`manual: index.md not found at ${indexPath}`);
  const content = readFileSync(indexPath, 'utf8');
  const match = content.match(/\*\*KPI Actual\*\*:\s*([^\n]+)/i);
  if (!match) throw new Error(`manual: **KPI Actual** marker not found in index.md`);
  const actual = parseInt(match[1].trim(), 10);
  if (isNaN(actual)) throw new Error(`manual: **KPI Actual** value "${match[1].trim()}" is not a number`);
  return { actual, raw: { source: 'manual', value: match[1].trim() } };
}

async function measureCustomUrl(sourceConfig) {
  if (!sourceConfig || !sourceConfig.startsWith('http')) throw new Error(`custom-url: sourceConfig must be a full URL, got: "${sourceConfig}"`);
  const res = await fetchWithTimeout(sourceConfig);
  if (!res.ok) throw new Error(`custom-url: HTTP ${res.status} from ${sourceConfig}`);
  const data = await res.json();
  // Find first numeric value in the response
  const findFirstNumber = (obj, depth = 0) => {
    if (depth > 4) return null;
    if (typeof obj === 'number') return obj;
    if (typeof obj === 'object' && obj !== null) {
      for (const v of Object.values(obj)) {
        const found = findFirstNumber(v, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  };
  const actual = findFirstNumber(data);
  if (actual === null) throw new Error(`custom-url: no numeric value found in response from ${sourceConfig}`);
  return { actual, raw: data };
}

/**
 * Measure a KPI against its spec.
 * @param {KpiSpec} kpiSpec
 * @returns {Promise<KpiResult>}
 */
export async function measureKpi(kpiSpec) {
  const { source, sourceConfig, threshold = 0, target = 0, indexPath } = kpiSpec;
  const measured_at = new Date().toISOString();

  try {
    let measureResult;

    switch ((source || '').toLowerCase()) {
      case 'hn-api':
        measureResult = await measureHnApi(sourceConfig);
        break;
      case 'reddit-api':
        measureResult = await measureRedditApi(sourceConfig);
        break;
      case 'manual':
        measureResult = measureManual(indexPath);
        break;
      case 'custom-url':
        measureResult = await measureCustomUrl(sourceConfig);
        break;
      default:
        throw new Error(`Unknown KPI source: "${source}". Supported: hn-api, reddit-api, manual, custom-url`);
    }

    const { actual, raw } = measureResult;
    return {
      actual,
      target: Number(target) || 0,
      threshold: Number(threshold) || 0,
      passed: actual >= Number(threshold),
      raw,
      measured_at,
    };
  } catch (err) {
    return {
      actual: null,
      target: Number(target) || 0,
      threshold: Number(threshold) || 0,
      passed: false,
      raw: {},
      measured_at,
      error: err.message,
    };
  }
}

/**
 * Measure KPI for a track by reading its spec.md KPI block and index.md.
 * @param {string} trackDir  - absolute path to the track folder
 * @returns {Promise<KpiResult|null>}
 */
export async function measureTrack(trackDir) {
  const specPath = join(trackDir, 'spec.md');
  const indexPath = join(trackDir, 'index.md');

  if (!existsSync(specPath)) return null;

  const specContent = readFileSync(specPath, 'utf8');
  const kpiBlock = specContent.match(/## KPI\n([\s\S]*?)(?=\n## |\n# |$)/i);
  if (!kpiBlock) return null;

  const block = kpiBlock[1];
  const get = (key) => { const m = block.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*([^\\n]+)`, 'i')); return m ? m[1].trim() : null; };

  const source = get('Source');
  if (!source) return null;

  return measureKpi({
    source,
    sourceConfig: get('Source Config'),
    threshold: get('Threshold') ? parseInt(get('Threshold'), 10) : 0,
    target: get('Target') ? parseInt(get('Target'), 10) : 0,
    indexPath,
  });
}

// ─── CLI entry point ───────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const trackArg = args[args.indexOf('--track') + 1];
  const dryRun = args.includes('--dry-run');

  if (!trackArg) {
    console.error('Usage: node conductor/measure.mjs --track <number> [--dry-run]');
    process.exit(1);
  }

  // Resolve track directory from project root
  const projectRoot = join(__dirname, '..');
  const tracksDir = join(projectRoot, 'conductor', 'tracks');
  const { readdirSync } = await import('fs');
  const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackArg}-`));

  if (!trackDir) {
    console.error(`❌ Track ${trackArg} not found in conductor/tracks/`);
    process.exit(1);
  }

  const fullTrackDir = join(tracksDir, trackDir);
  console.log(`📊 Measuring KPI for Track ${trackArg} (${trackDir})${dryRun ? ' [dry-run]' : ''}...`);

  const result = await measureTrack(fullTrackDir);

  if (!result) {
    console.log(`ℹ️  No KPI block found in spec.md for Track ${trackArg}`);
    process.exit(0);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Source:     ${result.raw?.source || 'external'}`);
  if (result.error) {
    console.log(`  Error:      ${result.error}`);
    console.log(`  Passed:     ❌ false (measurement failed)`);
  } else {
    console.log(`  Actual:     ${result.actual}`);
    console.log(`  Target:     ${result.target}`);
    console.log(`  Threshold:  ${result.threshold}`);
    console.log(`  Passed:     ${result.passed ? '✅ true' : '❌ false'}`);
  }
  console.log(`  Measured:   ${result.measured_at}`);
  console.log(`${'─'.repeat(50)}\n`);

  if (dryRun) {
    console.log('ℹ️  Dry-run mode — no files written');
  }

  process.exit(result.passed ? 0 : 1);
}
