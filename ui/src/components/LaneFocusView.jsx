import React, { useState, useEffect, useRef } from 'react';
import { TrackCard } from './TrackCard.jsx';
import { LANES, LANE_STATUS_CONFIG } from './KanbanBoard.jsx';
import { useSwipe } from '../hooks/useSwipe.js';

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
  onViewInWorktrees,
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const focusedChipRef = useRef(null);

  // Reset the status filter whenever the focused lane changes, so switching
  // lanes never leaves you stuck on a filter with zero matches.
  useEffect(() => {
    setStatusFilter('all');
  }, [focusedLane]);

  const byLane = Object.fromEntries(
    LANES.map(l => [l.id, tracks.filter(t => t.lane_status === l.id)])
  );

  const lane = LANES.find(l => l.id === focusedLane) || LANES[0];
  const laneIndex = LANES.findIndex(l => l.id === lane.id);
  const laneTracks = byLane[lane.id] || [];

  // Track 1121 Phase 2: the focused lane's chip is scrolled into view
  // whenever the focused lane changes, so lanes 5-6 stay reachable without
  // hunting through the rail on a narrow viewport.
  useEffect(() => {
    focusedChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [lane.id]);

  // Bounded at both ends of LANES — swiping left on the last lane or right
  // on the first is a no-op, never wraps.
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => {
      if (laneIndex < LANES.length - 1) onFocusLane?.(LANES[laneIndex + 1].id);
    },
    onSwipeRight: () => {
      if (laneIndex > 0) onFocusLane?.(LANES[laneIndex - 1].id);
    },
  });

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
      <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-2 overflow-x-auto">
        {/* Track 1121 REQ-9: there is no all-lanes grid to return to on
            mobile — LaneFocusView is the mobile board itself, not a drill-in
            from it — so this only makes sense at md and above. */}
        <button
          onClick={onBackToBoard}
          className="hidden md:inline-flex shrink-0 text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
        >
          ← All lanes
        </button>
        <div className="hidden md:block w-px h-4 bg-gray-800 shrink-0" />
        {LANES.map(l => {
          const count = (byLane[l.id] || []).length;
          const isFocused = l.id === lane.id;
          return (
            <button
              key={l.id}
              ref={isFocused ? focusedChipRef : undefined}
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

      {/* Pinned lane-position indicator (mobile only) — stays visible even
          when the rail above is scrolled away from the focused chip. */}
      <div className="md:hidden flex items-center justify-center gap-1.5 mb-3" data-testid="lane-position-indicator">
        <span className="text-[10px] text-gray-500 font-mono mr-1">
          {laneIndex + 1} / {LANES.length}
        </span>
        {LANES.map((l, i) => (
          <span
            key={l.id}
            className={`w-1.5 h-1.5 rounded-full ${i === laneIndex ? 'bg-blue-400' : 'bg-gray-700'}`}
          />
        ))}
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

      {/* Card grid — swipe handlers live here, not on the whole screen, so
          the lane rail's own horizontal scroll above is never fighting the
          gesture. Single column below `sm` (legible full-width cards on a
          phone); unchanged from `md` up. */}
      {filteredTracks.length === 0 ? (
        <div
          className="flex items-center justify-center h-64 text-gray-600 text-sm"
          onTouchStart={swipeHandlers.onTouchStart}
          onTouchEnd={swipeHandlers.onTouchEnd}
          data-testid="lane-card-area"
        >
          No {statusFilter === 'all' ? '' : `${LANE_STATUS_CONFIG[statusFilter]?.label.toLowerCase()} `}tracks in {lane.label}.
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto"
          onTouchStart={swipeHandlers.onTouchStart}
          onTouchEnd={swipeHandlers.onTouchEnd}
          data-testid="lane-card-area"
        >
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
              onViewInWorktrees={onViewInWorktrees}
            />
          ))}
        </div>
      )}
    </div>
  );
}
