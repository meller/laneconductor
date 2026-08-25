import React from 'react';
import { getDefaultProviderModel } from '../lib/defaultModel.js';

const LANE_ORDER = ['plan', 'backlog', 'implement', 'review', 'quality-gate', 'done'];
const LANE_COLORS = {
  plan: 'bg-gray-800 text-gray-300',
  backlog: 'bg-gray-800 text-gray-400',
  implement: 'bg-blue-900/50 text-blue-300',
  review: 'bg-purple-900/50 text-purple-300',
  'quality-gate': 'bg-amber-900/50 text-amber-300',
  done: 'bg-green-900/50 text-green-300',
};

// Matches the 60s online threshold already used server-side for worker
// dispatch resolution (ui/server/index.mjs's `last_heartbeat > NOW() -
// INTERVAL '60 seconds'`).
const ONLINE_THRESHOLD_MS = 60_000;

const STATUS_BADGE = {
  offline: { label: 'Offline', className: 'bg-gray-800 text-gray-500 border-gray-700' },
  attention: { label: 'Needs Attention', className: 'bg-orange-900/50 text-orange-300 border-orange-800' },
  active: { label: 'Active', className: 'bg-green-900/50 text-green-300 border-green-800' },
  idle: { label: 'Idle', className: 'bg-gray-800 text-gray-400 border-gray-700' },
};

function computeStatus({ isOnline, unrepliedCount, laneCounts }) {
  if (!isOnline) return 'offline';
  if (unrepliedCount > 0) return 'attention';
  const inFlight = (laneCounts.implement || 0) + (laneCounts.review || 0) + (laneCounts['quality-gate'] || 0);
  return inFlight > 0 ? 'active' : 'idle';
}

export function ProjectCard({ project, tracks, workers, onOpen, onManageContext, onRename, onDelete, onFollowBuild }) {
  const projectTracks = tracks.filter(t => t.project_id === project.id);
  const projectWorkers = workers.filter(w => w.project_id === project.id);

  const laneCounts = {};
  for (const t of projectTracks) {
    laneCounts[t.lane_status] = (laneCounts[t.lane_status] || 0) + 1;
  }

  const isOnline = projectWorkers.some(
    w => w.last_heartbeat && Date.now() - new Date(w.last_heartbeat).getTime() < ONLINE_THRESHOLD_MS
  );
  const unrepliedCount = projectTracks.reduce((sum, t) => sum + (t.unreplied_count ?? 0), 0);
  const status = computeStatus({ isOnline, unrepliedCount, laneCounts });
  const badge = STATUS_BADGE[status];
  const { cli: defaultCli, model: defaultModel } = getDefaultProviderModel(project, projectWorkers);

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-bold text-white truncate">{project.name}</h3>
            {project.app_url && (
              <a
                href={project.app_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                data-testid="project-live-link"
                title={project.app_url}
                className="text-[10px] font-bold text-green-400 hover:text-green-300 shrink-0"
              >
                Live ↗
              </a>
            )}
          </div>
          <p className="text-[10px] text-gray-500 font-mono truncate">{project.repo_path}</p>
        </div>
        <span
          data-testid="project-status-badge"
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {LANE_ORDER.filter(l => laneCounts[l] > 0).map(lane => (
          <span
            key={lane}
            data-testid={`lane-chip-${lane}`}
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${LANE_COLORS[lane]}`}
          >
            {lane}: {laneCounts[lane]}
          </span>
        ))}
        {projectTracks.length === 0 && (
          <span className="text-[10px] text-gray-600">No tracks yet</span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span>{project.primary_cli || defaultCli}{(project.primary_model || defaultModel) ? ` · ${project.primary_model || defaultModel}` : ''}</span>
        {unrepliedCount > 0 && (
          <span data-testid="project-unreplied-count" className="text-orange-400 font-bold">
            {unrepliedCount} unreplied
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-900">
        <button
          onClick={() => onOpen(project)}
          className="text-[10px] px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white font-bold transition-colors"
        >
          Open
        </button>
        <button
          onClick={() => onManageContext(project)}
          className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Manage Context
        </button>
        {onFollowBuild && (
          <button
            onClick={() => onFollowBuild(project)}
            title="Follow this project's build progress"
            data-testid="project-follow-build-button"
            className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Follow Build
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onRename(project)}
          title="Rename project"
          className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Rename
        </button>
        <button
          onClick={() => onDelete(project)}
          title="Delete project"
          className="text-[10px] px-2 py-1 rounded border border-red-900 text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
