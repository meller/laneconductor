import React from 'react';

// Catches render errors anywhere in its subtree (e.g. AppContent) that would
// otherwise unmount the whole tree and leave the UI frozen on whatever was
// last rendered — with no console-visible recovery path short of a full
// page reload. Shows a recoverable fallback instead.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <p style={{ color: '#f87171', fontWeight: 600, marginBottom: 8 }}>Something went wrong</p>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>
              {this.state.error?.message || 'The app hit an unexpected error and had to stop rendering.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ fontSize: 13, padding: '8px 16px', borderRadius: 6, background: '#1d4ed8', color: 'white', border: 'none', cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
