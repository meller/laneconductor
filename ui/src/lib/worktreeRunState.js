// ui/src/lib/worktreeRunState.js
// Track 10024: two independent signals decide whether a worktrees-panel row
// is "running" — a client-initiated dispatch this browser tab just fired
// (instant, but lost on reload/in another tab), and the server's own
// lane_status (authoritative, but only as fresh as the last audit cycle).
// Either one is enough. A row with no track is never "running" for this
// purpose — there's no track whose transcript could be opened.
export function isWorktreeRowRunning({ row, busy }) {
  if (!row?.track) return false;
  return Boolean(busy) || String(row.lane_status ?? '').toLowerCase() === 'running';
}
