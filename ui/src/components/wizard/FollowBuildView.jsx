import React, { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi.js';

// Track AM-1119 Phase 5: post-launch handoff. Accepts either a `projectId`
// directly (ProjectCard's entry point — the project already exists) or a
// `repoPath` (the wizard's own post-Launch entry point — runCreateProject's
// dispatch reports "Created at <path>" the moment it spawns the new
// project's own worker, but that worker's own registration/DB row can lag
// by a poll cycle or two; this view is what makes that gap visible instead
// of the modal just closing on a project nothing has heard of yet).

const LANE_STEPS = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const LANE_LABELS = {
  plan: 'Plan', implement: 'Build', review: 'Review', 'quality-gate': 'Quality Gate', done: 'Done',
};

// Track AM-1119 Phase 5 (Task 3, TC-13): mirrors GET /api/inbox's own SQL
// bucket rule exactly (ui/server/index.mjs) — `needs_input` when
// `waiting_for_reply` is set, OR the most recent comment is a `system`
// author whose body starts with ⚠️ or ❌. Kept as a small local rule
// rather than a second poll of /api/inbox: GET /api/projects/:id/tracks
// already returns `last_comment_body`/`last_comment_author` per track, so
// one poll is enough.
export function needsInput(track) {
  if (track.waiting_for_reply) return true;
  const body = track.last_comment_body;
  return track.last_comment_author === 'system' && typeof body === 'string' && (body.startsWith('⚠️') || body.startsWith('❌'));
}

export function FollowBuildView({ repoPath, projectId: initialProjectId, onClose, onOpenTrack, pollIntervalMs = 2000 }) {
  const { apiFetch } = useApi();
  const [projectId, setProjectId] = useState(initialProjectId ?? null);
  const [project, setProject] = useState(null);
  const [tracks, setTracks] = useState([]);

  // Task 1: resolve projectId from repoPath once the new project's own
  // worker has registered it — polls the same list endpoint ProjectCard
  // reads from, no dedicated lookup route needed.
  useEffect(() => {
    if (projectId || !repoPath) return;
    let cancelled = false;
    const poll = () => {
      apiFetch('/api/projects')
        .then(r => (r.ok ? r.json() : []))
        .then(list => {
          if (cancelled) return;
          const match = list.find(p => p.repo_path === repoPath);
          if (match) setProjectId(match.id);
        })
        .catch(() => { /* transient — retry next tick */ });
    };
    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectId, repoPath, apiFetch, pollIntervalMs]);

  // Task 1/2: once projectId is known, poll live track + project (app_url)
  // state every pollIntervalMs (TC-12: lane badges update without reload).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const poll = () => {
      apiFetch('/api/projects')
        .then(r => (r.ok ? r.json() : []))
        .then(list => { if (!cancelled) setProject(list.find(p => p.id === projectId) ?? null); })
        .catch(() => {});
      apiFetch(`/api/projects/${projectId}/tracks`)
        .then(r => (r.ok ? r.json() : []))
        .then(rows => { if (!cancelled) setTracks(rows); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectId, apiFetch, pollIntervalMs]);

  const sortedTracks = tracks.slice().sort((a, b) => Number(a.track_number) - Number(b.track_number));

  return (
    <div className="space-y-4" data-testid="follow-build-view">
      <p className="text-xs text-gray-400">
        <span className="font-semibold text-gray-300">How this works:</span> each track below moves through{' '}
        {LANE_STEPS.map(l => LANE_LABELS[l]).join(' → ')} on its own — nothing to do unless a track is flagged{' '}
        <span className="text-orange-400 font-semibold">Needs your input</span>.
      </p>

      {!projectId ? (
        <p className="text-xs text-gray-500" data-testid="follow-build-waiting">Setting up your project…</p>
      ) : (
        <>
          <div data-testid="follow-build-app-url" className="p-3 rounded-lg border border-gray-800 bg-gray-900/60">
            {project?.app_url ? (
              <a
                href={project.app_url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="follow-build-live-link"
                className="text-sm font-bold text-green-400 hover:text-green-300"
              >
                🔗 Your app is live: {project.app_url}
              </a>
            ) : (
              <p className="text-xs text-gray-500">Your app will appear here once the Deploy track finishes.</p>
            )}
          </div>

          <ul className="space-y-1.5">
            {sortedTracks.map(t => (
              <li
                key={t.track_number}
                data-testid={`follow-build-track-${t.track_number}`}
                className="flex items-center justify-between gap-2 text-xs bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2"
              >
                <span className="text-gray-300 truncate">{t.title}</span>
                {needsInput(t) ? (
                  <button
                    type="button"
                    data-testid={`follow-build-needs-input-${t.track_number}`}
                    onClick={() => onOpenTrack?.(t.track_number)}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 hover:bg-orange-900 shrink-0"
                  >
                    Needs your input
                  </button>
                ) : (
                  <span
                    data-testid={`follow-build-lane-${t.track_number}`}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0"
                  >
                    {LANE_LABELS[t.lane_status] || t.lane_status}
                  </span>
                )}
              </li>
            ))}
            {sortedTracks.length === 0 && (
              <li className="text-[10px] text-gray-600">Generated tracks will appear here shortly.</li>
            )}
          </ul>
        </>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
