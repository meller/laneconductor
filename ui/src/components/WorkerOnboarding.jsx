// ui/src/components/WorkerOnboarding.jsx
// Cloud mode onboarding: displays the worker connection instructions and API token

import React, { useState, useEffect } from 'react';

export function WorkerOnboarding({ workspaceId, onClose }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  const collectorUrl = 'https://collector.laneconductor.io';
  const cloudMode = process.env.VITE_CLOUD_MODE === 'true';

  useEffect(() => {
    // In cloud mode, fetch the API token from the cloud collector
    if (!cloudMode) {
      setLoading(false);
      return;
    }

    async function fetchToken() {
      try {
        // The token is typically displayed from user's session
        // In a real implementation, this would come from the cloud reader or collector
        // For now, we show where to get it
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch token:', err);
        setError(err.message);
        setLoading(false);
      }
    }

    fetchToken();
  }, [cloudMode]);

  function copyToClipboard(text, field) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ width: 32, height: 32, border: '2px solid #1d4ed8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f9fafb' }}>
          Connect Your Worker
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 20,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <p style={{ color: '#d1d5db', fontSize: 14, margin: '0 0 16px', lineHeight: 1.6 }}>
          Copy these settings into your project's <code style={{ background: '#111827', padding: '2px 6px', borderRadius: 4, color: '#93c5fd' }}>.laneconductor.json</code>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Collector URL */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Collector URL
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={collectorUrl}
                readOnly
                style={{
                  flex: 1,
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#e5e7eb',
                  fontFamily: 'monospace',
                  fontSize: 13,
                }}
              />
              <button
                onClick={() => copyToClipboard(collectorUrl, 'url')}
                style={{
                  padding: '10px 16px',
                  background: copiedField === 'url' ? '#10b981' : '#1d4ed8',
                  border: 'none',
                  borderRadius: 8,
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => !copiedField && (e.target.style.background = '#1e40af')}
                onMouseLeave={e => !copiedField && (e.target.style.background = '#1d4ed8')}
              >
                {copiedField === 'url' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* API Token */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              API Token
            </label>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 8px' }}>
              Get your token from the account settings in LaneConductor Cloud
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={token || '••••••••••••••••••••••••••••••••'}
                readOnly
                style={{
                  flex: 1,
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#e5e7eb',
                  fontFamily: 'monospace',
                  fontSize: 13,
                }}
              />
              <button
                onClick={() => token && copyToClipboard(token, 'token')}
                disabled={!token}
                style={{
                  padding: '10px 16px',
                  background: !token ? '#4b5563' : (copiedField === 'token' ? '#10b981' : '#1d4ed8'),
                  border: 'none',
                  borderRadius: 8,
                  color: 'white',
                  fontWeight: 600,
                  cursor: token ? 'pointer' : 'default',
                  fontSize: 13,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => token && !copiedField && (e.target.style.background = '#1e40af')}
                onMouseLeave={e => token && !copiedField && (e.target.style.background = '#1d4ed8')}
              >
                {copiedField === 'token' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration example */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          .laneconductor.json collectors array
        </label>
        <pre style={{
          background: '#0f1623',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: 12,
          fontSize: 12,
          color: '#93c5fd',
          margin: 0,
          overflow: 'auto',
          fontFamily: 'monospace',
          lineHeight: 1.6,
        }}>
{`"collectors": [
  {
    "url": "${collectorUrl}",
    "token": "lc_xxxx..."  // Your token from account settings
  }
]`}
        </pre>
      </div>

      {/* Instructions */}
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 16 }}>
        <p style={{ color: '#e5e7eb', fontSize: 13, margin: '0 0 12px', fontWeight: 600 }}>
          Setup Steps:
        </p>
        <ol style={{ color: '#9ca3af', fontSize: 13, margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Sign in to <a href="https://laneconductor.io" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>laneconductor.io</a> and generate an API token in account settings</li>
          <li>Update your project's <code style={{ background: '#1f2937', padding: '2px 4px', borderRadius: 2 }}>.laneconductor.json</code> with the above settings</li>
          <li>Store the token in your project's <code style={{ background: '#1f2937', padding: '2px 4px', borderRadius: 2 }}>.env</code> as <code style={{ background: '#1f2937', padding: '2px 4px', borderRadius: 2 }}>COLLECTOR_0_TOKEN=lc_xxxx...</code></li>
          <li>Run <code style={{ background: '#1f2937', padding: '2px 4px', borderRadius: 2 }}>make lc-start</code> to start the worker with cloud sync enabled</li>
        </ol>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, color: '#fecaca', fontSize: 13 }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}
