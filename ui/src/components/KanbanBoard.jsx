import React, { useState } from 'react';
import { TrackCard } from './TrackCard.jsx';
import { LANE_STATUS_CONFIG, resolveDoneLaneBucket } from '../../../conductor/services/done-lane-bucket.mjs';

export const LANES = [
  { id: 'backlog', label: 'Backlog', color: 'text-gray-400 border-gray-700', drop: 'border-gray-500 bg-gray-800/30' },
  { id: 'plan', label: 'Plan', color: 'text-indigo-400 border-indigo-800', drop: 'border-indigo-500 bg-indigo-900/20' },
  { id: 'implement', label: 'Implement', color: 'text-blue-400 border-blue-800', drop: 'border-blue-500 bg-blue-900/20' },
  { id: 'review', label: 'Review', color: 'text-amber-400 border-amber-800', drop: 'border-amber-500 bg-amber-900/20' },
  { id: 'quality-gate', label: 'Quality Gate', color: 'text-purple-400 border-purple-800', drop: 'border-purple-500 bg-purple-900/20' },
  { id: 'done', label: 'Done', color: 'text-green-400 border-green-800', drop: 'border-green-500 bg-green-900/20' },
];

export { LANE_STATUS_CONFIG };

// Track 10076: display order for the done lane's per-track resolved
// buckets (see resolveDoneLaneBucket in done-lane-bucket.mjs). Distinct
// from the fixed groupedByStatus keys every other lane uses, because a
// done-lane track's bucket now depends on live git state, not just
// lane_action_status — 'unmerged'/'unmerged-failed'/'pr-open' only appear
// when a live classification overrides the raw status.
export const DONE_BUCKET_ORDER = ['waiting', 'queue', 'running', 'unmerged', 'unmerged-failed', 'pr-open', 'success', 'failure'];

const LANE_EXPAND_THRESHOLD = 5;

