import React, { useState } from 'react';

export function KpiRollupPanel({ tracks }) {
  const [collapsed, setCollapsed] = useState(false);

  // Group tracks that have both kpi_maps_to and kpi_target
  const mapped = tracks.filter(t => t.kpi_maps_to && t.kpi_target > 0);
  if (mapped.length === 0) return null;

  // Aggregate by kpi_maps_to metric name
  const metrics = {};
  for (const t of mapped) {
    const key = t.kpi_maps_to;
    if (!metrics[key]) metrics[key] = { target: 0, actual: 0, tracks: [] };
    // Use the max target seen for this metric (all tracks mapping to same metric share the goal)
    metrics[key].target = Math.max(metrics[key].target, t.kpi_target ?? 0);
    metrics[key].actual += t.kpi_actual ?? 0;
    metrics[key].tracks.push(t);
  }

  const entries = Object.entries(metrics);

  return (
    <div className="mb-4 border border-gray-800 rounded-lg bg-gray-950 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Project KPIs</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{entries.length} metrics</span>
        </div>
        <span className="text-gray-600 text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {entries.map(([metric, data]) => {
            const pct = data.target > 0 ? Math.min(100, Math.round((data.actual / data.target) * 100)) : 0;
            const passed = data.actual >= data.target;
            return (
              <div key={metric} className="bg-gray-900 rounded-lg px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-300 font-medium truncate" title={metric}>{metric}</span>
                  <span className={`text-[10px] font-bold shrink-0 ${passed ? 'text-green-400' : 'text-gray-500'}`}>
                    {pct}%
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${passed ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>{data.actual.toLocaleString()} / {data.target.toLocaleString()}</span>
                  <span>{data.tracks.length} track{data.tracks.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
