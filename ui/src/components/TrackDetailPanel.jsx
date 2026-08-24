import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { DevServerButton } from './DevServerButton.jsx';
import { TranscriptView } from './TranscriptView.jsx';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { createTranscriptState, reduceStreamEvent } from '../lib/streamTranscript.js';
import { isWorkerOffline, selectDefaultWorker } from '../lib/workerStatus.js';
import { PROVIDER_IDS, PROVIDERS, providerLabel, defaultModelFor } from '../../../conductor/providers.mjs';
import { getDefaultProviderModel } from '../lib/defaultModel.js';
import { modelsForProvider } from '../lib/modelOptions.js';
import { ProvisionWorkerModal } from './ProvisionWorkerModal.jsx';

const CONTENT_TABS = [
  { key: 'index', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
  { key: 'spec', label: 'Spec' },
  { key: 'test', label: 'Tests' },
];

const LANE_BADGE = {
  plan: 'bg-indigo-900 text-indigo-300',
  backlog: 'bg-gray-700 text-gray-300',
  implement: 'bg-blue-900 text-blue-300',
  review: 'bg-amber-900 text-amber-300',
  'quality-gate': 'bg-purple-900 text-purple-300',
  done: 'bg-green-900 text-green-300',
};

// Track 1085: the only actions the API will accept a dispatch for — it
// validates action === track.lane_status, so a track sitting in 'backlog'
// or 'done' has no valid action to dispatch at all.
const DISPATCHABLE_LANES = ['plan', 'implement', 'review', 'quality-gate'];

// One helper line per composer mode, shown BEFORE sending — states exactly
// what will happen. Track 1112 originally shipped plain "Send" as a
// passive post-only action (message posted, lane re-queued, nothing ran on
// a sync-only worker) and documented the caveat here rather than fixing
// it. Superseded — plain Send now dispatches like Brainstorm does, so the
// caveat no longer applies; see handleComposerSend.
const SEND_MODE_HELP = {
  send: 'Posts the message and dispatches a chat turn to the selected worker (reaches it immediately, same mechanism as Brainstorm) — use a "Run" mode instead if you also want to move the lane and act on it.',
  note: 'Posts to the conversation only. No automation, no worker wake-up.',
  'run:plan': 'Posts the message, moves this track to plan, and runs plan now on the selected worker.',
  'run:implement': 'Posts the message, moves this track to implement, and runs implement now on the selected worker.',
  'run:review': 'Posts the message, moves this track to review, and runs review now on the selected worker.',
  'run:quality-gate': 'Posts the message, moves this track to quality-gate, and runs quality-gate now on the selected worker.',
  brainstorm: 'Posts the message and dispatches a Q&A turn to the selected worker (a quick reply, no lane action, no worktree) — reply appears above in the dispatch history.',
  bug: 'Posts a bug report and appends a regression-test block to this track\'s test.md.',
};

const NON_PROVIDER_AUTHOR_STYLES = {
  human: { label: 'You', dot: 'bg-gray-400', body: 'bg-gray-800 text-gray-200' },
  system: { label: 'System', dot: 'bg-gray-500', body: 'bg-gray-800/60 text-gray-300 border border-gray-700/50' },
};

// Presentation-only colors per provider — the label itself comes from the
// shared registry, so Copilot/Antigravity comments get their own style
// instead of silently falling through to the human default.
const PROVIDER_AUTHOR_COLORS = {
  claude: { dot: 'bg-orange-400', body: 'bg-orange-950/40 text-gray-200 border border-orange-900/50' },
  gemini: { dot: 'bg-blue-400', body: 'bg-blue-950/40 text-gray-200 border border-blue-900/50' },
  copilot: { dot: 'bg-emerald-400', body: 'bg-emerald-950/40 text-gray-200 border border-emerald-900/50' },
  antigravity: { dot: 'bg-purple-400', body: 'bg-purple-950/40 text-gray-200 border border-purple-900/50' },
};

function authorStyle(author) {
  if (NON_PROVIDER_AUTHOR_STYLES[author]) return NON_PROVIDER_AUTHOR_STYLES[author];
  const colors = PROVIDER_AUTHOR_COLORS[author];
  if (colors) return { label: providerLabel(author), ...colors };
  return NON_PROVIDER_AUTHOR_STYLES.human;
}

function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function CommentBubble({ comment }) {
  const style = authorStyle(comment.author);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className="font-medium text-gray-400">{style.label}</span>
        <span>{timeAgo(comment.created_at)}</span>
      </div>
      <div className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${style.body}`}>
        {comment.body}
      </div>
    </div>
  );
}

export function TrackDetailPanel({ projectId, trackNumber, initialTab, initialTranscriptOpen = false, onClose }) {
  const { apiFetch } = useApi();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(initialTab ?? 'plan');
  const [comments, setComments] = useState([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const prevConversationTabRef = useRef(false);
  const prevCommentCountRef = useRef(0);
  const logsEndRef = useRef(null);
  const pollRef = useRef(null);
  const detailPollRef = useRef(null);
  const [showNewTrack, setShowNewTrack] = useState(false);
  const initialTabSet = useRef(!!initialTab);
  // Track 1084 Phase 4: assignee control
  const [members, setMembers] = useState([]);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  // Track 10017: auto-run toggle
  const [autoRunSaving, setAutoRunSaving] = useState(false);
  const [mergeModeSaving, setMergeModeSaving] = useState(false);
  // Track 1085 Phase 4: manual dispatch — "Run on worker" control + history
  const [projectWorkers, setProjectWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchHistory, setDispatchHistory] = useState([]);
  const [sendMode, setSendMode] = useState('send');
  const [workersLoaded, setWorkersLoaded] = useState(false);
  // Which track's lane we've already defaulted sendMode for — guards the
  // effect below to fire once per track view instead of on every detail
  // poll (detail refetches every 3s; re-defaulting on each poll would
  // clobber a manual dropdown choice mid-conversation).
  const sendModeDefaultedForTrackRef = useRef(null);
  const [provisioningWorker, setProvisioningWorker] = useState(false);
  // Track 10011: "+ New worker…" used to POST /workers/start-new with no
  // cli/model at all, silently inheriting whatever project.primary already
  // was — no provider choice was ever offered. If a manager is online it
  // can provision on a chosen machine/provider (ProvisionWorkerModal,
  // already used for this from the Workers lane); with no manager, a small
  // inline picker offers the same choice for a local worker #2.
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [showInlinePicker, setShowInlinePicker] = useState(false);
  const [inlineCli, setInlineCli] = useState('claude');
  const [inlineModel, setInlineModel] = useState(defaultModelFor('claude'));
  // Track 1112 Phase 7: this track's own worktree row (if any), secondary/
  // detail-level view of the same data WorktreesPanel lists project-wide.
  const [worktreeRow, setWorktreeRow] = useState(null);
  const [mergingWorktree, setMergingWorktree] = useState(false);
  // Track 1087 Phase 4: live session transcript drawer
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptState, setTranscriptState] = useState(() => createTranscriptState());
  const transcriptEndRef = useRef(null);
  // Auto-expand once per viewing session (first live event after opening
  // this track) — armed again whenever the track changes, but not re-armed
  // after that so a manual collapse (REQ-4: "user can collapse manually at
  // any time") isn't immediately fought by the next tool-call event.
  const autoExpandArmedRef = useRef(true);

  // Fetch track detail
  const fetchDetail = () => {
    apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => { setDetail(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  };

  useEffect(() => {
    setLoading(true);
    fetchDetail();
    // Poll detail every 3s if panel is open
    detailPollRef.current = setInterval(fetchDetail, 3000);
    return () => clearInterval(detailPollRef.current);
  }, [projectId, trackNumber]);

  // Track 1087 Phase 4 Task 4: reconstruct transcript history from the full
  // JSONL log on load, before subscribing to live WS events below.
  useEffect(() => {
    setTranscriptState(createTranscriptState());
    autoExpandArmedRef.current = true;
    // Track 10024: a caller (e.g. the Worktrees panel's running-row link) can
    // ask to land here with the drawer already open. Open-only — never
    // setTranscriptOpen(false) here — so this can't fight a manual collapse
    // (Track 1087 REQ-4: "user can collapse manually at any time") and other
    // entry points that omit the prop keep today's closed default.
    if (initialTranscriptOpen) setTranscriptOpen(true);
    apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/transcript`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(({ events }) => {
        setTranscriptState((events || []).reduce(reduceStreamEvent, createTranscriptState()));
      })
      .catch(() => { });
  }, [projectId, trackNumber, initialTranscriptOpen]);

  // Track 1087 Phase 4 Task 2: live continuation over the same WebSocket
  // the rest of the app already uses (Phase 2's notifyApi -> broadcast
  // relay) — filtered to events for the track currently being viewed.
  const onTranscriptWsMessage = useCallback((msg) => {
    if (msg.event !== 'session:event') return;
    if (String(msg.data?.trackNumber) !== String(trackNumber)) return;
    setTranscriptState(prev => reduceStreamEvent(prev, msg.data.event));
    if (autoExpandArmedRef.current) {
      autoExpandArmedRef.current = false;
      setTranscriptOpen(true);
    }
  }, [trackNumber]);
  useWebSocket(onTranscriptWsMessage);

  // Scroll transcript drawer to bottom as new blocks arrive
  useEffect(() => {
    if (transcriptOpen) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptState, transcriptOpen]);

  // Track 1084 Phase 4: project members for the assignee dropdown. Empty in
  // local-api mode (no auth, no multi-user concept) — the control degrades
  // gracefully to a read-only note in that case, same as worker-pins/
  // worker_permissions already do elsewhere in this app.
  useEffect(() => {
    apiFetch(`/api/projects/${projectId}/members`)
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [projectId]);

  async function setAssignee(uid) {
    setAssigneeSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/assignee`, {
        method: 'PATCH',
        body: JSON.stringify({ assignee_uid: uid || null }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setAssigneeSaving(false);
  }

  // Track 10017: whether a sync+poll worker's auto-launch loop may claim
  // this track from the queue. Default off — see claim-scope.mjs.
  async function setAutoRunFlag(value) {
    setAutoRunSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/auto-run`, {
        method: 'PATCH',
        body: JSON.stringify({ auto_run: value }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setAutoRunSaving(false);
  }

  // Track 10018 (REQ-9): writes through the same track-update path lane
  // changes already use — PATCH .../tracks/:num forwards to the collector's
  // /track/:num/action, which the sync worker's Phase 1 marker sync then
  // reflects back into the track's own **Merge Mode** marker in index.md.
  async function setMergeMode(mode) {
    setMergeModeSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ merge_mode: mode || null }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setMergeModeSaving(false);
  }

  // Track 1115 (REQ-11): same write-through path as setMergeMode above —
  // PATCH .../tracks/:num forwards to /track/:num/action, which the sync
  // worker's marker sync reflects into **Workspace** in index.md. Setting
  // this here is a deliberate, explicit human choice (D2) — it always wins
  // in resolveWorkspaceMode() except the plan lane, which always runs main
  // regardless.
  const [workspaceModeSaving, setWorkspaceModeSaving] = useState(false);
  async function setWorkspaceMode(mode) {
    setWorkspaceModeSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ workspace_mode: mode || null }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setWorkspaceModeSaving(false);
  }

  // Track 1116 REQ-7: per-track model override — beats the lane's
  // primary_model and the project default. Empty = inherit (unchanged).
  const [modelOverrideSaving, setModelOverrideSaving] = useState(false);
  async function setModelOverride(model) {
    setModelOverrideSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/model-override`, {
        method: 'PATCH',
        body: JSON.stringify({ model_override: model || null }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setModelOverrideSaving(false);
  }

  // Track 1085 Phase 4: workers registered to this project, for the "Run on
  // worker" dropdown. Unlike the assignee list, this isn't auth-gated — a
  // worker is visible regardless of who (if anyone) owns it, since in a
  // no-auth (local-api) deployment every worker's user_uid is null anyway.
  //
  // Track 1112 dogfood incident (2026-08-13): this was a ONE-TIME fetch —
  // the server's own query additionally requires
  // `last_heartbeat > NOW() - INTERVAL '60 seconds'` (see
  // GET /api/projects/:id/workers), so whatever snapshot happened to be
  // true at the single moment this fired became permanently frozen for
  // the rest of the panel's mounted lifetime. Observed live: a panel left
  // open while a track's own dispatch ran ended up with its real, active
  // worker missing from the dropdown entirely (not just mis-selected —
  // genuinely absent from the option list), because that one query moment
  // didn't catch it. Polling matches the existing fetchDispatchHistory
  // pattern just above.
  useEffect(() => {
    const fetchWorkers = () => {
      apiFetch(`/api/projects/${projectId}/workers`)
        .then(r => r.ok ? r.json() : [])
        .then(setProjectWorkers)
        .catch(() => setProjectWorkers([]))
        .finally(() => setWorkersLoaded(true));
    };
    fetchWorkers();
    const id = setInterval(fetchWorkers, 4000);
    return () => clearInterval(id);
  }, [projectId]);

  // Default the composer's action selector to "Run <lane>" for whatever
  // lane the track is currently sitting in (plan → Run plan, implement →
  // Run implement, etc.) instead of always landing on plain Message. Only
  // applies once per track view — see sendModeDefaultedForTrackRef above —
  // and only when that lane actually has a dispatchable run: option in the
  // dropdown (DISPATCHABLE_LANES + an online worker to run it on);
  // otherwise falls back to the previous default of "send".
  useEffect(() => {
    // `detail` isn't cleared on track switch, so it can still hold the
    // PREVIOUS track's data for a moment after trackNumber changes — guard
    // against defaulting off stale lane_status before the new track's own
    // fetchDetail() resolves.
    if (!detail?.lane_status || String(detail.track_number) !== String(trackNumber) || !workersLoaded) return;
    if (sendModeDefaultedForTrackRef.current === trackNumber) return;
    sendModeDefaultedForTrackRef.current = trackNumber;
    const lane = detail.lane_status;
    setSendMode(DISPATCHABLE_LANES.includes(lane) && projectWorkers.length > 0 ? `run:${lane}` : 'send');
  }, [trackNumber, detail?.lane_status, detail?.track_number, workersLoaded, projectWorkers.length]);

  const fetchDispatchHistory = () => {
    if (!detail?.id) return;
    apiFetch(`/api/tracks/${detail.id}/dispatch`)
      .then(r => r.ok ? r.json() : [])
      .then(setDispatchHistory)
      .catch(() => setDispatchHistory([]));
  };

  useEffect(() => {
    if (!detail?.id) return;
    fetchDispatchHistory();
    const id = setInterval(fetchDispatchHistory, 4000);
    return () => clearInterval(id);
  }, [detail?.id]);

  // Track 1112 Phase 7: find this track's own row out of the project-wide
  // worktree list — same endpoint WorktreesPanel uses, just filtered down
  // to one track here. Absent (null) is a normal state (no worktree, or
  // fully merged already) — the strip renders nothing in that case.
  const fetchWorktreeRow = () => {
    apiFetch(`/api/projects/${projectId}/worktrees`)
      .then(r => r.ok ? r.json() : [])
      .then(rows => setWorktreeRow((rows || []).find(r => r.track === String(trackNumber)) ?? null))
      .catch(() => setWorktreeRow(null));
  };

  useEffect(() => {
    fetchWorktreeRow();
    const id = setInterval(fetchWorktreeRow, 10000);
    return () => clearInterval(id);
  }, [projectId, trackNumber]);

  async function handleMergeWorktree() {
    setMergingWorktree(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'merge-worktree', payload: { track_number: String(trackNumber) } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchWorktreeRow();
      fetchDispatchHistory();
    } catch (err) {
      alert(`Failed to dispatch merge: ${err.message}`);
    } finally {
      setMergingWorktree(false);
    }
  }

  // Default the worker dropdown to one of the resolved assignee's own
  // workers (workers.user_uid, track 1084) when possible, falling back to
  // the first idle worker, then just the first worker in the list.
  useEffect(() => {
    if (!detail || projectWorkers.length === 0) return;
    // Track 1112 dogfood incident (2026-08-13): don't just pick once and
    // stop — if the currently selected worker has since gone offline (or
    // was wrongly picked before this fix existed, on a panel that's stayed
    // mounted since), re-run the selection instead of leaving a dead
    // choice stuck in the dropdown indefinitely. A still-valid selection
    // (present in the list, online) is left alone — this must not fight a
    // user's own manual pick.
    // A worker actually usable RIGHT NOW for a fresh dispatch — busy
    // still counts as "valid" once already selected (that's normal
    // queueing), but never as the INITIAL default (see below).
    const current = projectWorkers.find(w => String(w.id) === selectedWorkerId);
    if (current && !isWorkerOffline(current)) return;
    if (selectedWorkerId === '__new__') return;
    const assignee = detail.assignee_uid ?? detail.created_by_uid;
    const picked = selectDefaultWorker(projectWorkers, assignee);
    // Track 1112/1084 dogfood incident (2026-08-13): "it should default
    // [to New] if all workers are busy (manager is also not used by
    // default)" — a busy or manager pick is technically "a worker," but
    // defaulting TO it silently queues the user behind other work with no
    // signal that a faster path (start a new one) exists. Only default to
    // an existing worker if it's genuinely ready to go right now.
    const isReadyNow = picked && picked.type !== 'manager' && !isWorkerOffline(picked) && picked.status !== 'busy';
    setSelectedWorkerId(isReadyNow ? String(picked.id) : '__new__');
  }, [detail, projectWorkers]);

  // Track 1112 dogfood incident (2026-08-13), third instance: "Brainstorm"
  // set Waiting for reply=yes and relied on autoLaunchLocalFs to notice —
  // but that whole poll is hard-skipped for sync-only workers
  // (conductor/laneconductor.sync.mjs:5055, `if (syncOnly) return`), so on
  // this project's workers it silently never happened, same as plain
  // Send. track_chat dispatches don't have this problem: they're picked
  // up by checkDispatchInbox, which polls unconditionally regardless of
  // worker mode — already proven live earlier this session (the
  // worktree-merge Q&A). Routing Brainstorm through it instead of the
  // flag-and-hope mechanism.
  async function dispatchTrackChat(prompt) {
    if (!detail?.id || !projectId || !trackNumber) return;
    const workerId = await resolveWorkerId();
    if (!workerId) return;
    await apiFetch(`/api/projects/${projectId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        worker_id: parseInt(workerId),
        action: 'track_chat',
        track_number: trackNumber,
        payload: { prompt, track_number: trackNumber },
      }),
    });
    fetchDispatchHistory();
  }

  // Track 1112/1084 dogfood incident (2026-08-13): "the modal isn't aware
  // [the only worker is busy]" — correct, but the fix isn't just showing
  // busy status, it's giving the user somewhere to go when the one worker
  // IS busy: get another one right from this dropdown, reusing the exact
  // mechanism the Workers tab's "Start Sync Worker" button already uses
  // (POST .../worker/start → `lc start`), just auto-numbered so it adds a
  // worker instead of hitting the "already running" guard on #1.
  // Returns the new worker's id (string) once it's registered and online,
  // or null if provisioning failed/timed out — callers that need to
  // dispatch immediately after (Run now / Send & Run / Brainstorm, all
  // triggered by picking "+ New worker…") await this instead of relying
  // on the state update landing before their own next line runs.
  async function handleStartNewWorker(cli, model) {
    if (!projectId) return null;
    setProvisioningWorker(true);
    setShowInlinePicker(false);
    const knownIds = new Set(projectWorkers.map(w => w.id));
    try {
      const r = await apiFetch(`/api/projects/${projectId}/workers/start-new`, {
        method: 'POST',
        body: JSON.stringify(cli ? { cli, model } : {}),
      });
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({}));
        alert(`Failed to start a new worker: ${error || r.statusText}`);
        return null;
      }
      // The new worker registers async (its own process boot + heartbeat
      // POST) — poll briefly for it to show up rather than guessing a delay.
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(res => setTimeout(res, 1500));
        const wr = await apiFetch(`/api/projects/${projectId}/workers`);
        if (!wr.ok) continue;
        const workers = await wr.json();
        const fresh = workers.find(w => !knownIds.has(w.id) && w.type !== 'manager');
        if (fresh) {
          setProjectWorkers(workers);
          setSelectedWorkerId(String(fresh.id));
          return String(fresh.id);
        }
      }
      alert('New worker was started but hasn\'t registered yet — it should appear shortly; refresh if not.');
      return null;
    } catch (err) {
      alert(`Failed to start a new worker: ${err.message}`);
      return null;
    } finally {
      setProvisioningWorker(false);
    }
  }

  // A manager can provision a worker (on any of its machines, any
  // provider) via ProvisionWorkerModal — the same mechanism the Workers
  // lane already uses. With no manager online, the only option is a local
  // worker #2 on this machine, chosen via the inline picker below.
  const availableManagers = projectWorkers.filter(w => w.type === 'manager' && !isWorkerOffline(w));

  // Resolves the "+ New worker…" sentinel to a real worker id before any
  // dispatch. Provisioning a new worker now always requires the user to
  // pick a provider first (track 10011) — this can't happen synchronously
  // inside a single click, so it opens the modal/picker and returns null,
  // asking the caller to try again once a real worker exists.
  async function resolveWorkerId() {
    if (selectedWorkerId === '__new__') {
      if (availableManagers.length > 0) {
        setShowProvisionModal(true);
      } else {
        setShowInlinePicker(true);
      }
      return null;
    }
    return selectedWorkerId || null;
  }

  async function dispatchRunNow(action) {
    if (!detail?.id) return;
    const workerId = await resolveWorkerId();
    if (!workerId) return;
    setDispatching(true);
    try {
      const r = await apiFetch(`/api/tracks/${detail.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ worker_id: parseInt(workerId), action }),
      });
      if (r.ok) fetchDispatchHistory();
      else {
        const { error } = await r.json().catch(() => ({}));
        alert(`Dispatch failed: ${error || r.statusText}`);
      }
    } catch (err) {
      alert(`Dispatch failed: ${err.message}`);
    }
    setDispatching(false);
  }

  // Poll comments every 2s; auto-switch to Conversation on first load if comments exist
  useEffect(() => {
    async function fetchComments() {
      try {
        const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`);
        if (!r.ok) return;
        const data = await r.json();
        setComments(data);
        if (!initialTabSet.current && data.length > 0) {
          setTab('conversation');
          initialTabSet.current = true;
        }
      } catch { }
    }
    fetchComments();
    pollRef.current = setInterval(fetchComments, 2000);
    return () => clearInterval(pollRef.current);
  }, [projectId, trackNumber]);

  // Track 1094: auto-scroll to bottom on first opening the Conversation tab
  // (a sensible "jump to latest" default) and when a genuinely new comment
  // arrives while the user is already near the bottom — but never on a
  // plain 2s poll tick with no new content, and never while the user has
  // deliberately scrolled up to read history. Comments polls every 2s via
  // fetchComments() above, and setComments(data) always produces a fresh
  // array reference even when nothing changed, so gating on comments.length
  // (rather than the array reference alone) is what actually stops this
  // effect from re-firing — and therefore re-yanking the scroll position —
  // on every single poll tick.
  useEffect(() => {
    if (tab !== 'conversation') {
      prevConversationTabRef.current = false;
      return;
    }

    const justOpened = !prevConversationTabRef.current;
    const grew = comments.length > prevCommentCountRef.current;
    prevConversationTabRef.current = true;
    prevCommentCountRef.current = comments.length;

    if (!justOpened && !grew) return; // no new content — leave the user's scroll position alone

    const el = conversationScrollRef.current;
    const nearBottom = justOpened || !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: justOpened ? 'auto' : 'smooth' });
    }
  }, [comments, tab]);

  useEffect(() => {
    if (tab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [detail?.last_log_tail, tab]);

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function openBug() {
    const description = draft.trim() || undefined;
    setSending(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/open-bug`, {
        method: 'POST',
        body: JSON.stringify({ description }),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.comment) setComments(prev => [...prev, data.comment]);
        setDraft('');
        fetchDetail();
      }
    } catch { }
    setSending(false);
  }

  async function sendComment(textOverride, newLaneStatus, noWake = false, command = undefined, dispatchAfter = false) {
    const isEvent = typeof textOverride === 'object' && textOverride !== null;
    const isMissing = textOverride === undefined;
    const bodyStr = isEvent || isMissing ? draft : textOverride;
    const body = bodyStr.trim();

    if (!body && !command && !newLaneStatus && sending) return;
    setSending(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ author: 'human', body: body || `Triggering ${command}...`, no_wake: noWake, command }),
      });
      if (r.ok) {
        const comment = await r.json();
        setComments(prev => [...prev, comment]);
        if (isEvent || isMissing || textOverride === bodyStr) {
          setDraft('');
        }
      }

      if (typeof newLaneStatus === 'string') {
        const pr = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`, {
          method: 'PATCH',
          body: JSON.stringify({ lane_status: newLaneStatus }),
        });
        if (pr.ok) {
          fetchDetail();
          // Track 1112 dogfood incident (2026-08-13): posting "lets do
          // phase 7" to a track sitting in review re-queued the REVIEW
          // lane (the wake logic re-queues whatever lane is current) on a
          // sync-only worker that never polls — so nothing visibly
          // happened at all. Send & Run closes that whole gap in one
          // action: comment → lane move → explicit dispatch. The dispatch
          // must come AFTER the lane PATCH commits, because
          // POST /api/tracks/:id/dispatch rejects any action that doesn't
          // match the track's current lane.
          if (dispatchAfter && detail?.id && selectedWorkerId) {
            await dispatchRunNow(newLaneStatus);
          }
        }
      }
    } catch { }
    setSending(false);
  }

  const needsOnlineWorker = sendMode.startsWith('run:') || sendMode === 'brainstorm' || sendMode === 'send';
  // '__new__' isn't a real worker to check offline-ness against — it means
  // "provision one on click," which resolveWorkerId() handles. Only an
  // actually-selected-but-offline worker should disable the button.
  const selectedWorkerUnusable = selectedWorkerId && selectedWorkerId !== '__new__'
    && isWorkerOffline(projectWorkers.find(w => String(w.id) === selectedWorkerId));

  function handleComposerSend() {
    if (sendMode === 'note') return sendComment(undefined, undefined, true);
    // Plain "Message" used to just post-and-hope: sendComment()'s own
    // "wake" path is a flag-and-poll mechanism that autoLaunchLocalFs
    // skips entirely for sync-only workers (same root cause Brainstorm hit
    // — see dispatchTrackChat's comment above), so a message could sit
    // fully queued with no visible sign anything was wrong. Routing it
    // through the same worker-dropdown + track_chat dispatch Brainstorm
    // already uses — including "+ New worker…" provisioning one on demand
    // — makes plain messages reach a worker exactly as reliably as Run/
    // Brainstorm do, instead of being the one mode that silently didn't.
    if (sendMode === 'send' || sendMode === 'brainstorm') {
      const text = draft.trim();
      if (!text) return;
      sendComment(undefined, undefined, true); // persist the human turn; no_wake — the dispatch below is the real wake
      return dispatchTrackChat(text);
    }
    if (sendMode === 'bug') return openBug();
    // Track 1113 Phase 2 (TC-5): command is the target lane, not left
    // undefined — an empty-draft Run submission (the case the removed
    // header button used to cover: "just re-run this stage, nothing to
    // say") falls back to `Triggering ${command}...` in sendComment's body
    // construction, and `Triggering undefined...` would be a visibly wrong
    // regression from that button's behavior.
    if (sendMode.startsWith('run:')) return sendComment(undefined, sendMode.slice(4), true, sendMode.slice(4), true);
    return sendComment();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleComposerSend();
  }

  const allTabs = [
    ...CONTENT_TABS,
    { key: 'conversation', label: `Conversation${comments.length ? ` (${comments.length})` : ''}` },
    { key: 'logs', label: 'Logs' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Panel (+ Track 1087 Phase 4: collapsible transcript drawer, docked to its left) */}
      <div className="fixed top-0 right-0 h-full z-50 flex flex-row shadow-2xl">
        {transcriptOpen && (
          <div className="h-full w-96 bg-gray-950 border-l border-gray-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Live Transcript</span>
              <button
                onClick={() => setTranscriptOpen(false)}
                title="Collapse transcript"
                className="text-gray-500 hover:text-gray-200 text-sm leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <TranscriptView blocks={transcriptState.blocks} />
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}
        <div className="h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-800">
          <div>
            {detail ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-500">#{detail.track_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANE_BADGE[detail.lane_status] ?? LANE_BADGE.backlog}`}>
                    {detail.lane_status}
                  </span>
                  <span className="text-xs text-gray-500">{detail.progress_percent ?? 0}%</span>
                </div>
                <h2 className="text-base font-semibold text-white">{detail.title}</h2>
                {detail.current_phase && (
                  <p className="text-xs text-gray-500 mt-0.5">{detail.current_phase}</p>
                )}
                {/* Track 1084: Assignee control */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600">Assignee:</span>
                  {members.length > 0 ? (
                    <select
                      value={detail.assignee_uid ?? ''}
                      disabled={assigneeSaving}
                      onChange={e => setAssignee(e.target.value)}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      <option value="">
                        {detail.created_by_uid ? `(default) ${detail.created_by_uid}` : '(unassigned)'}
                      </option>
                      {members.map(m => (
                        <option key={m.user_uid} value={m.user_uid}>{m.user_uid}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500" title="Assignment is a multi-user (remote-api) feature — no project members to choose from here">
                      {detail.assignee_uid ?? detail.created_by_uid ?? 'unassigned'}
                    </span>
                  )}
                </div>
                {/* Track 10017: Auto Run control */}
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer" title="Whether a sync+poll worker's auto-launch loop may pick this track up from the queue on its own. Manual runs (Run on worker, lc worker run) are unaffected.">
                    <input
                      type="checkbox"
                      checked={!!detail.auto_run}
                      disabled={autoRunSaving}
                      onChange={e => setAutoRunFlag(e.target.checked)}
                      className="disabled:opacity-50"
                    />
                    Auto-run: {detail.auto_run ? 'on' : 'off'}
                  </label>
                </div>
                {/* Track 10018 (REQ-9): merge-mode toggle — unspecified/null
                    shows as "pr" (resolveMergeMode's default), matching what
                    the Worktrees panel's badge would show for this track. */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600">Merge mode:</span>
                  <select
                    value={detail.merge_mode ?? 'pr'}
                    disabled={mergeModeSaving}
                    onChange={e => setMergeMode(e.target.value)}
                    className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    title="pr: opens a GitHub PR on done, pauses for approval. direct: auto-merges on done (today's behavior)."
                  >
                    <option value="pr">PR (review required)</option>
                    <option value="direct">Direct (auto-merge)</option>
                  </select>
                </div>
                {/* Track 1115 (REQ-11): workspace-mode toggle — unspecified/null
                    falls through to the type-derived or project default
                    (resolveWorkspaceMode()'s D5 rows 4/5/6), shown here as
                    "branch" since that's the eventual fallback; the plan lane
                    always runs main regardless of this setting. */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600">Workspace:</span>
                  <select
                    value={detail.workspace_mode ?? 'branch'}
                    disabled={workspaceModeSaving}
                    onChange={e => setWorkspaceMode(e.target.value)}
                    className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    title="main: lane actions run directly in the primary checkout, no worktree/branch. branch: today's default (lock, worktree, track branch, merge at done). The plan lane always runs main regardless."
                  >
                    <option value="branch">Branch (isolated worktree)</option>
                    <option value="main">Main (direct, no worktree)</option>
                  </select>
                </div>
                {/* Track 1116 REQ-7: per-track model override — beats the
                    lane's primary_model and the project default. Provider
                    isn't selectable here — it stays fixed project-wide
                    (REQ-3/REQ-7's session-continuity rule) — this only picks
                    which model to use within that fixed provider. */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600" title="Beats this track's lane model and the project default. Applies in worker mode only (local-fs/local-api/remote-api) — best-effort, an unavailable model fails that run.">Model override:</span>
                  <select
                    value={detail.model_override ?? ''}
                    disabled={modelOverrideSaving}
                    onChange={e => setModelOverride(e.target.value)}
                    className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                  >
                    <option value="">(inherit lane/project default)</option>
                    {modelsForProvider(getDefaultProviderModel(null, projectWorkers).cli, projectWorkers).map(m => (
                      <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
                    ))}
                  </select>
                </div>
                {/* Track 1085 Phase 4: manual dispatch — "Run on worker" */}
                {DISPATCHABLE_LANES.includes(detail.lane_status) && projectWorkers.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Run on worker:</span>
                    <select
                      value={selectedWorkerId}
                      disabled={dispatching || provisioningWorker}
                      onChange={e => {
                        const val = e.target.value;
                        setSelectedWorkerId(val);
                        if (val === '__new__') {
                          if (availableManagers.length > 0) setShowProvisionModal(true);
                          else setShowInlinePicker(true);
                        }
                      }}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      {projectWorkers.map(w => (
                        <option key={w.id} value={w.id}>
                          {/* Track 1112 dogfood incident (2026-08-13): the
                              manager and this project's own worker can
                              share a hostname and worker_number, making
                              them render as literally identical text —
                              "is it the real worker?" was unanswerable
                              from this dropdown alone. PID disambiguates
                              (always unique) and the MANAGER tag explains
                              *why* two entries look alike instead of
                              leaving it a mystery. Busy is now shown too —
                              "the modal isn't aware [it's busy]" (same
                              session): a track_chat sat silently queued
                              behind another dispatch with no visible
                              reason until it finally ran. */}
                          {w.hostname}#{w.worker_number ?? 1}{w.type === 'manager' ? ' · MANAGER' : ''} (PID {w.pid}){isWorkerOffline(w) ? ' — offline' : w.status === 'busy' ? ' — busy' : ''}
                        </option>
                      ))}
                      <option value="__new__">+ New worker…</option>
                    </select>
                    {/* Track 1113 Phase 2 (TC-5): the standalone "Run <lane>
                        now" button that used to live here is gone — folded
                        into the composer's Send & Run control below, which
                        now accepts an empty draft for a `run:<lane>`
                        submission (see the Send button's disabled condition
                        and handleComposerSend's run: branch). This select
                        still feeds `selectedWorkerId`, which both Send & Run
                        and dispatchTrackChat (Brainstorm/plain Send) read via
                        resolveWorkerId() — it stays. */}
                  </div>
                )}
                {showInlinePicker && (
                  <div className="mt-2 flex items-center gap-2 bg-gray-950/60 border border-gray-800 rounded-lg px-2 py-1.5" data-testid="new-worker-inline-picker">
                    <span className="text-xs text-gray-600">New worker:</span>
                    <select
                      value={inlineCli}
                      disabled={provisioningWorker}
                      onChange={e => {
                        const id = e.target.value;
                        setInlineCli(id);
                        setInlineModel(defaultModelFor(id) || '');
                      }}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      {PROVIDER_IDS.map(id => <option key={id} value={id}>{providerLabel(id)}</option>)}
                    </select>
                    <select
                      value={inlineModel}
                      disabled={provisioningWorker}
                      onChange={e => setInlineModel(e.target.value)}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      {(PROVIDERS[inlineCli]?.models || []).map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleStartNewWorker(inlineCli, inlineModel)}
                      disabled={provisioningWorker}
                      className="text-xs px-2 py-0.5 rounded border border-blue-800/70 text-blue-400 hover:bg-blue-900/30 disabled:opacity-40"
                    >
                      {provisioningWorker ? 'Starting…' : 'Start Worker'}
                    </button>
                    <button
                      onClick={() => setShowInlinePicker(false)}
                      disabled={provisioningWorker}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {showProvisionModal && (
                  <ProvisionWorkerModal
                    projectId={projectId}
                    workers={projectWorkers}
                    onClose={() => setShowProvisionModal(false)}
                    onProvisioned={() => {
                      setShowProvisionModal(false);
                      apiFetch(`/api/projects/${projectId}/workers`)
                        .then(r => r.ok ? r.json() : null)
                        .then(w => w && setProjectWorkers(w))
                        .catch(() => {});
                    }}
                  />
                )}
                {dispatchHistory.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {dispatchHistory.slice(0, 3).map(d => (
                      <div key={d.id} className="text-[10px] text-gray-500 flex items-center gap-1.5">
                        <span className={
                          d.status === 'done' ? 'text-green-500' :
                            d.status === 'failed' ? 'text-red-500' :
                              d.status === 'claimed' ? 'text-blue-400' : 'text-yellow-500'
                        }>
                          {d.status === 'done' ? '✓' : d.status === 'failed' ? '✗' : '•'}
                        </span>
                        <span>{d.action}</span>
                        <span className="text-gray-600">{new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {d.result && <span className="text-gray-600 truncate" title={d.result}>— {d.result}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Dev Server Status */}
                {(detail.lane_status === 'review' || detail.lane_status === 'implement') && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Dev Server:</span>
                    <DevServerButton projectId={projectId} devUrl={detail.dev_url} />
                  </div>
                )}
                {/* Track 1112 Phase 7: inline worktree strip — secondary,
                    detail-level view of the same data WorktreesPanel lists
                    project-wide. Nothing renders when this track has no
                    worktree row (no worktree, or already fully merged). */}
                {worktreeRow && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2 flex-wrap" data-testid="track-worktree-strip">
                    <span className="text-xs text-gray-600">Worktree:</span>
                    <span className="text-[10px] font-mono text-gray-400">
                      ahead {worktreeRow.ahead ?? '—'} / behind {worktreeRow.behind ?? '—'} / dirty {worktreeRow.dirty ?? '—'}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${worktreeRow.class === 'stranded' ? 'bg-red-950/40 text-red-300 border-red-800/80' :
                      worktreeRow.class === 'conflicted' ? 'bg-amber-950/40 text-amber-300 border-amber-800/80' :
                        worktreeRow.class === 'mergeable' ? 'bg-green-950/40 text-green-300 border-green-800/80' :
                          'bg-gray-900 text-gray-400 border-gray-800'
                      }`}>
                      {worktreeRow.class}
                    </span>
                    {(worktreeRow.class === 'mergeable' || worktreeRow.class === 'stranded') && (
                      <button
                        onClick={handleMergeWorktree}
                        disabled={mergingWorktree}
                        data-testid="track-merge-to-main-btn"
                        className="text-[10px] px-2 py-0.5 border border-green-800/60 bg-green-950/30 text-green-300 hover:bg-green-900/40 disabled:opacity-50 rounded font-bold uppercase tracking-wider transition-colors"
                      >
                        {mergingWorktree ? 'Merging…' : 'Merge to main'}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-400 text-sm">Track #{trackNumber}</div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Track 1087 Phase 4: live session transcript toggle */}
            <button
              onClick={() => setTranscriptOpen(o => !o)}
              title={transcriptOpen ? 'Hide live session transcript' : 'Show live session transcript'}
              className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${transcriptOpen
                  ? 'border-orange-800/70 bg-orange-950/40 text-orange-300'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
            >
              Transcript
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-xl leading-none mt-0.5 shrink-0"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 overflow-x-auto">
          {allTabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); initialTabSet.current = true; }}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'conversation' ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Comment list */}
            <div ref={conversationScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {comments.length === 0 ? (
                <p className="text-gray-600 text-sm italic text-center pt-8">
                  No messages yet. Start the conversation below.
                </p>
              ) : (
                comments.map(c => <CommentBubble key={c.id} comment={c} />)
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-800 px-5 py-3 flex flex-col gap-3 bg-gray-900/40">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (⌘↵ to send)"
                rows={2}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500 shadow-inner"
              />
              {/* Track 1112/1113 dogfood consolidation (2026-08-13): the
                  composer had 7 separate controls (Bug, Brainstorm, Replan,
                  + New Track, Post Note, Send & Run, Send) and the user
                  couldn't tell what any of them would actually do — "all
                  these buttons are confusing." Replaced with ONE action
                  selector + ONE Send button + a helper line that states
                  exactly what will happen before it happens. Replan is
                  gone entirely (it was Send & Run → plan minus the
                  dispatch, i.e. strictly worse); Bug/Brainstorm keep their
                  real side effects as selectable modes; + New Track stays
                  as a small side control since it opens a modal rather
                  than sending anything. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <select
                    value={sendMode}
                    onChange={e => setSendMode(e.target.value)}
                    disabled={sending || dispatching}
                    className="text-[11px] bg-gray-950 border border-gray-700 rounded-lg px-2 py-2 text-gray-300 disabled:opacity-40"
                  >
                    <option value="send">💬 Message</option>
                    <option value="note">📝 Note (no automation)</option>
                    {projectWorkers.length > 0 && DISPATCHABLE_LANES.map(l => (
                      <option key={l} value={`run:${l}`}>▶ Run {l}</option>
                    ))}
                    <option value="brainstorm">💭 Brainstorm (Q&A)</option>
                    <option value="bug">🐛 Bug report</option>
                  </select>
                  <button
                    onClick={() => setShowNewTrack(true)}
                    title="Open a new related track using draft text"
                    className="px-2 py-2 rounded-lg border border-gray-700 text-gray-400 text-[11px] font-medium hover:bg-gray-800 hover:text-gray-200 transition-colors"
                  >
                    + New Track
                  </button>
                  <button
                    onClick={handleComposerSend}
                    // Track 1113 Phase 2 (TC-5): a `run:<lane>` submission no
                    // longer requires draft text — this is what lets the
                    // composer cover the removed header button's case
                    // ("just re-run this stage, nothing to say"). Every
                    // other mode still requires a non-empty message.
                    disabled={(!sendMode.startsWith('run:') && !draft.trim()) || sending || dispatching || provisioningWorker || (needsOnlineWorker && (!selectedWorkerId || selectedWorkerUnusable))}
                    title={SEND_MODE_HELP[sendMode]}
                    className={`ml-auto px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-medium shadow-lg transition-all flex items-center gap-1.5 ${sendMode.startsWith('run:')
                      ? 'bg-emerald-700 hover:bg-emerald-600 shadow-emerald-900/20'
                      : 'bg-blue-700 hover:bg-blue-600 shadow-blue-900/20'
                      }`}
                  >
                    <span>{sendMode.startsWith('run:') ? `Send & Run ${sendMode.slice(4)}` : 'Send'}</span>
                    <span className="text-[10px] opacity-60">⌘↵</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {SEND_MODE_HELP[sendMode]}
                </p>
              </div>
            </div>
          </div>
        ) : tab === 'logs' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-900/50">
            {/* Track 1102 F14, corrected live (2026-08-13, track 1112's own
                dispatch): last_log_tail is only written by spawnCli's exit
                handler for claude runs (the live 5s tail interval at
                conductor/laneconductor.sync.mjs:3523 is disabled for
                cli === 'claude') — so during an ACTIVE claude run, any
                last_log_tail present is a leftover from the PREVIOUS
                completed run, not this one. The banner below flags that
                live case, but does NOT hide the old content underneath —
                a first version of this fix replaced the log entirely with
                the hint, which silently made a real previous-run log
                unreachable while a new run was in progress. Non-claude
                CLIs are untouched — their last_log_tail IS live (same
                interval, still enabled), so no banner is needed there. */}
            {detail?.lane_action_status === 'running' && detail?.active_cli === 'claude' && (
              <p className="text-blue-400 text-xs italic mb-3 pb-3 border-b border-gray-800">
                A run is in progress right now — its live output is on the Transcript tab, not here.
                {detail?.last_log_tail && ' The log below is from the previous run.'}
              </p>
            )}
            {detail?.last_log_tail ? (
              <>
                <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {typeof detail.last_log_tail === 'string' ? detail.last_log_tail : JSON.stringify(detail.last_log_tail, null, 2)}
                </pre>
                <div ref={logsEndRef} />
              </>
            ) : !(detail?.lane_action_status === 'running' && detail?.active_cli === 'claude') && (
              // Track 1102 F14: for cli === 'claude' runs, spawnCli
              // deliberately skips the raw-text tail interval in favor of
              // the structured stream-json feed the Transcript tab reads —
              // last_log_tail is never populated for them, so this tab is
              // correctly empty by design, not broken. Said so honestly
              // instead of leaving an unexplained empty state that reads
              // the same as "nothing ran yet."
              <p className="text-gray-600 text-sm italic pt-4">
                {detail?.active_cli === 'claude'
                  ? 'This run\'s live output is on the Transcript tab — Claude runs stream structured events there instead of a raw log tail.'
                  : 'No logs available yet for this track.'}
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="text-gray-500 text-sm">Loading…</div>
            ) : error ? (
              <div className="text-red-400 text-sm">Error: {error}</div>
            ) : tab === 'test' && !detail?.test ? (
              <p className="text-gray-600 text-sm italic pt-4">Tests not yet defined — run <code className="font-mono text-gray-500">/laneconductor plan {trackNumber}</code> to scaffold test.md.</p>
            ) : (
              <MarkdownRenderer content={detail?.[tab]} />
            )}
          </div>
        )}
        </div>
      </div>

      {showNewTrack && (
        <NewTrackModal
          projectId={projectId}
          projects={[]} // Passed from parent usually, but we might need to handle this
          tracks={[]} // Ideally we have all tracks for matching
          initialDescription={draft}
          onClose={() => setShowNewTrack(false)}
          onCreated={() => {
            setShowNewTrack(false);
            setDraft('');
          }}
        />
      )}
    </>
  );
}
