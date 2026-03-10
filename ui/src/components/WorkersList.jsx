import React, { useState } from 'react';
import { WorkerVisibilityDialog } from './WorkerVisibilityDialog.jsx';

const VISIBILITY_BADGE = {
  private: { label: 'Private', icon: '🔒', className: 'text-gray-500 border-gray-800' },
  team: { label: 'Team', icon: '👥', className: 'text-blue-400 border-blue-900/50' },
  public: { label: 'Public', icon: '🌐', className: 'text-green-400 border-green-900/50' },
};

function ProviderStatus({ providers }) {
  if (!providers || providers.length === 0) return null;

  return (
    <div className="flex items-center gap-3 ml-3 border-l border-gray-800 pl-3">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
        LLM Status:
      </div>
      {providers.map(p => {
        const isExhausted = p.status === 'exhausted';
        const resetTime = p.reset_at ? new Date(p.reset_at) : null;
        const now = new Date();
        const diffSecs = resetTime ? Math.max(0, Math.floor((resetTime - now) / 1000)) : 0;

        // If reset time is in the past, it's actually available but DB hasn't updated yet
        const effectivelyExhausted = isExhausted && diffSecs > 0;

        const waitFmt = diffSecs > 3600
          ? `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`
          : diffSecs > 60
            ? `${Math.floor(diffSecs / 60)}m`
            : `${diffSecs}s`;

        return (
          <div key={p.provider} className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded px-2 py-0.5 whitespace-nowrap" title={p.last_error}>
            <div className={`w-1.5 h-1.5 rounded-full ${effectivelyExhausted ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
            <span className="text-[11px] font-medium text-gray-300 capitalize">{p.provider}</span>
            {effectivelyExhausted && (
              <span className="text-[10px] text-red-400 border-l border-gray-700 pl-2">
                Exhausted (resets in {waitFmt})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WaitingQueue({ tracks, onPriorityChange }) {
  if (!tracks || tracks.length === 0) return (
    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
      <span className="text-2xl mb-2 opacity-20">📭</span>
      <p className="text-gray-600 text-xs italic">Queue is empty — no tracks waiting</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {tracks.map(track => (
        <div key={`${track.project_id}-${track.track_number}`} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg p-3 group hover:border-gray-700 transition-colors">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight">{track.project_name}</span>
              <span className="text-xs font-bold text-gray-300">#{track.track_number}</span>
            </div>
            <p className="text-sm text-gray-200 font-medium truncate max-w-[300px]">{track.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-500 uppercase font-bold tracking-widest">
                {track.lane_status}
              </span>
              <span className="text-[10px] text-gray-600">
                Added {new Date(track.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[9px] text-gray-600 uppercase font-bold tracking-widest">Priority</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPriorityChange(track, (track.priority || 0) - 1)}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-800 text-gray-500 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 transition-colors"
                >
                  -
                </button>
                <span className={`text-xs font-mono font-bold w-6 text-center ${track.priority > 0 ? 'text-blue-400' : track.priority < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {track.priority || 0}
                </span>
                <button
                  onClick={() => onPriorityChange(track, (track.priority || 0) + 1)}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-800 text-gray-500 hover:text-green-400 hover:border-green-900/50 hover:bg-green-950/20 transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkersList({ projectId, workers, providers = [], waitingTracks = [], layout = 'strip', onRefresh }) {
  const hasWorkers = workers && workers.length > 0;
  const [visibilityWorker, setVisibilityWorker] = useState(null);

  async function handleWorkerAction(action) {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/worker/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      console.log(`Worker ${action} result:`, data);
    } catch (err) {
      console.error(`Failed to ${action} worker:`, err);
      alert(`Failed to ${action} worker: ${err.message}`);
    }
  }

  async function handlePriorityChange(track, newPriority) {
    try {
      await fetch(`/api/projects/${track.project_id}/tracks/${track.track_number}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });
      // Global refresh via WS should trigger, but we could also locally update if needed
    } catch (err) {
      console.error('Failed to update priority:', err);
    }
  }

  if (layout === 'grid') {
    // For now we don't show providers in grid layout as it's less common, or we could add them at the top
    if (!hasWorkers) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-6">
          <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 shadow-inner">
            <span className="text-2xl opacity-50">🤖</span>
          </div>
          <h3 className="text-gray-300 font-medium mb-1">No Active Workers</h3>
          <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
            There are no heartbeat workers currently registered for this project.
          </p>
          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="p-3 bg-gray-900/50 border border-gray-800 rounded-lg text-left w-full max-w-xs">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-bold mb-2">How to start a worker:</p>
              <code className="text-xs text-blue-400 block font-mono">
                $ make lc-start
              </code>
            </div>

            <button
              onClick={() => handleWorkerAction('start')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
            >
              Start Sync Worker
            </button>
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="flex flex-col gap-8">
          {/* LLM Providers Section */}
          {providers && providers.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">LLM Providers</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {providers.map(p => {
                  const isExhausted = p.status === 'exhausted';
                  const resetTime = p.reset_at ? new Date(p.reset_at) : null;
                  const now = new Date();
                  const diffSecs = resetTime ? Math.max(0, Math.floor((resetTime - now) / 1000)) : 0;
                  const effectivelyExhausted = isExhausted && diffSecs > 0;

                  const waitFmt = diffSecs > 3600
                    ? `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`
                    : diffSecs > 60
                      ? `${Math.floor(diffSecs / 60)}m`
                      : `${diffSecs}s`;

                  return (
                    <div
                      key={p.provider}
                      className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm group ${effectivelyExhausted ? 'border-red-900/50 bg-red-950/5' : 'border-gray-800'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${effectivelyExhausted ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                          <span className="font-semibold text-gray-200 capitalize">{p.provider}</span>
                        </div>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${effectivelyExhausted ? 'text-red-400 border-red-900/50 bg-red-900/10' : 'text-gray-500 border-gray-800 bg-black/30'
                          }`}>
                          {effectivelyExhausted ? 'EXHAUSTED' : 'HEALTHY'}
                        </span>
                      </div>

                      <div className="flex-1 min-h-[3rem]">
                        {effectivelyExhausted ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-red-500/70 uppercase font-bold tracking-tight">Cooldown Active</span>
                            <p className="text-xs text-red-200/80 leading-relaxed bg-red-900/10 p-2 rounded border border-red-900/20 font-mono">
                              Resets in {waitFmt}
                            </p>
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center border border-dashed border-gray-800 rounded-lg">
                            <span className="text-[11px] text-gray-600 italic">Available for tasks</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-800/50">
                        <div className="flex flex-col">
                          <span className="text-[9px] text-gray-600 uppercase font-bold">Model Pool</span>
                          <span className="text-[11px] text-gray-400 capitalize">
                            {p.provider} API
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] text-gray-600 uppercase font-bold">Updated</span>
                          <span className="text-[11px] text-gray-400">
                            {new Date(p.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sync Workers Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pl-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Heartbeat Workers</h3>
              <button
                onClick={() => handleWorkerAction('stop')}
                className="text-[10px] px-2 py-1 border border-red-900/50 text-red-400 hover:bg-red-900/20 rounded font-bold uppercase tracking-wider transition-colors"
              >
                Stop All Workers
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {workers.map(worker => {
                const vis = VISIBILITY_BADGE[worker.visibility || 'private'];
                return (
                  <div
                    key={worker.id}
                    className={`border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm group ${worker.status === 'busy' ? 'bg-amber-900/10 border-amber-800' : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                      }`}
                    data-testid="worker-card"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${worker.status === 'busy' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-200">{worker.hostname}</span>
                            {worker.mode ? (
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shadow-sm ${worker.mode === 'sync-only'
                                ? 'bg-blue-600/20 text-blue-400 border-blue-500/50'
                                : 'bg-purple-600/20 text-purple-400 border-purple-500/50'
                                }`}>
                                {worker.mode === 'sync-only' ? 'SYNC-ONLY' : 'SYNC+POLL'}
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-gray-600/20 text-gray-500 border-gray-500/50">
                                UNKNOWN MODE
                              </span>
                            )}
                          </div>
                          {worker.project_name && (
                            <span className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight">
                              {worker.project_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setVisibilityWorker(worker)}
                          data-testid="worker-sharing-btn"
                          title={`Sharing: ${worker.visibility || 'private'}`}
                          className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider transition-colors hover:bg-gray-800 ${vis.className}`}
                        >
                          <span>{vis.icon}</span>
                          <span>{vis.label}</span>
                        </button>
                        <span className="text-[10px] font-mono text-gray-600 bg-black/30 px-1.5 py-0.5 rounded border border-gray-800">
                          PID: {worker.pid}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 min-h-[3rem]">
                      {worker.current_task ? (
                        <div className="flex flex-col gap-1">
                          <span className={`text-[10px] uppercase font-bold tracking-tight ${worker.status === 'busy' ? 'text-amber-500' : 'text-gray-500'}`}>
                            Current Task
                          </span>
                          <p className={`text-xs leading-relaxed p-2 rounded border font-medium ${worker.status === 'busy'
                            ? 'bg-amber-950/40 text-amber-300 border-amber-800/80 shadow-[0_0_10px_rgba(217,119,6,0.1)]'
                            : 'bg-gray-950/50 text-gray-300 border-gray-800/50'
                            }`}>
                            {worker.current_task}
                          </p>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center border border-dashed border-gray-800 rounded-lg">
                          <span className="text-[11px] text-gray-600 italic">Idle — waiting for task</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-800/50">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-gray-600 uppercase font-bold">Status</span>
                        <span className={`text-[11px] font-medium ${worker.status === 'busy' ? 'text-amber-400' : 'text-green-400'}`}>
                          {worker.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-gray-600 uppercase font-bold">Last Beat</span>
                        <span className="text-[11px] text-gray-400">
                          {new Date(worker.last_heartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Waiting Queue Section (REQ-9, REQ-10) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pl-1">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                Waiting Queue
                {waitingTracks.length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    {waitingTracks.length}
                  </span>
                )}
              </h3>
              <span className="text-[10px] text-gray-600 italic">Sorted by priority, then creation date</span>
            </div>
            <WaitingQueue
              tracks={waitingTracks}
              onPriorityChange={handlePriorityChange}
            />
          </div>
        </div>

        {visibilityWorker && (
          <WorkerVisibilityDialog
            worker={visibilityWorker}
            onClose={() => setVisibilityWorker(null)}
            onUpdated={() => { onRefresh?.(); setVisibilityWorker(null); }}
          />
        )}
      </>
    );
  }

  // Default 'strip' layout
  return (
    <div className="flex items-center bg-gray-900/50 border-b border-gray-800 overflow-x-auto no-scrollbar py-0.5">
      <div className="flex items-center gap-3 px-4 border-r border-gray-800 min-h-[28px]">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
          Workers:
        </div>
        {!hasWorkers && <span className="text-[10px] text-gray-600 italic">none active</span>}
        {workers.map(worker => (
          <div
            key={worker.id}
            className={`flex items-center gap-2 bg-gray-950 border rounded px-2 py-0.5 whitespace-nowrap transition-colors ${worker.status === 'busy' ? 'border-amber-700/50 bg-amber-900/10' : 'border-gray-800'
              }`}
            title={`PID: ${worker.pid} | Last beat: ${new Date(worker.last_heartbeat).toLocaleTimeString()}`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${worker.status === 'busy' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
            <span className={`text-[11px] font-medium transition-colors ${worker.status === 'busy' ? 'text-amber-200' : 'text-gray-300'}`}>
              {worker.hostname}
            </span>
            {worker.mode ? (
              <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${worker.mode === 'sync-only'
                ? 'bg-blue-900/40 text-blue-400 border-blue-800/50'
                : 'bg-purple-900/40 text-purple-400 border-purple-800/50'
                }`}>
                {worker.mode === 'sync-only' ? 'SYNC-ONLY' : 'SYNC+POLL'}
              </span>
            ) : (
              <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border bg-gray-600/20 text-gray-500 border-gray-500/50">
                UNKNOWN
              </span>
            )}
            {worker.project_name && (
              <span className="text-[9px] font-mono text-blue-500 font-bold uppercase tracking-tight border-l border-gray-800 pl-2">
                {worker.project_name}
              </span>
            )}
            {worker.current_task && (
              <span className={`text-[10px] border-l pl-2 max-w-[200px] truncate transition-colors ${worker.status === 'busy' ? 'text-amber-400/80 border-amber-800/50' : 'text-gray-500 border-gray-800'
                }`}>
                {worker.current_task}
              </span>
            )}
          </div>
        ))}
      </div>

      {waitingTracks.length > 0 && (
        <div className="flex items-center gap-2 px-4 border-r border-gray-800 min-h-[28px]" title="Tracks in waiting queue">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex-shrink-0">
            Queue:
          </div>
          <span className="bg-blue-900/50 text-blue-400 text-[11px] font-bold px-2 py-0.5 rounded border border-blue-800/50">
            {waitingTracks.length} tracks
          </span>
        </div>
      )}

      <ProviderStatus providers={providers} />
    </div>
  );
}
