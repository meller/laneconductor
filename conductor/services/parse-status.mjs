// Parses a track's lane from its index.md content. Extracted from
// laneconductor.sync.mjs (which runs side effects — chokidar watchers,
// setIntervals — at import time, so isn't safe to import directly just to
// unit test a pure function) — same pattern as sync-timestamp-utils.mjs and
// services/worktree-artifact-merge.mjs.
//
// Track 10012 dogfood incident (2026-08-14): dragging a UI-created track's
// card on the Kanban board reverted it back to its previous lane within a
// few hundred ms. Root cause: UI-created tracks get a `**Status**: <lane>`
// marker baked into index.md at creation (ui/server/utils.mjs's
// trackTemplates()) alongside `**Lane**:`. Every subsequent lane change only
// updates `**Lane****`/`**Lane Status**` (ui/server/index.mjs's
// syncTrackToFile()) — `**Status**` is never touched again after creation.
// This function used to check `**Status**` before `**Lane**`, so once the
// two fields diverged, the file-watcher-triggered re-sync always won with
// the stale `**Status**` value, silently reverting the DB back to the
// track's original lane every time. `**Lane**` is documented elsewhere
// (syncTrack's "DATA AUTHORITY" comment) as the authoritative field — this
// checks it first, matching that intent.
export function parseStatus(content, Lanes, LaneAliases, createQualityGate = false) {
  // 1. Try explicit **Lane** marker (high confidence, authoritative)
  const explicitLane = content.match(/\*\*Lane\*\*:\s*([a-z0-9-]+)/i);
  if (explicitLane) {
    const l = explicitLane[1].toLowerCase().trim();
    if (LaneAliases[l]) return LaneAliases[l];
    if (Object.values(Lanes).includes(l)) return l;
    return l;
  }

  // 2. Try explicit **Status** marker (legacy back-compat only — track 1102
  // F3 removed **Status** from trackTemplates() (ui/server/utils.mjs), so no
  // *new* track ever reaches this branch; it stays only for tracks already
  // on disk from before that fix)
  const explicitStatus = content.match(/\*\*Status\*\*:\s*([a-z0-9-]+)/i);
  if (explicitStatus) {
    const s = explicitStatus[1].toLowerCase().trim();
    if (LaneAliases[s]) return LaneAliases[s];
    if (Object.values(Lanes).includes(s)) return s;
    return s;
  }

  // 3. Heuristic matching (only if high-confidence markers weren't found)
  // Use word boundaries to avoid matching "Implementation Plan" as "implement"
  const explicitMarkers = [
    { pattern: /\bquality-gate\b/i, status: Lanes.QUALITY_GATE },
    { pattern: /\bdone\b/i, status: Lanes.DONE },
    { pattern: /\bcompleted\b/i, status: Lanes.DONE },
    { pattern: /\bsuccess\b/i, status: Lanes.DONE },
    { pattern: /\bbacklog\b/i, status: Lanes.BACKLOG },
    { pattern: /\bimplement\b(?!ation)/i, status: Lanes.IMPLEMENT },
    { pattern: /\bplan(?:ning)?\b/i, status: Lanes.PLAN },
    { pattern: /\breview\b/i, status: Lanes.REVIEW },
  ];
  for (const m of explicitMarkers) {
    if (m.pattern.test(content)) return m.status;
  }
  const emojiMarkers = [
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*DONE/im, status: 'done' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*REVIEWED/im, status: createQualityGate ? 'quality-gate' : 'done' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⏳\s*IMPLEMENT/im, status: 'implement' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⏳\s*IN[ _]?PROGRESS/im, status: 'implement' },

    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*🔄\s*BLOCKED/im, status: 'review' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*⚠️\s*PARTIAL/im, status: 'review' },
    { pattern: /(?:#+|status:?|[\*]*status[\*]*:?)\s*✅\s*COMPLETE/im, status: 'review', checkTasks: true },
  ];
  let bestMatch = null, lastIndex = -1;
  for (const m of emojiMarkers) {
    const match = m.pattern.exec(content);
    if (match && match.index > lastIndex) {
      if (m.checkTasks && /- \[ \]/.test(content)) continue;
      lastIndex = match.index;
      bestMatch = m.status;
    }
  }
  return bestMatch;
}
