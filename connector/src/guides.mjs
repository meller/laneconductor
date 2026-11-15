// Lane guides: the repo's own `.claude/skills/laneconductor/lanes/<lane>.md` when present, else the
// copy bundled with the connector. Served as ADVICE (REQ-17), never as orders.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blobSha } from './blob.mjs';
import { randomBytes } from 'node:crypto';

export const LANES = ['plan', 'implement', 'review', 'quality-gate', 'merge', 'brainstorm'];
const GUIDES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'guides');
export const repoGuidePath = (lane) => `.claude/skills/laneconductor/lanes/${lane}.md`;

export function newServeId() {
  return `s_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

export function framing({ serveId, hasOutcomeTool }) {
  return [
    `> ADVICE, not orders (serve ${serveId}). This is what has worked on this project, with its reasons. You may decide against any part of it when the situation calls for it; that is your call.`,
    hasOutcomeTool
      ? `> If you deviate, do it and call report_outcome with serve_id ${serveId} and a one-line reason, so the advice can be fixed.`
      : '> If you deviate, do it and tell the user why in one line, so the advice can be fixed.',
    '> Only two things are firm: file formats and the base check on writes (they prevent silent overwrites), and the human\'s authority (ask before merge or push; never handle secrets).',
    '',
  ].join('\n');
}

export async function bundledGuide(lane) {
  const content = await fs.readFile(path.join(GUIDES_DIR, `${lane}.md`), 'utf8');
  return { content, sha: blobSha(content) };
}

/** @returns {{ content: string, source: string }} */
export async function loadGuide(store, lane, version) {
  const rel = repoGuidePath(lane);
  const got = await store.readFiles([rel]);
  const f = got.get(rel);
  if (f) return { content: f.content, source: `repo:${rel}@${f.sha.slice(0, 12)}` };
  const b = await bundledGuide(lane);
  return { content: b.content, source: `bundled@${version}` };
}

export async function guideSources(store) {
  const paths = LANES.map(repoGuidePath);
  const got = await store.readFiles(paths);
  return LANES.map((lane, i) => ({ lane, source: got.get(paths[i]) ? 'repo' : 'bundled' }));
}
