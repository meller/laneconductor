import React, { useState, useEffect } from 'react';
import { WorkflowGraph } from '../components/WorkflowGraph.jsx';

export function WorkflowSettings({ projectId, onClose }) {
  const [activeTab, setActiveTab] = useState('visual');
  const [selectedLane, setSelectedLane] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    fetchWorkflow();
  }, [projectId]);

  async function fetchWorkflow() {
    try {
      setLoading(true);
      const r = await fetch(`/api/projects/${projectId}/workflow`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setConfig(data);
      setJsonText(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
        return;
      }

      const r = await fetch(`/api/projects/${projectId}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: parsed }),
      });
      if (!r.ok) throw new Error(await r.text());

      setConfig(parsed);
      setJsonText(JSON.stringify(parsed, null, 2));
      setNotification({ type: 'success', message: 'Workflow saved! Syncing with local workflow.md...' });
    } catch (err) {
      setNotification({ type: 'error', message: 'Save failed: ' + err.message });
    } finally {
      setSaving(false);
    }
  }

  function handleNodeClick(event, node) {
    setSelectedLane(node.id);
  }

  function updateLaneProp(prop, val) {
    if (!selectedLane || !config) return;
    const newConfig = JSON.parse(JSON.stringify(config));
    if (!newConfig.lanes) newConfig.lanes = {};
    if (!newConfig.lanes[selectedLane]) newConfig.lanes[selectedLane] = {};

    if (val === '') {
      delete newConfig.lanes[selectedLane][prop];
    } else {
      newConfig.lanes[selectedLane][prop] = (prop === 'max_retries' || prop === 'parallel_limit') ? Number(val) : val;
    }
    setConfig(newConfig);
    setJsonText(JSON.stringify(newConfig, null, 2));
  }

  if (loading) return <div className="p-8 text-gray-500">Loading workflow...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-[900px] shadow-2xl">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-950">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Workflow Configuration</h2>
          <p className="text-[10px] text-gray-500 mt-1">Updates conductor/workflow.md</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          ✕
        </button>
      </div>

      <div className="flex px-4 border-b border-gray-800 bg-gray-950">
        <button
          onClick={() => {
            try {
              const parsed = JSON.parse(jsonText);
              setConfig(parsed);
              setActiveTab('visual');
            } catch (err) {
              setNotification({ type: 'error', message: 'Cannot switch to Visual Editor: Invalid JSON' });
            }
          }}
          className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${activeTab === 'visual' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'
            }`}
        >
          Visual Editor
        </button>
        <button
          onClick={() => setActiveTab('json')}
          className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${activeTab === 'json' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'
            }`}
        >
          JSON Config
        </button>
      </div>

      <div className="flex-1 p-4 overflow-hidden flex flex-col">
        {activeTab === 'visual' ? (
          <div className="flex-1 flex gap-4 h-[500px] mb-4">
            <div className="flex-1 relative">
              <WorkflowGraph config={config} onNodeClick={handleNodeClick} />
            </div>
            {selectedLane && config?.lanes && (
              <div className="w-64 bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3 overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                  <h3 className="text-white text-sm font-bold uppercase tracking-wider">{selectedLane}</h3>
                  <button onClick={() => setSelectedLane(null)} className="text-gray-500 hover:text-white transition-colors">✕</button>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-500 font-bold uppercase mb-1">Parallel Limit</label>
                  <input
                    type="number"
                    min="1"
                    value={config.lanes[selectedLane]?.parallel_limit || ''}
                    onChange={e => updateLaneProp('parallel_limit', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-700"
                    placeholder="e.g. 1"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-gray-500 font-bold uppercase mb-1">Max Retries</label>
                  <input
                    type="number"
                    min="0"
                    value={config.lanes[selectedLane]?.max_retries ?? ''}
                    onChange={e => updateLaneProp('max_retries', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-700"
                    placeholder="e.g. 0"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-gray-500 font-bold uppercase mb-1">On Success</label>
                  <input
                    list="lane-suggestions"
                    value={config.lanes[selectedLane]?.on_success || ''}
                    onChange={e => updateLaneProp('on_success', e.target.value)}
                    placeholder="e.g. implement or plan:success"
                    className="w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-gray-500 font-bold uppercase mb-1">On Failure</label>
                  <input
                    list="lane-suggestions"
                    value={config.lanes[selectedLane]?.on_failure || ''}
                    onChange={e => updateLaneProp('on_failure', e.target.value)}
                    placeholder="e.g. backlog or plan:failure"
                    className="w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-700"
                  />
                </div>

                <datalist id="lane-suggestions">
                  <option value="plan" />
                  <option value="backlog" />
                  <option value="implement" />
                  <option value="review" />
                  <option value="quality-gate" />
                  <option value="done" />
                </datalist>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col mb-4">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="flex-1 w-full bg-gray-950 border border-gray-800 rounded p-4 font-mono text-xs text-blue-300 focus:outline-none focus:border-blue-700 transition-colors resize-none"
              spellCheck="false"
            />
          </div>
        )}

        <div className="bg-blue-900/20 border border-blue-900/30 rounded p-4 mb-4">
          <h3 className="text-xs font-bold text-blue-400 mb-2">Available Actions</h3>
          <ul className="text-[11px] text-blue-200/70 space-y-1 list-disc pl-4">
            <li><code>max_retries</code>: Number of times to retry on failure</li>
            <li><code>on_success</code>: Lane after success — plain lane (<code>"implement"</code>) or <code>"lane:status"</code> (e.g. <code>"plan:success"</code> to stay in plan and mark done)</li>
            <li><code>on_failure</code>: Lane after max retries — same format (e.g. <code>"backlog"</code> or <code>"plan:queue"</code>)</li>
            <li><code>parallel_limit</code>: Max concurrent tracks in this lane</li>
          </ul>
        </div>
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded transition-colors"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {notification && (
        <div className="fixed bottom-20 right-8 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className={`px-4 py-3 rounded shadow-2xl border flex items-center gap-3 ${notification.type === 'success' ? 'bg-green-900/90 border-green-500 text-green-100' : 'bg-red-900/90 border-red-500 text-red-100'
            }`}>
            {notification.type === 'success' ? (
              <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="text-xs font-bold tracking-wide uppercase">{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
