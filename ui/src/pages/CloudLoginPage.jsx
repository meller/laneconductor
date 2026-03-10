// ui/src/pages/CloudLoginPage.jsx
// Cloud mode login page with Firebase GitHub OAuth

import React, { useState } from 'react';
import { useCloudAuth } from '../contexts/CloudAuthContext.jsx';

export function CloudLoginPage() {
  const { signInWithGitHub, loading, error } = useCloudAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    try {
      setSigningIn(true);
      await signInWithGitHub();
    } catch (err) {
      console.error('Sign in failed:', err);
      // Error is already in the context
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0d0d0f 0%, #0f1623 60%, #0d1a2e 100%)',
      }}
    >
      {/* Glow ring */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          padding: '48px 40px',
          background: 'rgba(17,24,39,0.85)',
          border: '1px solid rgba(55,65,81,0.6)',
          backdropFilter: 'blur(20px)',
          borderRadius: 20,
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.08)',
          minWidth: 360,
          maxWidth: 420,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <img
            src="/logo.png"
            alt="LaneConductor"
            style={{ height: 48, width: 'auto' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                color: '#f9fafb',
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              LaneConductor Cloud
            </h1>
            <p
              style={{
                color: '#6b7280',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                margin: '4px 0 0',
              }}
            >
              Orchestrating Agile Flow
            </p>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            width: '100%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(55,65,81,0.8), transparent)',
          }}
        />

        {/* Sign-in button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%' }}>
          <p style={{ color: '#9ca3af', fontSize: 13, margin: 0, textAlign: 'center' }}>
            Sign in with your GitHub account to get started
          </p>

          <button
            onClick={handleSignIn}
            disabled={signingIn || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '11px 20px',
              background: signingIn ? 'linear-gradient(135deg, #1c2128 0%, #111417 100%)' : 'linear-gradient(135deg, #24292e 0%, #1c2128 100%)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              color: '#f0f6fc',
              fontSize: 14,
              fontWeight: 600,
              cursor: signingIn ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              letterSpacing: '-0.01em',
              opacity: signingIn ? 0.7 : 1,
            }}
            onMouseEnter={e => {
              if (!signingIn && !loading) {
                e.currentTarget.style.background = 'linear-gradient(135deg, #2d333b 0%, #22272e 100%)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
              }
            }}
            onMouseLeave={e => {
              if (!signingIn && !loading) {
                e.currentTarget.style.background = 'linear-gradient(135deg, #24292e 0%, #1c2128 100%)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            {signingIn ? (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid #f0f6fc', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <span>Continue with GitHub</span>
              </>
            )}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              width: '100%',
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        {/* Footer note */}
        <p style={{ color: '#4b5563', fontSize: 11, margin: 0, textAlign: 'center' }}>
          Access is restricted to authorized workspace members only
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
