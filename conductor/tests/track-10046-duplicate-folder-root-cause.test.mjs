// conductor/tests/track-10046-duplicate-folder-root-cause.test.mjs
// AM-10046 root cause: decideTrackFolder's matcher only recognized bare
// `${trackNumber}-slug` names, structurally blind to the modern
// `INITIALS-${trackNumber}-slug` convention (track 10023+). The first time
// a track ended up with BOTH shapes before either was registered in
// tracks-metadata.json, the old matcher couldn't see the prefixed one at
// all — `matches` came back with only the bare folder — so it silently
// defaulted to that, and syncTrack() then locked the wrong answer into
// metadata permanently.
//
// Confirmed live 2026-09-01: this corrupted tracks-metadata.json's
// folder_path for 3 tracks in one session (10039, 10045, 10046), each
// losing real in-flight plan/spec work to the wrong folder until manually
// recovered. In 2 of the 3 cases the bare folder was the accidental
// duplicate (near-empty) and the prefixed one held the real content —
// the reverse of what "prefixed always wins" would assume, which is why
// the fix uses actual content size as the tie-break rather than a naming
// convention.

import { test } from 'node:test';
import assert from 'node:assert';
import { decideTrackFolder } from '../services/track-folder.mjs';

test('root cause repro: prefixed + bare folders, NEITHER registered — old code was blind to the prefixed one', () => {
  // Before the fix, matches = dirNames.filter(name => name.startsWith(`${trackNumber}-`))
  // would find ONLY '10046-slug' here — 'AM-10046-slug' never matched at
  // all, so decideTrackFolder couldn't even see it, let alone quarantine
  // it. This test alone would have passed even with the bug (folder ===
  // '10046-slug', by accident of it being the only visible match) — the
  // point of this suite is the cases below, where the OLD code silently
  // picked the wrong folder once both shapes were visible.
  const r = decideTrackFolder({
    dirNames: ['10046-slug', 'AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: null,
    registeredExists: false,
  });
  // Now genuinely ambiguous (both shapes visible) — resolved by content
  // size below; with no size data, falls back to the old alphabetical
  // default (still deterministic, just not silently wrong-shaped).
  assert.ok(['10046-slug', 'AM-10046-slug'].includes(r.folder));
  assert.equal(r.quarantine.length, 1);
});

test('THE FIX: content-size tie-break picks the folder with real content, not whichever sorts first', () => {
  // This is the exact live shape: the bare folder is the accidental
  // duplicate (near-empty), the prefixed one has the real spec/plan.
  // Alphabetically, '10046-slug' < 'AM-10046-slug' (digit sorts before
  // letter) — the OLD unconditional `matches[0]` default would have
  // picked the near-empty bare folder here, exactly the live incident.
  const r = decideTrackFolder({
    dirNames: ['10046-slug', 'AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: null,
    registeredExists: false,
    contentSizeByName: { '10046-slug': 40, 'AM-10046-slug': 9000 },
  });
  assert.equal(r.folder, 'AM-10046-slug');
  assert.deepEqual(r.quarantine, ['10046-slug']);
  assert.deepEqual(r.metadataUpdate, { folder_path: 'AM-10046-slug' });
});

test('THE FIX, reverse direction: bare folder has the real content — track 10044\'s actual live shape', () => {
  // Confirmed live: track 10044 had it the other way around — the bare
  // folder was the genuine one (100% progress, real history) and the
  // prefixed folder was the accidental empty duplicate. The fix must not
  // assume "prefixed always wins"; it must follow the actual content.
  const r = decideTrackFolder({
    dirNames: ['10044-slug', 'AM-10044-slug'],
    trackNumber: '10044',
    registeredFolder: null,
    registeredExists: false,
    contentSizeByName: { '10044-slug': 12000, 'AM-10044-slug': 90 },
  });
  assert.equal(r.folder, '10044-slug');
  assert.deepEqual(r.quarantine, ['AM-10044-slug']);
});

test('registered metadata still wins over content size when it names one of the candidates', () => {
  const r = decideTrackFolder({
    dirNames: ['10046-slug', 'AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: '10046-slug', // registered to the smaller one — trust it anyway
    registeredExists: true,
    contentSizeByName: { '10046-slug': 40, 'AM-10046-slug': 9000 },
  });
  assert.equal(r.folder, '10046-slug');
  assert.deepEqual(r.quarantine, ['AM-10046-slug']);
});

test('no metadata rewrite when the content-size winner already matches what is registered', () => {
  const r = decideTrackFolder({
    dirNames: ['10046-slug', 'AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: 'AM-10046-slug',
    registeredExists: true,
    contentSizeByName: { '10046-slug': 40, 'AM-10046-slug': 9000 },
  });
  assert.equal(r.folder, 'AM-10046-slug');
  assert.equal(r.metadataUpdate, null);
});

test('a lone prefixed-only folder (no bare duplicate) still resolves cleanly — the common, non-ambiguous case', () => {
  const r = decideTrackFolder({
    dirNames: ['AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: null,
    registeredExists: false,
  });
  assert.equal(r.folder, 'AM-10046-slug');
  assert.deepEqual(r.quarantine, []);
});

test('missing size data for one candidate treats it as smallest (-1), does not throw', () => {
  const r = decideTrackFolder({
    dirNames: ['10046-slug', 'AM-10046-slug'],
    trackNumber: '10046',
    registeredFolder: null,
    registeredExists: false,
    contentSizeByName: { '10046-slug': 40 }, // AM-10046-slug missing entirely -> treated as -1
  });
  assert.equal(r.folder, '10046-slug'); // 40 beats the missing entry's -1 default
});
