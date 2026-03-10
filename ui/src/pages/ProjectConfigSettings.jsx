import React, { useState, useEffect, useCallback } from 'react';

export function ProjectConfigSettings({ projectId, onClose }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [keySaving, setKeySaving] = useState(false);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    fetchConfig();
    fetchApiKeys();
  }, [projectId]);

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
    try {
      const r = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await fetchApiKeys();
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to revoke key: ' + err.message });
    }
  }

  async function fetchConfig() {
    try {
      setLoading(true);
      const r = await fetch(`/api/projects/${projectId}/config`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setConfig(data);
    } catch (err) {
      setNotification({ type: 'error', message: 'Load failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      const r = await fetch(`/api/projects/${projectId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary: config.primary,
          secondary: config.secondary?.cli ? config.secondary : null,
          dev: config.dev,
          create_quality_gate: config.create_quality_gate,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setNotification({ type: 'success', message: 'Config saved! Worker will reload .laneconductor.json on next heartbeat.' });
    } catch (err) {
      setNotification({ type: 'error', message: 'Save failed: ' + err.message });
    } finally {
      setSaving(false);
    }
  }

  function set(path, value) {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }

  const inputCls = 'w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-700';
  const labelCls = 'block text-[10px] text-gray-500 font-bold uppercase mb-1';

  if (loading) return <div className="p-8 text-gray-500 text-xs">Loading config...</div>;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-[900px] shadow-2xl">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-950">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Project Configuration</h2>
          <p className="text-[10px] text-gray-500 mt-1">Updates .laneconductor.json via DB sync</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* AI Configuration */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">AI Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Primary CLI</label>
              <select value={config?.primary?.cli || 'claude'} onChange={e => set('primary.cli', e.target.value)} className={inputCls}>
                <option value="claude">claude</option>
                <option value="gemini">gemini</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Primary Model</label>
              <input type="text" value={config?.primary?.model || ''} onChange={e => set('primary.model', e.target.value)}
                placeholder="e.g. sonnet, gemini-2.5-pro" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Secondary CLI (optional)</label>
              <select value={config?.secondary?.cli || ''} onChange={e => set('secondary.cli', e.target.value)} className={inputCls}>
                <option value="">none</option>
                <option value="claude">claude</option>
                <option value="gemini">gemini</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Secondary Model</label>
              <input type="text" value={config?.secondary?.model || ''} onChange={e => set('secondary.model', e.target.value)}
                placeholder="e.g. haiku, gemini-flash" className={inputCls} disabled={!config?.secondary?.cli} />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <input type="checkbox" id="quality-gate" checked={config?.create_quality_gate || false}
                onChange={e => set('create_quality_gate', e.target.checked)}
                className="w-3 h-3 accent-blue-500" />
              <label htmlFor="quality-gate" className="text-xs text-gray-300 cursor-pointer">Enable Quality Gate lane</label>
            </div>
          </div>
        </section>

        {/* Dev Server */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">Dev Server</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Start Command</label>
              <input type="text" value={config?.dev?.command || ''} onChange={e => set('dev.command', e.target.value)}
                placeholder="e.g. npm run dev" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>URL</label>
              <input type="text" value={config?.dev?.url || ''} onChange={e => set('dev.url', e.target.value)}
                placeholder="e.g. http://localhost:3000" className={inputCls} />
            </div>
          </div>
        </section>

        {/* Collectors */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">Collectors</h3>
          {(config?.collectors || []).map((c, i) => (
            <div key={i} className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className={labelCls}>Collector {i + 1} URL</label>
                <input type="text" value={c.url || ''} onChange={e => {
                  const next = [...(config.collectors || [])];
                  next[i] = { ...next[i], url: e.target.value };
                  setConfig(prev => ({ ...prev, collectors: next }));
                }} className={inputCls} placeholder="http://localhost:8091" />
              </div>
              <div>
                <label className={labelCls}>Token (optional)</label>
                <input type="text" value={c.token || ''} onChange={e => {
                  const next = [...(config.collectors || [])];
                  next[i] = { ...next[i], token: e.target.value };
                  setConfig(prev => ({ ...prev, collectors: next }));
                }} className={inputCls} placeholder="leave blank for local" />
              </div>
            </div>
          ))}
        </section>

        {/* DB */}
        {config?.db && (
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">Database</h3>
            <div className="grid grid-cols-3 gap-4">
              {['host', 'port', 'name', 'user', 'password'].map(k => (
                <div key={k}>
                  <label className={labelCls}>{k}</label>
                  <input type={k === 'password' ? 'password' : 'text'} value={config.db[k] || ''} onChange={e => set(`db.${k}`, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* UI Port */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">UI</h3>
          <div className="w-32">
            <label className={labelCls}>UI Port</label>
            <input type="number" value={config?.ui_port || 8090} onChange={e => setConfig(prev => ({ ...prev, ui_port: parseInt(e.target.value) }))} className={inputCls} />
          </div>
        </section>

        {/* Project Info (read-only) */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 pb-2 border-b border-gray-800">Project (read-only)</h3>
          <div className="space-y-2">
            {[
              ['Mode', config?.mode],
              ['Repo Path', config?.repo_path],
              ['Git Remote', config?.git_remote || '—'],
            ].map(([label, val]) => (
              <div key={label} className="flex gap-3 text-xs">
                <span className="text-gray-500 w-24 flex-shrink-0">{label}</span>
                <span className="text-gray-300 font-mono break-all">{val}</span>
              </div>
            ))}
          </div>
        </section>

        {/* API Keys section */}
        <section className="bg-gray-950 border border-gray-800 rounded-xl p-5 space-y-4" data-testid="api-keys-section">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-200">API Keys</h3>
              <p className="text-xs text-gray-500 mt-0.5">Use these to authenticate workers in remote-api mode</p>
            </div>
          </div>

          {/* Generated key banner */}
          {generatedKey && (
            <div className="bg-green-950/30 border border-green-800 rounded-lg p-3 space-y-1" data-testid="generated-key-banner">
              <p className="text-xs font-bold text-green-400">Key generated — copy it now, it won't be shown again</p>
              <code className="text-xs font-mono text-green-300 break-all select-all">{generatedKey}</code>
              <button onClick={() => setGeneratedKey(null)} className="text-[10px] text-gray-500 hover:text-gray-300 mt-1">Dismiss</button>
            </div>
          )}

          {/* Existing keys */}
          {apiKeys.length > 0 && (
            <div className="flex flex-col gap-2">
              {apiKeys.map(k => (
                <div key={k.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-3 py-2" data-testid="api-key-row">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-gray-300">{k.key_prefix}…</code>
                      {k.name && <span className="text-[10px] text-gray-500">{k.name}</span>}
                    </div>
                    <span className="text-[10px] text-gray-600">
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRevokeKey(k.id)}
                    className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-wider transition-colors"
                    data-testid="revoke-key-btn"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Generate new key form */}
          <form onSubmit={handleGenerateKey} className="flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Home Desktop)"
              data-testid="key-name-input"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={keySaving}
              data-testid="generate-key-btn"
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
            >
              {keySaving ? '…' : 'Generate Key'}
            </button>
          </form>
        </section>
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-end gap-3">
        <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded transition-colors">
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {notification && (
        <div className="fixed bottom-20 right-8 z-50">
          <div className={`px-4 py-3 rounded shadow-2xl border flex items-center gap-3 ${notification.type === 'success' ? 'bg-green-900/90 border-green-500 text-green-100' : 'bg-red-900/90 border-red-500 text-red-100'}`}>
            <span className="text-xs font-bold tracking-wide uppercase">{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
