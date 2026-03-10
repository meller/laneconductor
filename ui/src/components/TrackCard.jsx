import React, { useState, useEffect } from 'react';
import { DevServerButton } from './DevServerButton.jsx';

const LANE_STYLES = {
  plan: { card: 'border-indigo-700 bg-gray-900', bar: 'bg-indigo-500', badge: 'bg-indigo-900 text-indigo-300' },
  backlog: { card: 'border-gray-700 bg-gray-900', bar: 'bg-gray-500', badge: 'bg-gray-700 text-gray-300' },
  implement: { card: 'border-blue-700 bg-gray-900', bar: 'bg-blue-500', badge: 'bg-blue-900 text-blue-300' },
  review: { card: 'border-amber-600 bg-gray-900', bar: 'bg-amber-500', badge: 'bg-amber-900 text-amber-300' },
  'quality-gate': { card: 'border-purple-600 bg-gray-900', bar: 'bg-purple-500', badge: 'bg-purple-900 text-purple-300' },
  done: { card: 'border-green-700 bg-gray-900', bar: 'bg-green-500', badge: 'bg-green-900 text-green-300' },
};

const NEXT_LANE = {
  plan: 'implement',
  backlog: 'implement',
  implement: 'review',
  review: 'done',
};

const NEXT_LANE_LABEL = {
  implement: 'Start',
  review: 'Review lane',
  'quality-gate': 'Quality Gate',
  done: 'Done',
};

// ── Phase stepper ─────────────────────────────────────────────────────────────

const STEPS = ['plan', 'coding', 'reviewing', 'complete'];
const STEP_LABELS = { plan: 'Plan', coding: 'Coding', reviewing: 'Reviewing', complete: 'Complete' };

function PhaseStepIndicator({ phaseStep }) {
  if (!phaseStep) return null;
  const currentIdx = STEPS.indexOf(phaseStep);

  return (
    <div className="flex items-center gap-0.5 py-0.5" title={`Phase step: ${STEP_LABELS[phaseStep]}`}>
      {STEPS.map((step, idx) => {
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <React.Fragment key={step}>
            <div
              title={STEP_LABELS[step]}
              className={`w-2 h-2 rounded-full transition-all flex-shrink-0 ${isPast ? 'bg-green-500' :
                isCurrent ? 'bg-blue-400 ring-2 ring-blue-400/30 animate-pulse' :
                  'bg-gray-700'
                }`}
            />
            {idx < STEPS.length - 1 && (
              <div className={`h-px flex-1 min-w-2 ${isPast ? 'bg-green-700' : 'bg-gray-700'}`} />
            )}
          </React.Fragment>
        );
      })}
      <span className="ml-1.5 text-xs text-gray-500">{STEP_LABELS[phaseStep]}</span>
    </div>
  );
}

// ── Heartbeat dot ─────────────────────────────────────────────────────────────

