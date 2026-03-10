import React, { useState, useEffect } from 'react';

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', desc: 'Only you can use this worker', icon: '🔒' },
  { value: 'team', label: 'Team', desc: 'Specific teammates you invite', icon: '👥' },
  { value: 'public', label: 'Public', desc: 'Any project member can use it', icon: '🌐' },
];

export function WorkerVisibilityDialog({ worker, onClose, onUpdated }) {
  const [visibility, setVisibility] = useState(worker.visibility || 'private');
  const [permissions, setPermissions] = useState([]);
  const [inviteUid, setInviteUid] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPermissions();
  }, []);

  async function fetchPermissions() {
    try {
      const r = await fetch(`/api/workers/${worker.id}/permissions`);
      if (r.ok) setPermissions(await r.json());
    } catch { /* ignore */ }
  }

  async function saveVisibility(v) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/workers/${worker.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: v }),
      });
      if (!r.ok) throw new Error(await r.text());
      setVisibility(v);
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteUid.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/workers/${worker.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_uid: inviteUid.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setInviteUid('');
      await fetchPermissions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(uid) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/workers/${worker.id}/permissions/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await fetchPermissions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
        data-testid="worker-visibility-dialog"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Worker Sharing</h2>
            <p className="text-xs text-gray-500 mt-0.5">{worker.hostname} · PID {worker.pid}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        {/* Visibility selector */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Visibility</p>
          <div className="flex flex-col gap-2">
            {VISIBILITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                disabled={saving}
                onClick={() => saveVisibility(opt.value)}
                data-testid={`visibility-option-${opt.value}`}
                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  visibility === opt.value
                    ? 'border-blue-500 bg-blue-950/30 text-blue-200'
                    : 'border-gray-800 hover:border-gray-600 text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="text-lg">{opt.icon}</span>
                <div>
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.desc}</p>
                </div>
                {visibility === opt.value && (
                  <span className="ml-auto text-blue-400 text-xs font-bold">ACTIVE</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Team members (only shown when visibility=team) */}
        {visibility === 'team' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Team Members</p>

            {permissions.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No teammates invited yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {permissions.map(p => (
                  <div key={p.user_uid} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-gray-300">{p.user_uid}</span>
                    <button
                      onClick={() => handleRevoke(p.user_uid)}
                      disabled={saving}
                      className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-wider transition-colors"
                      data-testid="revoke-permission-btn"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="text"
                value={inviteUid}
                onChange={e => setInviteUid(e.target.value)}
                placeholder="User UID or email"
                data-testid="invite-uid-input"
                className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={saving || !inviteUid.trim()}
                data-testid="invite-submit-btn"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Invite
              </button>
            </form>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
        )}
      </div>
    </div>
  );
}
