// ui/src/contexts/AuthContext.jsx
// Firebase Auth context — wraps the entire app.
//
// Two modes:
//   LOCAL  — /auth/config returns { enabled: false } → synthetic local user, no login wall
//   REMOTE — Firebase initialised with GitHub OAuth → getIdToken() sent as Bearer on all API calls
//
// Exports: useAuth() → { user, loading, idToken, logout, refetchAuth }

import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Singleton Firebase Auth instance (may be null in local mode)
let _firebaseAuth = null;

async function initFirebase(config) {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth, GithubAuthProvider, GoogleAuthProvider, signInWithRedirect, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } = await import('firebase/auth');

    if (!getApps().length) {
        initializeApp(config);
    }
    _firebaseAuth = getAuth();
    return { GithubAuthProvider, GoogleAuthProvider, signInWithRedirect, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged };
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [idToken, setIdToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authEnabled, setAuthEnabled] = useState(false);
    const [firebaseFns, setFirebaseFns] = useState(null);

    useEffect(() => {
        let unsubscribe = null;

        async function setup() {
            try {
                const res = await fetch('/auth/config');
                const { enabled, firebase: fbConfig } = await res.json();

                if (!enabled) {
                    // LOCAL MODE — no Firebase, synthetic user
                    setUser({ uid: 'local', name: 'Local Mode', local: true });
                    setAuthEnabled(false);
                    setLoading(false);
                    return;
                }

                setAuthEnabled(true);
                const fns = await initFirebase(fbConfig);
                setFirebaseFns(fns);

                // Listen to Firebase auth state changes
                unsubscribe = fns.onAuthStateChanged(_firebaseAuth, async (firebaseUser) => {
                    if (firebaseUser) {
                        const token = await firebaseUser.getIdToken();

                        // Upsert workspace/user on backend
                        try {
                            await fetch('/auth/token', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                        } catch (err) {
                            console.error('[auth] failed to init workspace:', err);
                        }

                        setIdToken(token);
                        setUser({
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            name: firebaseUser.displayName,
                            picture: firebaseUser.photoURL,
                            local: false,
                        });
                    } else {
                        setIdToken(null);
                        setUser(null);
                    }
                    setLoading(false);
                });
            } catch (err) {
                console.error('[auth] setup failed:', err);
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.info('[auth] falling back to local mode due to connection error on localhost');
                    setUser({ uid: 'local', name: 'Local Mode (Fallback)', local: true });
                }
                setLoading(false);
            }
        }

        setup();
        return () => unsubscribe?.();
    }, []);

    // Refresh the ID token (Firebase auto-refreshes but call this if you need the latest)
    async function refetchAuth() {
        if (!_firebaseAuth?.currentUser) return;
        const token = await _firebaseAuth.currentUser.getIdToken(/* forceRefresh */ true);
        setIdToken(token);
        return token;
    }

    async function loginWithGitHub() {
        if (!firebaseFns || !_firebaseAuth) return;
        const { GithubAuthProvider, signInWithRedirect } = firebaseFns;
        const provider = new GithubAuthProvider();
        provider.addScope('user:email');
        await signInWithRedirect(_firebaseAuth, provider);
    }

    async function loginWithGoogle() {
        if (!firebaseFns || !_firebaseAuth) return;
        const { GoogleAuthProvider, signInWithRedirect } = firebaseFns;
        const provider = new GoogleAuthProvider();
        provider.addScope('email');
        await signInWithRedirect(_firebaseAuth, provider);
    }

    async function loginWithEmail(email, password, isSignUp = false) {
        if (!firebaseFns || !_firebaseAuth) return;
        const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = firebaseFns;
        if (isSignUp) {
            await createUserWithEmailAndPassword(_firebaseAuth, email, password);
        } else {
            await signInWithEmailAndPassword(_firebaseAuth, email, password);
        }
    }

    async function logout() {
        if (!firebaseFns || !_firebaseAuth) return;
        await firebaseFns.signOut(_firebaseAuth);
        setUser(null);
        setIdToken(null);
    }

    return (
        <AuthContext.Provider value={{
            user, loading, idToken, authEnabled,
            loginWithGitHub, loginWithGoogle, loginWithEmail,
            logout, refetchAuth
        }}>
            {children}
        </AuthContext.Provider>
    );
}
