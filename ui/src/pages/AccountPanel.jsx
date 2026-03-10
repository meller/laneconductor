// ui/src/pages/AccountPanel.jsx
// Account panel — accessible by clicking the user avatar.
// Sections: Profile, API Keys, Worker Setup Instructions.

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function AccountPanel({ onClose }) {
  const { user, logout } = useAuth();
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [keySaving, setKeySaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchApiKeys(); }, []);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  async function fetchApiKeys() {
    try {
      const r = await fetch('/api/keys');
      if (r.ok) setApiKeys(await r.json());
    } catch { /* ignore */ }
  }

  async function handleGenerateKey(e) {
    e.preventDefault();
    setKeySaving(true);
    setGeneratedKey(null);
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() || null }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setGeneratedKey(data.key);
      setNewKeyName('');
      await fetchApiKeys();
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to generate key: ' + err.message });
    } finally {
      setKeySaving(false);
    }
  }

  async function handleRevokeKey(id) {
    if (!confirm('Revoke this key? Workers using it will lose access.')) return;
    try {
      const r = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await fetchApiKeys();
      setNotification({ type: 'success', message: 'Key revoked.' });
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to revoke key: ' + err.message });
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex shadow-2xl">
      <div className="w-[480px] flex flex-col h-full bg-gray-900 border-l border-gray-800">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 bg-gray-950 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Account</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Profile */}
          <section className="flex items-center gap-4">
            {user?.picture ? (
              <img src={user.picture} alt={user.name} className="w-14 h-14 rounded-full border-2 border-gray-700" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-2xl text-gray-400">
                {(user?.name || user?.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-white">{user?.name || '—'}</p>
              <p className="text-xs text-gray-400">{user?.email || '—'}</p>
              <button
                onClick={logout}
                className="mt-2 text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-800 transition-colors uppercase tracking-wider"
              >
                Sign out
              </button>
            </div>
          </section>

          {/* API Keys */}
          <section className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">API Keys</h3>
              <p className="text-[11px] text-gray-500 mt-1">
                Generate keys to authenticate workers connecting to this workspace.
              </p>
            </div>

            {/* Generated key banner */}
            {generatedKey && (
              <div className="bg-green-950/40 border border-green-800 rounded-lg p-4 space-y-2" data-testid="generated-key-banner">
                <p className="text-xs font-bold text-green-400">Copy this key now — it won't be shown again</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-green-300 break-all bg-green-950/40 rounded px-2 py-1 select-all">
                    {generatedKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(generatedKey)}
                    className="shrink-0 text-[10px] px-2 py-1 bg-green-800 hover:bg-green-700 text-green-100 rounded transition-colors font-bold"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <button onClick={() => setGeneratedKey(null)} className="text-[10px] text-gray-500 hover:text-gray-300">Dismiss</button>
              </div>
            )}

            {/* Key list */}
            {apiKeys.length > 0 && (
              <div className="space-y-2">
                {apiKeys.map(k => (
                  <div key={k.id} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5" data-testid="api-key-row">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-gray-300">{k.key_prefix}…</code>
                        {k.name && <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{k.name}</span>}
                      </div>
                      <p className="text-[10px] text-gray-600">
                        Created {new Date(k.created_at).toLocaleDateString()}
                        {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRevokeKey(k.id)}
                      className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-wider transition-colors ml-3"
                      data-testid="revoke-key-btn"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {apiKeys.length === 0 && !generatedKey && (
              <p className="text-xs text-gray-600 italic">No API keys yet.</p>
            )}

            {/* Generate form */}
            <form onSubmit={handleGenerateKey} className="flex gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. Home Desktop)"
                data-testid="key-name-input"
                className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={keySaving}
                data-testid="generate-key-btn"
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
              >
                {keySaving ? '…' : 'Generate Key'}
              </button>
            </form>
          </section>

          {/* Worker Setup */}
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Connect a Worker</h3>
              <p className="text-[11px] text-gray-500 mt-1">
                Run these commands in your project to start sending tracks to this workspace.
              </p>
            </div>
            <div className="space-y-3">
              <Step n={1} label="Generate an API key above, then configure your worker:">
                <Cmd>lc config mode remote-api \<br/>
                &nbsp;&nbsp;--url https://app.laneconductor.com \<br/>
                &nbsp;&nbsp;--key YOUR_API_KEY</Cmd>
              </Step>
              <Step n={2} label="Start the worker in your project:">
                <Cmd>lc start</Cmd>
              </Step>
              <Step n={3} label="Create your first track:">
                <Cmd>lc new "My first feature" "Description"</Cmd>
              </Step>
            </div>
          </section>

        </div>

        {notification && (
          <div className="absolute bottom-6 left-6 right-6 z-10">
            <div className={`px-4 py-3 rounded-lg shadow-2xl border text-xs font-bold tracking-wide uppercase
              ${notification.type === 'success'
                ? 'bg-green-900/90 border-green-500 text-green-100'
                : 'bg-red-900/90 border-red-500 text-red-100'}`}>
              {notification.message}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, label, children }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-5 h-5 rounded-full bg-blue-900 border border-blue-700 flex items-center justify-center text-[10px] font-bold text-blue-300 mt-0.5">
        {n}
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] text-gray-400">{label}</p>
        {children}
      </div>
    </div>
  );
}

function Cmd({ children }) {
  return (
    <pre className="text-[10px] font-mono text-blue-300 bg-gray-950 border border-gray-800 rounded px-3 py-2 leading-relaxed overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}
