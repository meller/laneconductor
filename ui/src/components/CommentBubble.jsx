// ui/src/components/CommentBubble.jsx
// Extracted from TrackDetailPanel's Conversation tab (track 1094) so
// WorkerChatPanel (track 10037) renders track comments identically instead
// of forking the author-styling/timestamp logic.
import { providerLabel } from '../../../conductor/providers.mjs';

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

export function CommentBubble({ comment }) {
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
