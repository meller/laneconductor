// ui/src/components/CloudOnboarding.jsx
// Shows token + collector URL for connecting local workers in cloud mode

import React, { useState } from 'react';

export function CloudOnboarding({ isOpen, onClose, token, collectorUrl }) {
  const [copiedField, setCopiedField] = useState(null);

  if (!isOpen) return null;

  async function copyToClipboard(text, field) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'rgba(17, 24, 39, 0.95)',
          border: '1px solid rgba(55, 65, 81, 0.6)',
          backdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 32,
          maxWidth: 600,
          width: '90%',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px 0', color: '#f9fafb', fontSize: 20, fontWeight: 700 }}>
          Connect Your Local Worker
        </h2>

        <p style={{ color: '#d1d5db', fontSize: 14, margin: '0 0 24px 0', lineHeight: 1.6 }}>
          Use your API token and collector URL to connect your local LaneConductor worker to the cloud.
        </p>

        {/* Token */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            API Token
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              readOnly
              value={token || 'Loading...'}
              style={{
                flex: 1,
                padding: '10px 12px',
                background: 'rgba(31, 41, 55, 0.6)',
                border: '1px solid rgba(55, 65, 81, 0.5)',
                borderRadius: 8,
                color: '#f3f4f6',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => copyToClipboard(token, 'token')}
              style={{
                padding: '10px 16px',
                background: copiedField === 'token' ? '#10b981' : '#1d4ed8',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => {
                if (copiedField !== 'token') e.currentTarget.style.background = '#1e40af';
              }}
              onMouseLeave={e => {
                if (copiedField !== 'token') e.currentTarget.style.background = '#1d4ed8';
              }}
            >
              {copiedField === 'token' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ color: '#6b7280', fontSize: 12, margin: '6px 0 0 0' }}>
            Keep this token secret. Use it to authenticate your worker.
          </p>
        </div>

        {/* Collector URL */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Collector URL
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              readOnly
              value={collectorUrl || 'Loading...'}
              style={{
                flex: 1,
                padding: '10px 12px',
                background: 'rgba(31, 41, 55, 0.6)',
                border: '1px solid rgba(55, 65, 81, 0.5)',
                borderRadius: 8,
                color: '#f3f4f6',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => copyToClipboard(collectorUrl, 'url')}
              style={{
                padding: '10px 16px',
                background: copiedField === 'url' ? '#10b981' : '#1d4ed8',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => {
                if (copiedField !== 'url') e.currentTarget.style.background = '#1e40af';
              }}
              onMouseLeave={e => {
                if (copiedField !== 'url') e.currentTarget.style.background = '#1d4ed8';
              }}
            >
              {copiedField === 'url' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Setup Instructions */}
        <div style={{ marginBottom: 24, padding: 16, background: 'rgba(31, 41, 55, 0.4)', borderRadius: 8, border: '1px solid rgba(55, 65, 81, 0.3)' }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e5e7eb', fontSize: 13, fontWeight: 600 }}>
            Setup Instructions
          </h4>
          <ol style={{ margin: 0, paddingLeft: 20, color: '#d1d5db', fontSize: 12, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 8 }}>In your local project, run: <code style={{ background: 'rgba(17, 24, 39, 0.6)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>/laneconductor setup collection</code></li>
            <li style={{ marginBottom: 8 }}>Select option <code style={{ background: 'rgba(17, 24, 39, 0.6)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>[2] LC cloud</code> or <code style={{ background: 'rgba(17, 24, 39, 0.6)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>[3] Both</code></li>
            <li style={{ marginBottom: 8 }}>Paste the Collector URL above when prompted</li>
            <li>Paste your API token in the <code style={{ background: 'rgba(17, 24, 39, 0.6)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>.env</code> file as <code style={{ background: 'rgba(17, 24, 39, 0.6)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>COLLECTOR_1_TOKEN</code></li>
          </ol>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'rgba(55, 65, 81, 0.5)',
              border: '1px solid rgba(55, 65, 81, 0.6)',
              borderRadius: 8,
              color: '#d1d5db',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(75, 85, 99, 0.5)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(55, 65, 81, 0.5)';
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
