// Pure timestamp-comparison helpers used by pullTracksMetadataFromDB's
// DB→FS conflict resolution. Extracted from laneconductor.sync.mjs (which
// runs side effects — chokidar watchers, setIntervals — at import time, so
// isn't safe to import directly just to unit test a pure function).

/**
 * Compare file and database timestamps to determine which version is newer
 * @param {number|null} fileMtime - File modification time in ms
 * @param {number|string|null} dbLastUpdated - DB last_updated timestamp (ms, ISO string, or null)
 * @returns {string} - 'newer' (DB wins), 'older' (FS wins), 'equal' (no sync needed)
 */
export function compareTimestamps(fileMtime, dbLastUpdated) {
  // Handle null/missing cases
  if (fileMtime === null && dbLastUpdated === null) return 'equal';
  if (fileMtime === null) return 'newer'; // File missing → DB is newer
  if (dbLastUpdated === null) return 'older'; // DB missing → FS is newer

  // Parse DB timestamp if it's a string (ISO format)
  let dbTime = dbLastUpdated;
  if (typeof dbLastUpdated === 'string') {
    dbTime = new Date(dbLastUpdated).getTime();
    if (isNaN(dbTime)) {
      console.warn('[sync] compareTimestamps: invalid DB timestamp:', dbLastUpdated);
      return 'equal';
    }
  }

  // Compare timestamps with 1ms tolerance for floating point
  const diff = dbTime - fileMtime;
  if (Math.abs(diff) <= 1) return 'equal';
  return diff > 0 ? 'newer' : 'older';
}

/**
 * Whether a file-write and a DB-write look like a still-possibly-in-flight
 * race (both happened close together in time, AND that happened recently)
 * rather than a coincidentally-close pair of timestamps from long ago.
 *
 * Bug this guards against: an earlier version only checked "are these two
 * timestamps within 10s of each other," never "did that happen recently."
 * Since fileMtime/dbLastUpdated are both frozen once nothing else touches
 * either side, a track whose file and DB timestamps happened to land close
 * together (the normal case right after any successful sync) would stay
 * "concurrent" — and therefore permanently skipped — forever, no matter how
 * much wall-clock time passed. Requiring the pair to also be recent is what
 * makes the grace period actually expire.
 *
 * @param {number|null} fileMtime - File modification time in ms
 * @param {number|string|null} dbLastUpdated - DB last_updated timestamp (ms or ISO string)
 * @param {number} now - current time in ms (injectable for tests)
 * @returns {boolean}
 */
export function isConcurrentEdit(fileMtime, dbLastUpdated, now = Date.now()) {
  if (!fileMtime || !dbLastUpdated) return false;

  const dbTime = typeof dbLastUpdated === 'string'
    ? new Date(dbLastUpdated).getTime()
    : dbLastUpdated;

  const gracePeriodMs = 10 * 1000; // 10 second grace period
  const closeToEachOther = Math.abs(fileMtime - dbTime) < gracePeriodMs;
  const stillRecent = (now - Math.max(fileMtime, dbTime)) < gracePeriodMs;
  return closeToEachOther && stillRecent;
}
