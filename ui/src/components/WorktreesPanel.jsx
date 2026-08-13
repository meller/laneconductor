import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi.js';

// Track 1112 Phase 7: project-level worktree visibility, WorkersList.jsx's
// grid-layout pattern. Primary surface for "N unmerged branches, nobody
// noticed" — a per-track-only view would need clicking into every track to
// see the same thing (see TrackDetailPanel's inline strip for that
// secondary, detail-level view of this same data).

const CLASS_BADGE = {
  stranded: { label: 'Stranded', icon: '🔴', className: 'bg-red-950/40 text-red-300 border-red-800/80' },
  conflicted: { label: 'Conflicted', icon: '🟠', className: 'bg-amber-950/40 text-amber-300 border-amber-800/80' },
  mergeable: { label: 'Mergeable', icon: '🟢', className: 'bg-green-950/40 text-green-300 border-green-800/80' },
  open: { label: 'Open', icon: '⚪', className: 'bg-gray-900 text-gray-400 border-gray-800' },
  detached: { label: 'Detached', icon: '🟣', className: 'bg-purple-950/40 text-purple-300 border-purple-800/80' },
};

// stranded -> conflicted -> mergeable -> open, per the design decision —
// the rows that need a human's attention float to the top.
const CLASS_SORT_ORDER = { stranded: 0, conflicted: 1, mergeable: 2, detached: 3, open: 4 };

function WorktreeRow({ row, onMerge, merging }) {
  const badge = CLASS_BADGE[row.class] || CLASS_BADGE.open;
  const canMerge = row.class === 'mergeable' || row.class === 'stranded';
  const isConflicted = row.class === 'conflicted';

  return (
    <div
      className={`border rounded-xl p-4 flex flex-col gap-3 transition-colors shadow-sm ${row.class === 'stranded' ? 'bg-red-950/10 border-red-900/50' : 'bg-gray-900 border-gray-800 hover:border-gray-700'
        }`}
      data-testid="worktree-row"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-200">{row.track ? `#${row.track}` : row.branch || 'unknown'}</span>
            {row.host && (
              <span className="text-[9px] font-mono text-gray-600 bg-black/30 px-1.5 py-0.5 rounded border border-gray-800">
                {row.host}
              </span>
            )}
          </div>
          {row.title && <span className="text-xs text-gray-400 truncate">{row.title}</span>}
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${badge.className}`}>
          <span>{badge.icon}</span>
          <span>{badge.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Lane</span>
          <span className="text-[11px] text-gray-300">{row.lane ? `${row.lane}:${row.lane_status ?? '?'}` : '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Ahead</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.ahead ?? '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Behind</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.behind ?? '—'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase font-bold">Dirty</span>
          <span className="text-[11px] text-gray-300 font-mono">{row.dirty ?? '—'}</span>
        </div>
      </div>

      <div className="flex items-center justify-end pt-2 border-t border-gray-800/50">
        {canMerge && (
          <button
            onClick={() => onMerge(row)}
            disabled={merging}
            data-testid="merge-to-main-btn"
            className="text-[10px] px-2.5 py-1 border border-green-800/60 bg-green-950/30 text-green-300 hover:bg-green-900/40 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold uppercase tracking-wider transition-colors"
          >
            {merging ? 'Merging…' : 'Merge to main'}
          </button>
        )}
        {isConflicted && (
          <span
            className="text-[10px] px-2.5 py-1 border border-gray-800 text-gray-600 rounded font-bold uppercase tracking-wider cursor-not-allowed"
            title="This branch conflicts with main — resolve manually (lc worktrees merge for details)"
          >
            Merge to main
          </span>
        )}
      </div>
    </div>
  );
}

export function WorktreesPanel({ projectId }) {
  const { apiFetch } = useApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergingTrack, setMergingTrack] = useState(null);
  const [error, setError] = useState(null);

  const fetchRows = useCallback(() => {
    if (!projectId) return;
    apiFetch(`/api/projects/${projectId}/worktrees`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setRows(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchRows();
    const id = setInterval(fetchRows, 10000);
    return () => clearInterval(id);
  }, [fetchRows]);

  async function handleMerge(row) {
    if (!row.track) return;
    setError(null);
    setMergingTrack(row.track);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'merge-worktree', payload: { track_number: row.track } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      // Dispatch is async (a worker picks it up) — the row will update to
      // reflect the merge once that worker's next poll runs and reports
      // back; refetch now anyway so `merging` doesn't spin forever.
      fetchRows();
    } catch (err) {
      setError(`Failed to dispatch merge for #${row.track}: ${err.message}`);
    } finally {
      setMergingTrack(null);
    }
  }

  const sorted = [...rows].sort((a, b) => (CLASS_SORT_ORDER[a.class] ?? 9) - (CLASS_SORT_ORDER[b.class] ?? 9));
  const hosts = [...new Set(rows.map(r => r.host).filter(Boolean))];
  const groupByHost = hosts.length > 1;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading worktrees…</div>;
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6">
        <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 shadow-inner">
          <span className="text-2xl opacity-50">🌳</span>
        </div>
        <h3 className="text-gray-300 font-medium mb-1">No Unmerged Worktrees</h3>
        <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
          Every worktree for this project is either fully merged or hasn't reported yet — a worker needs at least
          one heartbeat to populate this list.
        </p>
      </div>
    );
  }

  const renderGroup = (groupRows) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {groupRows.map((row, i) => (
        <WorktreeRow key={`${row.host || ''}-${row.track || row.branch || i}`} row={row} onMerge={handleMerge} merging={mergingTrack === row.track} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</div>
      )}
      {groupByHost
        ? hosts.map(host => (
          <div key={host} className="flex flex-col gap-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">{host}</h3>
            {renderGroup(sorted.filter(r => r.host === host))}
          </div>
        ))
        : renderGroup(sorted)}
    </div>
  );
}