function useSecondsAgo(timestamp) {
  const [seconds, setSeconds] = useState(null);
  useEffect(() => {
    if (!timestamp) return;
    const update = () => setSeconds(Math.floor((Date.now() - new Date(timestamp)) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  return seconds;
}

function HeartbeatDot({ laneStatus, laneActionStatus, lastHeartbeat }) {
  const seconds = useSecondsAgo(lastHeartbeat);
  // Only show heartbeat if an action is currently running
  if (laneActionStatus !== 'running' || seconds === null) return null;

  const color = seconds < 15 ? 'bg-green-400' : seconds < 45 ? 'bg-yellow-400' : 'bg-red-500';
  const label = seconds < 15 ? 'Worker active' : seconds < 60 ? `stale ${seconds}s` : `stale ${Math.floor(seconds / 60)}m`;
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400" title={`Last heartbeat: ${seconds}s ago`}>
      <span className={`inline-block w-2 h-2 rounded-full animate-pulse ${color}`} />
      {label}
    </span>
  );
}

// ── Lane Action Status badge ──────────────────────────────────────────────────

const LANE_ACTION_STATUSES = {
  queue: { emoji: '⏳', label: 'Queued', color: 'bg-yellow-900/30 border border-yellow-800/50 text-yellow-400' },
  running: { emoji: '🔄', label: 'Running', color: 'bg-blue-900/30 border border-blue-800/50 text-blue-400 animate-pulse' },
  success: { emoji: '✅', label: 'Done', color: 'bg-green-900/30 border border-green-800/50 text-green-400' },
  failure: { emoji: '❌', label: 'Failed', color: 'bg-red-900/30 border border-red-800/50 text-red-400' },
};

// ── Agent badge ───────────────────────────────────────────────────────────────

const AGENT_LABELS = {
  claude: { label: 'Claude', color: 'bg-orange-900 text-orange-300' },
  gemini: { label: 'Gemini', color: 'bg-blue-900 text-blue-300' },
  other: { label: 'AI', color: 'bg-gray-800 text-gray-400' },
};

function AgentBadge({ agent }) {
  const style = AGENT_LABELS[agent] ?? AGENT_LABELS.other;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${style.color}`}>
      {style.label}
    </span>
  );
}

// ── TrackCard ─────────────────────────────────────────────────────────────────

export function TrackCard({ track, onClick, onLaneChange, onFixReview, onRerunImplement, onDeleteTrack }) {
  const styles = LANE_STYLES[track.lane_status] ?? LANE_STYLES.backlog;

  let nextLane = NEXT_LANE[track.lane_status];
  // Logic for Quality Gate detour
  if (track.lane_status === 'review' && track.create_quality_gate) {
    nextLane = 'quality-gate';
  } else if (track.lane_status === 'quality-gate') {
    nextLane = 'done';
  }

  const [launching, setLaunching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function startDrag(e) {
    e.dataTransfer.setData('trackNum', track.track_number);
    e.dataTransfer.setData('projectId', String(track.project_id ?? ''));
    e.dataTransfer.effectAllowed = 'move';
  }

  const showNextBtn = nextLane && track.lane_status !== 'done';
  const nextBtnDisabled = track.lane_status === 'plan' && track.lane_action_status !== 'success';

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 cursor-pointer hover:brightness-125 transition-all ${styles.card}`}
      draggable
      onDragStart={startDrag}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-gray-500">#{track.track_number}</span>
            {track.project_name && (
              <span className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight">
                {track.project_name}
              </span>
            )}
            {(track.human_needs_reply || track.unreplied_count > 0) && (
              <span
                className={`flex items-center gap-0.5 text-[10px] px-1 rounded ${track.human_needs_reply ? 'bg-amber-900/40 text-amber-400 border border-amber-800/40' : 'bg-blue-900/40 text-blue-400 border border-blue-800/40'
                  }`}
                title={track.human_needs_reply ? 'Human waiting for AI reply' : `${track.unreplied_count} unreplied AI message(s)`}
              >
                💬 {track.human_needs_reply ? 'Waiting' : track.unreplied_count}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-100 leading-snug mt-0.5">
            {track.title}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles.badge}`}>
            {track.lane_status}
          </span>
          {track.retry_count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-950/40 text-red-500 border border-red-900/40 rounded leading-none" title="Automated retries since last human message">
              {track.retry_count} {track.retry_count === 1 ? 'retry' : 'retries'}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{track.current_phase ?? 'No active phase'}</span>
          <span>{track.progress_percent ?? 0}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${styles.bar}`}
            style={{ width: `${track.progress_percent ?? 0}%` }}
          />
        </div>
      </div>

      {/* Failure/Failed state */}
      {track.lane_action_status === 'failure' && (
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-red-900/30 border border-red-800/50">
          <span className="text-red-500 text-xs">❌</span>
          <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">
            {track.lane_action_result === 'timeout' ? 'Timeout' : track.lane_action_result === 'max_retries_reached' ? 'Retries Exhausted' : 'Failed'}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onRerunImplement?.(track); }}
            className="ml-auto text-[10px] text-red-300 hover:text-red-100 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Phase stepper — only when there's an active phase */}
      {track.current_phase && (
        <PhaseStepIndicator phaseStep={track.phase_step} />
      )}

      {/* Implementation summary — last Claude comment, falls back to content_summary */}
      {(track.last_comment_body || track.content_summary) && (
        <div className="rounded bg-gray-800/60 px-2 py-1.5 space-y-0.5">
          {track.last_comment_body ? (
            <>
              <p className="text-xs text-gray-500 font-medium">
                {track.last_comment_author === 'claude' ? 'Claude' : 'Update'} · open for full conversation
              </p>
              <p className="text-xs text-gray-300 line-clamp-3">{track.last_comment_body}</p>
            </>
          ) : (
            <p className="text-xs text-gray-400 line-clamp-3">{track.content_summary}</p>
          )}
        </div>
      )}

      {/* Running state indicator */}
      {track.lane_action_status === 'running' && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-blue-900/30 border border-blue-800/50 animate-pulse">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[10px] uppercase font-bold text-blue-300 tracking-wider">
            Worker Active: {track.active_cli || 'processing...'}
          </span>
          <span className="ml-auto text-[10px] text-blue-400 italic">Running...</span>
        </div>
      )}

      {/* Queued state indicator (worker waiting to process) */}
      {track.lane_action_status === 'queue' && track.lane_status !== 'done' && (
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-yellow-900/20 border border-yellow-800/30">
          <span className="text-yellow-600 text-xs">⏳</span>
          <span className="text-[10px] text-yellow-400">Queued for automation</span>
        </div>
      )}

      {/* Auto-started badge (only if not already running or in terminal state) */}
      {track.lane_status === 'implement' && track.auto_implement_launched && track.progress_percent === 0 && !['running', 'success', 'failure'].includes(track.lane_action_status) && (
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>⚡</span><span>auto-started</span>
        </div>
      )}

      {/* Heartbeat + agent + lane button */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-800/40">
        <HeartbeatDot
          laneStatus={track.lane_status}
          laneActionStatus={track.lane_action_status}
          lastHeartbeat={track.last_heartbeat}
        />

        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            {(track.active_cli || track.primary_cli) && (
              <AgentBadge agent={track.active_cli || track.primary_cli} />
            )}
          </div>

          {/* Dev server button — visible on review and in-progress lanes */}
          {(track.lane_status === 'review' || track.lane_status === 'implement') && (
            <DevServerButton projectId={track.project_id} devUrl={track.dev_url} />
          )}

          <div className="flex items-center gap-1 shrink-0">
            {confirmDelete ? (
              <button
                onClick={e => { e.stopPropagation(); onDeleteTrack?.(track); }}
                onBlur={() => setConfirmDelete(false)}
                autoFocus
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-red-600 text-red-300 bg-red-900/40 hover:bg-red-900/70 transition-colors"
                title="Confirm delete"
              >
                Delete?
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                className="shrink-0 text-[10px] px-1 py-0.5 rounded border border-transparent text-gray-700 hover:text-red-400 hover:border-red-800/50 transition-colors"
                title="Delete track"
              >
                🗑
              </button>
            )}
            {track.lane_status === 'review' && (
              <button
                onClick={e => { e.stopPropagation(); onFixReview?.(track); }}
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-amber-800/70 text-amber-400 hover:bg-amber-900/30 transition-colors"
                title="Append review gaps as new tasks and move back to In Progress"
              >
                Fix
              </button>
            )}
            {['plan', 'implement', 'review', 'quality-gate'].includes(track.lane_status) && track.lane_action_status === 'success' && (
              <button
                disabled={launching}
                onClick={async e => {
                  e.stopPropagation();
                  setLaunching(true);
                  try { await onRerunImplement?.(track); } catch (_) { }
                  setTimeout(() => setLaunching(false), 4000);
                }}
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${launching
                  ? 'border-blue-800 text-blue-400 bg-blue-900/30 cursor-default'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                title={`Re-run ${track.lane_status} action for this track`}
              >
                {launching ? '⏳' : '↺'}
              </button>
            )}
            {track.lane_status === 'plan' && track.lane_action_status !== 'success' && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-400 animate-pulse whitespace-nowrap">
                <span>⚡</span><span>Plan</span>
              </span>
            )}
            {showNextBtn && (
              <button
                disabled={nextBtnDisabled}
                onClick={e => { e.stopPropagation(); onLaneChange?.(track, nextLane); }}
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${nextBtnDisabled
                  ? 'border-gray-800 text-gray-600 bg-gray-950 cursor-not-allowed'
                  : 'border-blue-800/70 text-blue-400 hover:bg-blue-900/30'
                  }`}
                title={nextBtnDisabled ? 'Plan in progress...' : `Move this card to the ${NEXT_LANE_LABEL[nextLane]} lane`}
              >
                →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
