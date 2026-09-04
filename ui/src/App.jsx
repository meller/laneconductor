import React, { useState, useEffect, useMemo } from 'react';
import { usePolling } from './hooks/usePolling.js';
import { useApi } from './hooks/useApi.js';
import { useIsMobile, MOBILE_MEDIA_QUERY } from './hooks/useIsMobile.js';
import { ProjectSelector } from './components/ProjectSelector.jsx';
import { KanbanBoard } from './components/KanbanBoard.jsx';
import { LaneFocusView } from './components/LaneFocusView.jsx';
import { MobileTabBar } from './components/MobileTabBar.jsx';
import { MobileMoreSheet } from './components/MobileMoreSheet.jsx';
import { MobileFocusView } from './components/MobileFocusView.jsx';
import { BoardToolbar } from './components/BoardToolbar.jsx';
import { ConductorPanel } from './components/ConductorPanel.jsx';
import { TrackDetailPanel } from './components/TrackDetailPanel.jsx';
import { NewTrackModal } from './components/NewTrackModal.jsx';
import { NewProjectModal } from './components/NewProjectModal.jsx';
import { FollowBuildView } from './components/wizard/FollowBuildView.jsx';
import { ProjectsPage } from './components/ProjectsPage.jsx';
import { RenameProjectModal } from './components/RenameProjectModal.jsx';
import { DeleteProjectModal } from './components/DeleteProjectModal.jsx';
import { WorkersList } from './components/WorkersList.jsx';
import { WorktreesPanel } from './components/WorktreesPanel.jsx';
import { CICDView } from './components/CICDView.jsx';
import { InboxPanel } from './components/InboxPanel.jsx';
import { WorkerActivityLatch } from './components/WorkerActivityLatch.jsx';
import { CloudOnboarding } from './components/CloudOnboarding.jsx';
import { WorkflowSettings } from './pages/WorkflowSettings.jsx';
import { ProjectConfigSettings } from './pages/ProjectConfigSettings.jsx';
import { KpiRollupPanel } from './components/KpiRollupPanel.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { AccountPanel } from './pages/AccountPanel.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

function timeAgo(date) {
  if (!date) return null;
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

const LANE_LABELS = {
  plan: 'Plan',
  backlog: 'Backlog',
  implement: 'Implement',
  review: 'Review',
  'quality-gate': 'Quality Gate',
  done: 'Done',
};

function filterTracksByText(tracks, searchText) {
  const query = searchText.trim().toLowerCase();
  if (!query) return tracks;
  return tracks.filter(t =>
    (t.title || '').toLowerCase().includes(query) ||
    (t.track_number || '').toLowerCase().includes(query)
  );
}

function sortTracks(tracks, sortBy, sortDir) {
  const sorted = [...tracks].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(a.created_at) - new Date(b.created_at);
    }
    return String(a.track_number).localeCompare(String(b.track_number), undefined, { numeric: true });
  });
  return sortDir === 'desc' ? sorted.reverse() : sorted;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  const { user, loading: authLoading, logout } = useAuth();

  // Auth gate: while loading show spinner; if not authenticated show login page
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #1d4ed8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <ErrorBoundary>
      <AppContent user={user} logout={logout} />
    </ErrorBoundary>
  );
}