export function KanbanBoard({ projectId, tracks, onTrackClick, onLaneChange, onFixReview, onRerunImplement, onDeleteTrack, onMarkPublished, onExpandLane, onViewInWorktrees }) {
  const [dragOverLane, setDragOverLane] = useState(null);

  const byLane = Object.fromEntries(
    LANES.map(l => [l.id, tracks.filter(t => t.lane_status === l.id)])
  );

  function handleDrop(e, laneId) {
    e.preventDefault();
    setDragOverLane(null);
    const trackNum = e.dataTransfer.getData('trackNum');
    const track = tracks.find(t => t.track_number === trackNum);
    if (track && track.lane_status !== laneId) {
      // Block moves only while a plan action is actively running
      if (track.lane_status === 'plan' && track.lane_action_status === 'running') {
        console.warn(`[Kanban] Cannot move track ${track.track_number}: plan in progress`);
        return;
      }
      onLaneChange?.(track, laneId);
    }
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-600 text-sm">
        <p>No tracks yet.</p>
        <div className="text-left text-xs space-y-1 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <p className="text-gray-400 mb-2">Create one:</p>
          <code className="block text-blue-300 bg-gray-950 rounded px-2 py-1">lc new "My Feature"</code>
          <p className="text-gray-500 mt-2">or in your AI editor:</p>
          <code className="block text-blue-300 bg-gray-950 rounded px-2 py-1">/laneconductor newTrack</code>
        </div>
        <p className="text-xs text-gray-700">Start the worker first: <code className="px-1 bg-gray-800 rounded">lc worker start</code></p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-4 h-full">
      {LANES.map(lane => {
        const isOver = dragOverLane === lane.id;
        const laneTracks = byLane[lane.id] || [];
        const visibleTracks = laneTracks.slice(0, LANE_EXPAND_THRESHOLD);
        const hiddenCount = laneTracks.length - visibleTracks.length;

        // Track 10076: the done lane groups each track by its resolved
        // git-classification bucket (resolveDoneLaneBucket) rather than
        // lane_action_status alone — a done:success track with a live
        // unmerged branch groups as "Unmerged", matching what the
        // Worktrees panel already shows for the same track. Every other
        // lane keeps the exact groupedByStatus path used before this
        // track — this must be invisible outside the done column.
        let groupEntries;
        if (lane.id === 'done') {
          const byBucket = new Map();
          for (const track of visibleTracks) {
            const resolved = resolveDoneLaneBucket({
              laneStatus: track.lane_status,
              laneActionStatus: track.lane_action_status,
              worktreeClass: track.worktree_class,
              classificationAvailable: track.worktree_class_available,
            });
            if (!byBucket.has(resolved.bucket)) byBucket.set(resolved.bucket, { config: resolved, tracks: [] });
            byBucket.get(resolved.bucket).tracks.push(track);
          }
          groupEntries = DONE_BUCKET_ORDER
            .filter(key => byBucket.has(key))
            .map(key => [key, byBucket.get(key).tracks, byBucket.get(key).config]);
        } else {
          // Group the visible (truncated) tracks by their lane_action_status.
          const groupedByStatus = {
            waiting: visibleTracks.filter(t => !t.lane_action_status || t.lane_action_status === 'waiting'),
            queue: visibleTracks.filter(t => t.lane_action_status === 'queue'),
            running: visibleTracks.filter(t => t.lane_action_status === 'running'),
            success: visibleTracks.filter(t => t.lane_action_status === 'success'),
            failure: visibleTracks.filter(t => t.lane_action_status === 'failure'),
          };
          groupEntries = Object.entries(groupedByStatus)
            .filter(([status, arr]) => arr.length > 0 && LANE_STATUS_CONFIG[status]?.show)
            .map(([status, arr]) => [status, arr, LANE_STATUS_CONFIG[status]]);
        }

        return (
          <div
            key={lane.id}
            className="flex flex-col gap-3"
            onDragOver={e => { e.preventDefault(); setDragOverLane(lane.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverLane(null); }}
            onDrop={e => handleDrop(e, lane.id)}
          >
            {/* Column header */}
            <div className={`flex items-center justify-between border-b pb-2 transition-colors ${isOver ? lane.drop : lane.color}`}>
              <span className="text-sm font-semibold uppercase tracking-wide">
                {lane.label}
              </span>
              <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">
                {laneTracks.length}
              </span>
            </div>

            {/* Drop zone highlight */}
            <div
              className={`flex flex-col gap-4 overflow-y-auto rounded-lg transition-all min-h-16 ${isOver ? 'ring-1 ring-dashed ' + lane.drop.split(' ')[0] + ' p-1' : ''
                }`}
            >
              {/* Group tracks by resolved bucket (done lane) or lane_action_status (every other lane) */}
              {groupEntries.map(([key, groupTracks, config]) => {
                return (
                  <div key={key} className="space-y-2" data-testid={`lane-group-${lane.id}-${key}`}>
                    <div className={`flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider font-bold`}>
                      <span className={config.color}>{config.emoji}</span>
                      <span className="text-gray-500">{config.label}</span>
                      <span className="ml-auto text-gray-600">({groupTracks.length})</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {groupTracks.map(track => (
                        <TrackCard
                          key={track.id}
                          projectId={projectId}
                          track={track}
                          onClick={() => onTrackClick?.(track)}
                          onLaneChange={onLaneChange}
                          onFixReview={onFixReview}
                          onRerunImplement={onRerunImplement}
                          onDeleteTrack={onDeleteTrack}
                          onMarkPublished={onMarkPublished}
                          onViewInWorktrees={onViewInWorktrees}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {hiddenCount > 0 && (
                <button
                  onClick={() => onExpandLane?.(lane.id)}
                  className="text-xs text-gray-500 hover:text-gray-300 text-left px-1 py-1 transition-colors"
                >
                  +{hiddenCount} more →
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
