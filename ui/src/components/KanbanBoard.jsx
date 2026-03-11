import React, { useState } from 'react';
import { TrackCard } from './TrackCard.jsx';

const LANES = [
  { id: 'backlog', label: 'Backlog', color: 'text-gray-400 border-gray-700', drop: 'border-gray-500 bg-gray-800/30' },
  { id: 'plan', label: 'Plan', color: 'text-indigo-400 border-indigo-800', drop: 'border-indigo-500 bg-indigo-900/20' },
  { id: 'implement', label: 'Implement', color: 'text-blue-400 border-blue-800', drop: 'border-blue-500 bg-blue-900/20' },
  { id: 'review', label: 'Review', color: 'text-amber-400 border-amber-800', drop: 'border-amber-500 bg-amber-900/20' },
  { id: 'quality-gate', label: 'Quality Gate', color: 'text-purple-400 border-purple-800', drop: 'border-purple-500 bg-purple-900/20' },
  { id: 'done', label: 'Done', color: 'text-green-400 border-green-800', drop: 'border-green-500 bg-green-900/20' },
];

export function KanbanBoard({ tracks, onTrackClick, onLaneChange, onFixReview, onRerunImplement, onDeleteTrack }) {
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
      <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
        No tracks yet. Run <code className="mx-1 px-1 bg-gray-800 rounded">/laneconductor newTrack</code> in a project.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-4 h-full">
      {LANES.map(lane => {
        const isOver = dragOverLane === lane.id;
        const laneTracks = byLane[lane.id] || [];

        // Group tracks by their lane_action_status
        const groupedByStatus = {
          queue: laneTracks.filter(t => t.lane_action_status === 'queue'),
          running: laneTracks.filter(t => t.lane_action_status === 'running'),
          success: laneTracks.filter(t => t.lane_action_status === 'success'),
          failure: laneTracks.filter(t => t.lane_action_status === 'failure'),
        };

        const statusConfig = {
          queue: { emoji: '⏳', label: 'Queued', color: 'text-yellow-500', show: true },
          running: { emoji: '🔄', label: 'Running', color: 'text-blue-500', show: true },
          success: { emoji: '✅', label: 'Success', color: 'text-green-500', show: true },
          failure: { emoji: '❌', label: 'Failed', color: 'text-red-500', show: true },
        };

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
              {/* Group tracks by lane_action_status */}
              {Object.entries(groupedByStatus).map(([status, tracks]) => {
                if (tracks.length === 0 || !statusConfig[status]?.show) return null;
                const config = statusConfig[status];
                return (
                  <div key={status} className="space-y-2">
                    <div className={`flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider font-bold`}>
                      <span className={config.color}>{config.emoji}</span>
                      <span className="text-gray-500">{config.label}</span>
                      <span className="ml-auto text-gray-600">({tracks.length})</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {tracks.map(track => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          onClick={() => onTrackClick?.(track)}
                          onLaneChange={onLaneChange}
                          onFixReview={onFixReview}
                          onRerunImplement={onRerunImplement}
                          onDeleteTrack={onDeleteTrack}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
