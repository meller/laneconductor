import React, { useState, useEffect } from 'react';
import { TrackCard } from './TrackCard.jsx';
import { LANES, LANE_STATUS_CONFIG } from './KanbanBoard.jsx';

export function LaneFocusView({
  projectId,
  tracks,
  focusedLane,
  onFocusLane,
  onBackToBoard,
  onTrackClick,
  onLaneChange,
  onFixReview,
  onRerunImplement,
  onDeleteTrack,
  onMarkPublished,
}) {
  const [statusFilter, setStatusFilter] = useState('all');

  // Reset the status filter whenever the focused lane changes, so switching
  // lanes never leaves you stuck on a filter with zero matches.
  useEffect(() => {
    setStatusFilter('all');
  }, [focusedLane]);

  const byLane = Object.fromEntries(
    LANES.map(l => [l.id, tracks.filter(t => t.lane_status === l.id)])
  );

  const lane = LANES.find(l => l.id === focusedLane) || LANES[0];
  const laneTracks = byLane[lane.id] || [];

  const statusCounts = Object.fromEntries(
    Object.keys(LANE_STATUS_CONFIG).map(status => [
      status,
      laneTracks.filter(t => (t.lane_action_status || 'waiting') === status).length,
    ])
  );

  const filteredTracks = statusFilter === 'all'
    ? laneTracks
    : laneTracks.filter(t => (t.lane_action_status || 'waiting') === statusFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Lane tabs */}
      <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-3 overflow-x-auto">
        <button
          onClick={onBackToBoard}
          className="shrink-0 text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
        >
          ← All lanes
        </button>
        <div className="w-px h-4 bg-gray-800 shrink-0" />
        {LANES.map(l => {
          const count = (byLane[l.id] || []).length;
          const isFocused = l.id === lane.id;
          return (
            <button
              key={l.id}
              onClick={() => onFocusLane?.(l.id)}
              className={`shrink-0 text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-md transition-colors ${isFocused
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              {l.label} <span className="text-gray-600">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full transition-colors ${statusFilter === 'all'
            ? 'bg-gray-700 text-white'
            : 'bg-gray-900 text-gray-500 hover:text-gray-300'
            }`}
        >
          All ({laneTracks.length})
        </button>
        {Object.entries(LANE_STATUS_CONFIG).map(([status, config]) => {
          if (statusCounts[status] === 0) return null;
          const isActive = statusFilter === status;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(isActive ? 'all' : status)}
              className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full transition-colors ${isActive ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                }`}
            >
              <span className={isActive ? '' : config.color}>{config.emoji}</span> {config.label} ({statusCounts[status]})
            </button>
          );
        })}
      </div>

      {/* Card grid */}
      {filteredTracks.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
          No {statusFilter === 'all' ? '' : `${LANE_STATUS_CONFIG[statusFilter]?.label.toLowerCase()} `}tracks in {lane.label}.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto">
          {filteredTracks.map(track => (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