function AppContent({ user, logout }) {
  const { apiFetch } = useApi();
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [conductorOpen, setConductorOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeTrack, setActiveTrack] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { track, targetLane }
  const [newTrackOpen, setNewTrackOpen] = useState(false);
  const [newTrackType, setNewTrackType] = useState('feature');
  const [newProjectOpen, setNewProjectOpen] = useState(false); // Track 1091 Phase 4
  const [renameTarget, setRenameTarget] = useState(null); // Track 10014
  const [deleteTarget, setDeleteTarget] = useState(null); // Track 10014
  const [followBuildProjectId, setFollowBuildProjectId] = useState(null); // Track AM-1119 Phase 5
  const [managerWorkers, setManagerWorkers] = useState([]);
  const [knownHostnames, setKnownHostnames] = useState([]);
  // Track 1121 REQ-15: Focus is the default view below `md` on first load;
  // desktop keeps the existing 'lanes' default. Computed once at mount from
  // the same media query useIsMobile() reads, so there is one definition of
  // "mobile" even though this particular read has to happen before the
  // hook itself could report a value.
  const [viewMode, setViewMode] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_MEDIA_QUERY).matches
      ? 'focus'
      : 'lanes'
  )); // 'lanes' | 'workers' | 'cicd' | 'projects' | 'worktrees' | 'focus' (mobile only)
  const isMobile = useIsMobile();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [worktreeHighlightTrack, setWorktreeHighlightTrack] = useState(null); // set by a done-lane card's "View in Worktrees" link
  const [inboxOpen, setInboxOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false); // Track 1087 Phase 5: worker activity latch
  const [accountOpen, setAccountOpen] = useState(false);
  const [boardMode, setBoardMode] = useState('board'); // 'board' | 'lane'
  const [focusedLane, setFocusedLane] = useState(null);
  const [sortBy, setSortBy] = useState('date'); // 'track_number' | 'date'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [searchText, setSearchText] = useState('');

  const { projects, tracks, workers, providers, waitingTracks, loading, error, lastUpdated, refetch, wsConnected } = usePolling(selectedProjectId);

  const displayTracks = useMemo(
    () => sortTracks(filterTracksByText(tracks, searchText), sortBy, sortDir),
    [tracks, searchText, sortBy, sortDir]
  );

  // N key shortcut — open New Track modal when no input is focused
  useEffect(() => {
    function handler(e) {
      if (e.key === 'n' || e.key === 'N') {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        setNewTrackType('feature');
        setNewTrackOpen(true);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const inboxBadgeCount = tracks.reduce((sum, t) => sum + (t.unreplied_count ?? 0), 0);

  // Track 1091 Phase 4: manager workers aren't scoped to any project, so
  // they're fetched independently of usePolling's (project-scoped when a
  // project is selected) workers state — needed for the New Project
  // wizard's picker regardless of which project (if any) is selected.
  async function openNewProject() {
    try {
      const r = await apiFetch('/api/workers');
      const all = await r.json();
      setManagerWorkers(all.filter(w => w.type === 'manager'));
      // Distinct hostnames across ALL workers (not just managers) — lets the
      // empty state name which of the user's connected machines don't have
      // a manager yet, rather than a bare "start one" with no machine
      // context. Relevant once a user has multiple machines connected
      // (remote/non-local mode) — picking a machine and then discovering it
      // has no manager is a materially different situation from having none
      // registered anywhere at all.
      setKnownHostnames([...new Set(all.map(w => w.hostname))]);
    } catch (err) {
      console.error('Failed to fetch manager workers:', err);
      setManagerWorkers([]);
      setKnownHostnames([]);
    }
    setNewProjectOpen(true);
  }

  function handleTrackClick(track) {
    const pid = track.project_id ?? selectedProjectId;
    setActiveTrack({ projectId: pid, trackNumber: track.track_number });
  }

  function handleInboxSelect(projectId, trackNumber, opts) {
    setActiveTrack({ projectId, trackNumber, initialTab: 'conversation', openTranscript: Boolean(opts?.transcript) });
    setInboxOpen(false);
  }

  function handleLaneChange(track, targetLane) {
    setPendingAction({ track, targetLane });
  }

  function handleExpandLane(laneId) {
    setFocusedLane(laneId);
    setBoardMode('lane');
  }

  // Track 1121: the mobile tab bar's active tab derives from viewMode
  // rather than forking its own state — Projects/CI/CD/Worktrees (reached
  // via the More sheet) all read back as the "more" tab.
  const mobileTab = viewMode === 'focus' ? 'focus'
    : viewMode === 'lanes' ? 'board'
      : viewMode === 'workers' ? 'workers'
        : 'more';

  function handleMobileTabSelect(tab) {
    if (tab === 'more') { setMobileMoreOpen(true); return; }
    if (tab === 'focus') { setViewMode('focus'); return; }
    if (tab === 'board') { setViewMode('lanes'); return; }
    if (tab === 'workers') { setViewMode('workers'); return; }
  }

  function handleFocusGoToLane(laneId) {
    setViewMode('lanes');
    setBoardMode('lane');
    setFocusedLane(laneId);
  }

  async function handleRerunImplement(track) {
    const pid = track.project_id ?? selectedProjectId;
    try {
      await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}/implement`, {
        method: 'POST',
      });
      refetch();
    } catch (err) {
      console.error('Re-run implement failed:', err);
    }
  }

  async function handleDeleteTrack(track) {
    const pid = track.project_id ?? selectedProjectId;
    try {
      await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}`, { method: 'DELETE' });
      refetch();
    } catch (err) {
      console.error('Delete track failed:', err);
    }
  }

  async function handleFixReview(track) {
    const pid = track.project_id ?? selectedProjectId;
    try {
      await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}/fix-review`, {
        method: 'POST',
      });
      refetch();
    } catch (err) {
      console.error('Fix review failed:', err);
    }
  }

  function handleProjectDeleted(deletedProjectId) {
    // Track 10014 Phase 4 Task 3: avoid landing on a Lanes view for a
    // project that no longer exists.
    if (deletedProjectId === selectedProjectId) {
      setSelectedProjectId(null);
      setViewMode('projects');
    }
    refetch();
  }

  async function handleMarkPublished(track) {
    const pid = track.project_id ?? selectedProjectId;
    try {
      await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'human', body: 'done' }),
      });
      refetch();
    } catch (err) {
      console.error('Mark published failed:', err);
    }
  }

  async function handleConfirm() {
    const { track, targetLane } = pendingAction;
    const pid = track.project_id ?? selectedProjectId;
    try {
      await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}`, {
        method: 'PATCH',
        body: JSON.stringify({ lane_status: targetLane }),
      });
      refetch();
    } catch (err) {
      console.error('Lane change failed:', err);
    }
    setPendingAction(null);
  }

  function confirmTitle() {
    if (!pendingAction) return '';
    return `Move to ${LANE_LABELS[pendingAction.targetLane]} lane?`;
  }

  function confirmSubtitle() {
    if (!pendingAction) return '';
    const { track, targetLane } = pendingAction;
    return `#${track.track_number} "${track.title}" moves from ${LANE_LABELS[track.lane_status]} → ${LANE_LABELS[targetLane]}.`;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950 px-3 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="LaneConductor" className="h-8 w-auto" />
            <span className="text-lg font-bold tracking-tight text-white hidden md:block">
              LaneConductor
            </span>
          </div>
          <div className="h-6 w-px bg-gray-800 hidden sm:block" />
          <span className="text-gray-500 text-[10px] uppercase tracking-[0.2em] font-medium hidden lg:block">
            Claude Skill <span className="text-gray-700 mx-1">•</span> Kanban UI
          </span>
        </div>

        <div className="flex items-center gap-4">
          {(selectedProject || projects.length > 0) && (
            <div className="hidden md:flex bg-gray-900 border border-gray-800 rounded-lg p-0.5">
              {/* Track 10014: unlike Lanes/Workers/CI/CD/Worktrees, Projects
                  is how you PICK a project in the first place, so it must
                  never be gated behind selectedProjectId. */}
              <button
                onClick={() => setViewMode('projects')}
                className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-md transition-all ${viewMode === 'projects'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                Projects
              </button>
              <button
                onClick={() => setViewMode('lanes')}
                className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-md transition-all ${viewMode === 'lanes'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                Lanes
              </button>
              <button
                onClick={() => setViewMode('workers')}
                className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-md transition-all ${viewMode === 'workers'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                Workers
              </button>
              <button
                onClick={() => setViewMode('cicd')}
                className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-md transition-all ${viewMode === 'cicd'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                CI/CD
              </button>
              {/* Track 1112 Phase 7: worktrees are physically per-machine,
                  scoped to one project's checkout — no meaningful cross-
                  project view, so this tab only appears once a project is
                  selected (same gating as the parent block itself, but
                  worth being explicit here since Lanes/Workers/CI/CD all
                  degrade gracefully in All Projects mode and this one
                  can't). */}
              {selectedProjectId && (
                <button
                  onClick={() => { setWorktreeHighlightTrack(null); setViewMode('worktrees'); }}
                  className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-md transition-all ${viewMode === 'worktrees'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                    }`}
                >
                  Worktrees
                </button>
              )}
            </div>
          )}

          {selectedProject && (
            <button
              onClick={() => setConductorOpen(v => !v)}
              className={`hidden md:inline-flex text-xs px-2.5 py-1 rounded border transition-colors ${conductorOpen
                ? 'bg-blue-900 border-blue-700 text-blue-200'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
            >
              📄 Context
            </button>
          )}

          {selectedProject && (
            <button
              onClick={() => setWorkflowOpen(v => !v)}
              className={`hidden md:inline-flex text-xs px-2.5 py-1 rounded border transition-colors ${workflowOpen
                ? 'bg-purple-900 border-purple-700 text-purple-200'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
            >
              ⚙️ Workflow
            </button>
          )}

          {selectedProject && (
            <button
              onClick={() => setConfigOpen(v => !v)}
              data-testid="config-btn"
              className={`hidden md:inline-flex text-xs px-2.5 py-1 rounded border transition-colors ${configOpen
                ? 'bg-blue-900 border-blue-700 text-blue-200'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
            >
              ⚙️ Config
            </button>
          )}

          <div className="hidden md:flex items-center gap-1">
            {/* Track 1087 Phase 5: worker activity latch — reachable from anywhere */}
            <button
              onClick={() => setActivityOpen(true)}
              title="See any worker's live session transcript"
              className={`text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-2 ${activityOpen
                ? 'bg-orange-900 border-orange-700 text-orange-200'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
            >
              ⚡ Activity
            </button>
            <button
              onClick={() => setInboxOpen(true)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-2 ${inboxOpen
                ? 'bg-orange-900 border-orange-700 text-orange-200'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
            >
              📥 Inbox
              {inboxBadgeCount > 0 && (
                <span className="bg-orange-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px]">
                  {inboxBadgeCount}
                </span>
              )}
            </button>
            <button
              onClick={() => { setNewTrackType('feature'); setNewTrackOpen(true); }}
              className="text-xs px-2.5 py-1 rounded-l border border-blue-800 text-blue-400 hover:bg-blue-900/30 hover:text-blue-300 transition-colors ml-2"
              title="New Track (N)"
            >
              + Track
            </button>
            <button
              onClick={() => { setNewTrackType('bug'); setNewTrackOpen(true); }}
              className="text-xs px-2.5 py-1 rounded-r border border-red-900 text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors"
              title="Report a Bug"
            >
              ⚠ Bug
            </button>
            <button
              onClick={openNewProject}
              className="text-xs px-2.5 py-1 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300 transition-colors ml-2"
              title="New Project"
            >
              + Project
            </button>
          </div>
          <ProjectSelector
            projects={projects}
            selectedId={selectedProjectId}
            onChange={id => { setSelectedProjectId(id); setConductorOpen(false); }}
          />
          <div className="text-xs text-gray-500 hidden sm:flex items-center gap-2">
            {loading && !lastUpdated ? (
              'connecting…'
            ) : error ? (
              <span className="text-red-400">DB error: {error}</span>
            ) : (
              <>
                <div
                  className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-600'}`}
                  title={wsConnected ? 'Live push active (WS)' : 'Polling fallback (WS disconnected)'}
                />
                updated {timeAgo(lastUpdated)}
              </>
            )}
          </div>
          {/* User identity — clickable to open Account panel */}
          {user && !user.local && (
            <button
              onClick={() => setAccountOpen(v => !v)}
              className="flex items-center gap-2 border-l border-gray-800 pl-4 hover:opacity-80 transition-opacity"
              title="Account & API Keys"
            >
              {user.picture ? (
                <img src={user.picture} alt={user.name} className="w-6 h-6 rounded-full border border-gray-700" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-300">
                  {(user.name || user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs text-gray-400 hidden sm:block">{user.email || user.name}</span>
            </button>
          )}

        </div>
      </header>

      {viewMode === 'lanes' && <WorkersList projectId={selectedProjectId} project={selectedProject} workers={workers} providers={providers} waitingTracks={waitingTracks} onSelectTrack={handleInboxSelect} />}

      {/* Conductor context panel */}
      {conductorOpen && selectedProject && (
        <ConductorPanel
          project={selectedProject}
          onClose={() => setConductorOpen(false)}
        />
      )}

      {/* Workflow settings panel */}
      {workflowOpen && selectedProject && (
        <div className="fixed inset-y-0 right-0 z-40 flex shadow-2xl">
          <WorkflowSettings
            projectId={selectedProject.id}
            project={selectedProject}
            workers={workers}
            onClose={() => setWorkflowOpen(false)}
          />
        </div>
      )}

      {/* Config settings panel */}
      {configOpen && selectedProject && (
        <div className="fixed inset-y-0 right-0 z-40 flex shadow-2xl">
          <ProjectConfigSettings
            projectId={selectedProject.id}
            onClose={() => setConfigOpen(false)}
          />
        </div>
      )}

      {!conductorOpen && selectedProject && (
        <div className="px-3 md:px-6 py-2 bg-blue-500/5 border-b border-white/5 text-[10px] text-gray-500 font-mono flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-blue-500" />
          {selectedProject.repo_path}
          <div className="flex-1" />
          <span className="text-gray-600 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded uppercase tracking-tighter">
            Isolated Environment Ready
          </span>
        </div>
      )}

      {/* Board */}
      <main className="flex-1 p-3 pb-20 md:p-6 md:pb-6 overflow-auto">
        {loading && !lastUpdated ? (
          <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
            Connecting to LaneConductor DB…
          </div>
        ) : error && !lastUpdated ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <p className="text-red-400 font-medium">Cannot reach the API server</p>
            <p className="text-gray-500 text-sm">
              Start it with <code className="px-1 bg-gray-800 rounded">npm run dev</code> or{' '}
              <code className="px-1 bg-gray-800 rounded">make lc-ui-start</code>
            </p>
          </div>
        ) : viewMode === 'focus' && selectedProjectId ? (
          <MobileFocusView
            projectId={selectedProjectId}
            tracks={displayTracks}
            onSelectTrack={handleInboxSelect}
            onGoToLane={handleFocusGoToLane}
          />
        ) : viewMode === 'projects' ? (
          <ProjectsPage
            projects={projects}
            tracks={tracks}
            workers={workers}
            onOpen={p => { setSelectedProjectId(p.id); setViewMode('lanes'); }}
            onManageContext={p => { setSelectedProjectId(p.id); setConductorOpen(true); setViewMode('lanes'); }}
            onRename={p => setRenameTarget(p)}
            onDelete={p => setDeleteTarget(p)}
            onNewProject={openNewProject}
            onFollowBuild={p => setFollowBuildProjectId(p.id)}
          />
        ) : viewMode === 'workers' ? (
          <WorkersList projectId={selectedProjectId} project={selectedProject} workers={workers} providers={providers} waitingTracks={waitingTracks} layout="grid" onRefresh={refetch} onSelectTrack={handleInboxSelect} />
        ) : viewMode === 'cicd' ? (
          <CICDView projectId={selectedProjectId} workers={workers} />
        ) : viewMode === 'worktrees' ? (
          <WorktreesPanel projectId={selectedProjectId} onSelectTrack={handleInboxSelect} onGoToWorkers={() => setViewMode('workers')} highlightTrack={worktreeHighlightTrack} />
        ) : tracks.length === 0 && user && !user.local ? (
          <RemoteEmptyState onOpenAccount={() => setAccountOpen(true)} />
        ) : projects.length === 0 ? (
          <LocalSetupEmptyState />
        ) : (
          <>
            <KpiRollupPanel tracks={tracks} />
            <BoardToolbar
              sortBy={sortBy}
              sortDir={sortDir}
              onSortByChange={setSortBy}
              onSortDirToggle={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              searchText={searchText}
              onSearchTextChange={setSearchText}
            />
            {searchText.trim() && displayTracks.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
                No tracks match "{searchText.trim()}".
              </div>
            ) : boardMode === 'lane' ? (
              <LaneFocusView
                projectId={selectedProjectId}
                tracks={displayTracks}
                focusedLane={focusedLane}
                onFocusLane={setFocusedLane}
                onBackToBoard={() => setBoardMode('board')}
                onTrackClick={handleTrackClick}
                onLaneChange={handleLaneChange}
                onFixReview={handleFixReview}
                onRerunImplement={handleRerunImplement}
                onDeleteTrack={handleDeleteTrack}
                onMarkPublished={handleMarkPublished}
                onViewInWorktrees={trackNumber => { setWorktreeHighlightTrack(trackNumber); setViewMode('worktrees'); }}
              />
            ) : (
              <KanbanBoard
                projectId={selectedProjectId}
                tracks={displayTracks}
                onTrackClick={handleTrackClick}
                onLaneChange={handleLaneChange}
                onFixReview={handleFixReview}
                onRerunImplement={handleRerunImplement}
                onDeleteTrack={handleDeleteTrack}
                onMarkPublished={handleMarkPublished}
                onExpandLane={handleExpandLane}
                onViewInWorktrees={trackNumber => { setWorktreeHighlightTrack(trackNumber); setViewMode('worktrees'); }}
              />
            )}
          </>
        )}
      </main>

      {/* Track detail slide-over */}
      {activeTrack && (
        <TrackDetailPanel
          projectId={activeTrack.projectId}
          trackNumber={activeTrack.trackNumber}
          initialTab={activeTrack?.initialTab}
          initialTranscriptOpen={activeTrack?.openTranscript}
          onClose={() => setActiveTrack(null)}
        />
      )}

      {/* Inbox panel */}
      {inboxOpen && (
        <InboxPanel
          projectId={selectedProjectId}
          onSelectTrack={handleInboxSelect}
          onClose={() => setInboxOpen(false)}
        />
      )}

      {/* Track 1087 Phase 5: worker activity latch */}
      {activityOpen && (
        <WorkerActivityLatch
          workers={workers}
          projectId={selectedProjectId}
          onClose={() => setActivityOpen(false)}
          onSelectTrack={handleInboxSelect}
        />
      )}



      {/* Track 1121: mobile bottom tab nav — only once a project is picked,
          matching the desktop view-mode switcher's own gating. */}
      {(selectedProject || projects.length > 0) && (
        <MobileTabBar active={mobileTab} onSelect={handleMobileTabSelect} />
      )}

      {mobileMoreOpen && (
        <MobileMoreSheet
          onClose={() => setMobileMoreOpen(false)}
          onNavigate={setViewMode}
          onOpenConductor={selectedProject ? () => setConductorOpen(true) : undefined}
          onOpenWorkflow={selectedProject ? () => setWorkflowOpen(true) : undefined}
          onOpenConfig={selectedProject ? () => setConfigOpen(true) : undefined}
          onOpenInbox={() => setInboxOpen(true)}
          onOpenActivity={() => setActivityOpen(true)}
          onOpenAccount={() => setAccountOpen(true)}
          showAccount={Boolean(user && !user.local)}
        />
      )}

      {/* Account panel */}
      {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}

      {/* New Track modal */}
      {newTrackOpen && (
        <NewTrackModal
          projectId={selectedProjectId}
          projects={projects}
          tracks={tracks}
          workers={workers}
          initialType={newTrackType}
          onClose={() => setNewTrackOpen(false)}
          onCreated={() => { setNewTrackOpen(false); refetch(); }}
          onResumed={() => { setNewTrackOpen(false); refetch(); }}
        />
      )}

      {/* New Project modal (Track 1091 Phase 4) */}
      {newProjectOpen && (
        <NewProjectModal
          managerWorkers={managerWorkers}
          knownHostnames={knownHostnames}
          onClose={() => setNewProjectOpen(false)}
          onCreated={refetch}
        />
      )}

      {/* Follow Build view (Track AM-1119 Phase 5) — reachable from the
          project page (ProjectCard) as well as the wizard's own post-Launch
          handoff inside NewProjectModal. "Needs your input" clicks route
          through the same handleInboxSelect the Inbox itself uses, so it
          opens the real TrackDetailPanel, not a dead link. */}
      {followBuildProjectId && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4"
          onClick={() => setFollowBuildProjectId(null)}
        >
          <div
            className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl px-5 py-4"
            onClick={e => e.stopPropagation()}
          >
            <FollowBuildView
              projectId={followBuildProjectId}
              onClose={() => setFollowBuildProjectId(null)}
              onOpenTrack={trackNumber => {
                handleInboxSelect(followBuildProjectId, trackNumber);
                setFollowBuildProjectId(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Rename / Delete project modals (Track 10014) */}
      {renameTarget && (
        <RenameProjectModal
          project={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={refetch}
        />
      )}
      {deleteTarget && (
        <DeleteProjectModal
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleProjectDeleted}
        />
      )}

      {/* Confirm dialog */}
      {pendingAction && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white text-sm font-semibold mb-1">{confirmTitle()}</p>
            <p className="text-gray-400 text-xs mb-5">{confirmSubtitle()}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingAction(null)}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteEmptyState({ onOpenAccount }) {
  return (
    <div className="flex items-center justify-center h-full min-h-64">
      <div className="max-w-md w-full text-center space-y-6 px-4">
        <div className="space-y-2">
          <p className="text-2xl">🚀</p>
          <h2 className="text-base font-bold text-white">Connect your first worker</h2>
          <p className="text-xs text-gray-500">
            No tracks yet. Start a worker in your project and it will appear here automatically.
          </p>
        </div>
        <div className="text-left space-y-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quick setup</p>
          {/* Track 10052: remote-api is not yet a working path — several worker
              endpoints (worker registration, queue claim, track locking) are
              still missing from the cloud API. Say so here rather than letting
              users discover it as a silently empty board. */}
          <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2">
            <p className="text-[11px] font-bold text-amber-300">⚠️ Cloud worker sync is not ready yet</p>
            <p className="text-[10px] text-amber-200/80 mt-1 leading-relaxed">
              Several worker endpoints are still missing from the cloud API, so a worker
              pointed here cannot register or claim work. Use <code className="font-mono">local-api</code> mode
              for now — the steps below are kept for testing only.
            </p>
          </div>
          <div className="space-y-3">
            {[
              ['1', 'Generate an API key', <button key="k" onClick={onOpenAccount} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-[11px]">Open Account →</button>],
              ['2', 'Configure your worker (not yet supported — see above)', <code key="c" className="text-[10px] font-mono text-blue-300 block mt-1 bg-gray-950 rounded px-2 py-1">lc config mode remote-api --url https://app.laneconductor.com --key YOUR_KEY</code>],
              ['3', 'Start the worker', <code key="s" className="text-[10px] font-mono text-blue-300 bg-gray-950 rounded px-2 py-1">lc start</code>],
            ].map(([n, label, extra]) => (
              <div key={n} className="flex gap-3 items-start">
                <div className="shrink-0 w-5 h-5 rounded-full bg-blue-900 border border-blue-700 flex items-center justify-center text-[10px] font-bold text-blue-300 mt-0.5">{n}</div>
                <div>
                  <p className="text-xs text-gray-300">{label}</p>
                  {extra}
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-600">
          Once running, create tracks with <code className="bg-gray-800 px-1 rounded">lc new "Title"</code>
        </p>
      </div>
    </div>
  );
}

function LocalSetupEmptyState() {
  return (
    <div className="flex items-center justify-center h-full min-h-64">
      <div className="max-w-md w-full text-center space-y-6 px-4">
        <div className="space-y-2">
          <p className="text-2xl">🛠️</p>
          <h2 className="text-base font-bold text-white">No projects yet</h2>
          <p className="text-xs text-gray-500">
            Register a project to start tracking tracks here.
          </p>
        </div>
        <div className="text-left space-y-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quick setup</p>
          <div className="space-y-3">
            {[
              ['1', 'Go to your project directory', <code key="c" className="text-[10px] font-mono text-blue-300 block mt-1 bg-gray-950 rounded px-2 py-1">cd your-project</code>],
              ['2', 'Register the project', <code key="s" className="text-[10px] font-mono text-blue-300 block mt-1 bg-gray-950 rounded px-2 py-1">lc setup</code>],
              ['3', 'Start the heartbeat worker', <code key="w" className="text-[10px] font-mono text-blue-300 block mt-1 bg-gray-950 rounded px-2 py-1">lc worker start</code>],
            ].map(([n, label, extra]) => (
              <div key={n} className="flex gap-3 items-start">
                <div className="shrink-0 w-5 h-5 rounded-full bg-blue-900 border border-blue-700 flex items-center justify-center text-[10px] font-bold text-blue-300 mt-0.5">{n}</div>
                <div>
                  <p className="text-xs text-gray-300">{label}</p>
                  {extra}
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-600">
          Once set up, tracks appear here automatically within seconds.
        </p>
      </div>
    </div>
  );
}

// Cloud mode app (Firebase Auth + cloud collector)
function CloudAppInner() {
  const { user, loading: authLoading, logout, apiToken } = useCloudAuth();
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [conductorOpen, setConductorOpen] = useState(false);
  const [activeTrack, setActiveTrack] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [newTrackOpen, setNewTrackOpen] = useState(false);
  const [newTrackType, setNewTrackType] = useState('feature');
  const [viewMode, setViewMode] = useState('lanes');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(!apiToken); // Show onboarding if no token

  // Auth gate
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #1d4ed8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!user) return <CloudLoginPage />;

  // For cloud mode, we'll fetch from the cloud reader endpoint
  const collectorUrl = process.env.REACT_APP_COLLECTOR_URL || 'https://collector.laneconductor.io';
  const readerUrl = collectorUrl.replace('/functions/v2/collector', '/functions/v2/reader') || 'https://reader.laneconductor.io/api';

  // Create a modified usePolling that uses cloud reader with auth token
  const { projects, tracks, workers, providers, loading, error, lastUpdated, refetch, wsConnected } = usePolling(selectedProjectId, {
    cloudMode: true,
    apiToken,
    readerUrl,
  });

  useEffect(() => {
    function handler(e) {
      if (e.key === 'n' || e.key === 'N') {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        setNewTrackType('feature');
        setNewTrackOpen(true);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const inboxBadgeCount = tracks.reduce((sum, t) => sum + (t.unreplied_count ?? 0), 0);

  function handleTrackClick(track) {
    setActiveTrack(track);
    setInboxOpen(false);
  }

  function handleConfirm() {
    if (!pendingAction) return;
    const { track, targetLane } = pendingAction;
    // The track will be updated by the API call
    setPendingAction(null);
  }

  function confirmTitle() {
    if (!pendingAction) return '';
    return `Move "${pendingAction.track.title}" to ${LANE_LABELS[pendingAction.targetLane]}?`;
  }

  function confirmSubtitle() {
    if (!pendingAction) return '';
    if (pendingAction.targetLane === 'implement') return 'This will trigger auto-implementation.';
    if (pendingAction.targetLane === 'review') return 'Ready for review.';
    return '';
  }

  return (
    <div className="min-h-screen bg-gray-950" style={{ background: '#0d0d0f' }}>
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-white">LaneConductor Cloud</h1>
            <ProjectSelector projects={projects} selectedId={selectedProjectId} onSelect={setSelectedProjectId} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOnboardingOpen(true)}
              title="Show worker setup"
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded font-medium transition-colors"
            >
              Setup Worker
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'lanes' ? 'workers' : 'lanes')}
              className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-medium transition-colors"
            >
              {viewMode === 'lanes' ? 'Workers' : 'Lanes'}
            </button>
            <button
              onClick={() => setInboxOpen(!inboxOpen)}
              className="relative px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-medium transition-colors"
            >
              Inbox {inboxBadgeCount > 0 && <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{inboxBadgeCount}</span>}
            </button>
            <div style={{ color: '#9ca3af', fontSize: '12px' }}>{user.displayName || user.email}</div>
            <button
              onClick={logout}
              className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-medium transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto px-6 py-4">
        {loading && !projects.length ? (
          <div className="text-center py-12">Loading...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : viewMode === 'lanes' ? (
          selectedProject ? (
            <KanbanBoard
              projectId={selectedProjectId}
              tracks={tracks.filter(t => t.project_id === selectedProjectId)}
              onTrackClick={handleTrackClick}
              onLaneChange={(track, targetLane) => setPendingAction({ track, targetLane })}
              onNewTrack={(type) => {
                setNewTrackType(type);
                setNewTrackOpen(true);
              }}
            />
          ) : (
            <div className="text-center py-12 text-gray-400">Select a project to view tracks</div>
          )
        ) : (
          <WorkersList projectId={selectedProjectId} project={selectedProject} workers={workers} />
        )}
      </div>

      {/* Right panels */}
      <ConductorPanel open={conductorOpen} onClose={() => setConductorOpen(false)} projectId={selectedProjectId} />
      <TrackDetailPanel open={!!activeTrack} track={activeTrack} onClose={() => setActiveTrack(null)} projectId={selectedProjectId} />
      {/* Track 008 Phase 5: was rendered unconditionally with a stale prop
          shape (open/type/onSuccess) from before NewTrackModal's
          resume-or-create redesign (Phase 2) — the component has no `open`
          prop of its own, so this permanently overlaid the Cloud board
          regardless of newTrackOpen. Gated + re-wired to match AppContent's
          instance below. */}
      {newTrackOpen && (
        <NewTrackModal
          projectId={selectedProjectId}
          projects={projects}
          tracks={tracks}
          workers={workers}
          initialType={newTrackType}
          onClose={() => setNewTrackOpen(false)}
          onCreated={() => { setNewTrackOpen(false); refetch(); }}
          onResumed={() => { setNewTrackOpen(false); refetch(); }}
        />
      )}
      <InboxPanel open={inboxOpen} onClose={() => setInboxOpen(false)} projectId={selectedProjectId} onTrackClick={handleTrackClick} />

      {/* Cloud onboarding modal */}
      <CloudOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        token={apiToken}
        collectorUrl={process.env.REACT_APP_COLLECTOR_URL || 'https://collector.laneconductor.io'}
      />

      {/* Confirm dialog */}
      {pendingAction && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white text-sm font-semibold mb-1">{confirmTitle()}</p>
            <p className="text-gray-400 text-xs mb-5">{confirmSubtitle()}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingAction(null)}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
