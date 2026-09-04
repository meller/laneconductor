import React from 'react';
import { LANES } from './KanbanBoard.jsx';

// Track 1121 Phase 3: touch replacement for TrackCard's HTML5 drag-and-drop
// (`draggable`/`onDragStart`), which emits no events on touch at all. Calls
// the exact same `onSelect(laneId)` -> onLaneChange(track, targetLane) path
// drag-drop already uses (KanbanBoard.handleDrop calls onLaneChange the
// same way) — this sheet issues no API call of its own.
//
// The plan-in-progress guard mirrors KanbanBoard.handleDrop's own check
// (line ~50): a plan-lane track with lane_action_status 'running' cannot be
// moved. Drag-drop only console.warns in that case, which is invisible on
// touch — this sheet disables every lane and states why instead of
// silently no-op'ing.
const BLOCKED_REASON = 'Plan is in progress — wait for it to finish before moving this track.';

export function MoveToLaneSheet({ track, onSelect, onClose }) {
  const isBlocked = track.lane_status === 'plan' && track.lane_action_status === 'running';

  return (
    <div className="md:hidden fixed inset-0 z-40" data-testid="move-to-lane-sheet">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} data-testid="move-sheet-backdrop" />
      <div className="absolute bottom-0 inset-x-0 bg-gray-950 border-t border-gray-800 rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Move #{track.track_number}
          </span>
          <button
            onClick={onClose}
            className="min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {isBlocked && (
          <p className="px-4 pt-3 text-xs text-amber-400" data-testid="move-sheet-blocked-reason">
            {BLOCKED_REASON}
          </p>
        )}
        <div className="py-2">
          {LANES.map(lane => {
            const isCurrent = lane.id === track.lane_status;
            const disabled = isCurrent || isBlocked;
            return (
              <button
                key={lane.id}
                disabled={disabled}
                onClick={() => onSelect(lane.id)}
                data-testid={`move-sheet-lane-${lane.id}`}
                className={`w-full text-left px-4 min-h-11 flex items-center justify-between text-sm ${
                  disabled ? 'text-gray-600 cursor-not-allowed' : 'text-gray-200 hover:bg-gray-900'
                }`}
              >
                <span>{lane.label}</span>
                {isCurrent && <span className="text-[10px] uppercase tracking-wider text-gray-600">Current</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
