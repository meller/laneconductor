// ui/server/auth.mjs
// Firebase Auth middleware for the Express API.
//
// Two modes:
//   LOCAL  — no VITE_FIREBASE_PROJECT_ID in env → auth disabled, all /api routes open
//   REMOTE — Firebase project configured → ID token required on all /api/* routes
//
// The frontend sends: Authorization: Bearer <Firebase ID token>
// This middleware verifies it with firebase-admin (uses ADC / service account).

import { Router } from 'express';

// ── Firebase Admin setup (lazy — only initialized when AUTH_ENABLED) ──────────

export let AUTH_ENABLED = false;
export let TEST_MODE = process.env.PW_TEST_MODE === 'true';

/**
 * Called once at server startup. Reads Firebase config from env vars or GCP env.
 */
export async function loadAuthConfig() {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
    AUTH_ENABLED = Boolean(projectId) || TEST_MODE;

    if (!AUTH_ENABLED) {
        console.log('[auth] mode: LOCAL (no Firebase config — auth disabled)');
        return;
    }

    if (TEST_MODE) {
        console.log('[auth] mode: TEST (simulating auth via mock tokens)');
        return;
    }

    try {
        // ... rest of Firebase init

        // firebase-admin uses ADC automatically (gcloud locally, service account on GCP infra)
        // Optionally load service account from GCP Secret Manager for explicit override
        const { initializeApp, cert, getApps } = await import('firebase-admin/app');
        const { getAuth } = await import('firebase-admin/auth');

        if (getApps().length === 0) {
            let credential;
            const serviceAccountSecret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
            if (serviceAccountSecret) {
                // Explicit service account JSON (from Secret Manager fetched at startup)
                credential = cert(JSON.parse(serviceAccountSecret));
            }
            // If no explicit credential, firebase-admin auto-uses ADC
            initializeApp(credential ? { credential, projectId } : { projectId });
        }

        _adminAuth = getAuth();
        console.log(`[auth] mode: REMOTE (Firebase project: ${projectId})`);
    } catch (err) {
        console.error('[auth] Firebase Admin init failed:', err.message);
        AUTH_ENABLED = false;
    }
}

// No-op stub for tests
export function initAuth() { }
export function sessionMiddleware() { return (_req, _res, next) => next(); }

// ── requireAuth middleware ────────────────────────────────────────────────────
// Local mode: always passes through.
// Remote mode: validates Firebase ID token from Authorization: Bearer <token>

export async function requireAuth(req, res, next) {
    if (!AUTH_ENABLED) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized', auth_required: true });
    }

    const idToken = authHeader.split('Bearer ')[1];

    if (TEST_MODE && idToken.startsWith('MOCK_TOKEN_FOR_')) {
        req.user = {
            uid: idToken.replace('MOCK_TOKEN_FOR_', ''),
            email: 'test@example.com',
            name: 'Test User'
        };
        return next();
    }

    try {
        const decoded = await _adminAuth.verifyIdToken(idToken);
        req.user = {
            uid: decoded.uid,
            email: decoded.email,
            name: decoded.name,
            picture: decoded.picture,
            github_login: decoded.firebase?.identities?.['github.com']?.[0],
        };
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token', auth_required: true });
    }
}

// ── Auth router ───────────────────────────────────────────────────────────────

export const authRouter = Router();

// GET /auth/me — always mounted, frontend polls on load
authRouter.get('/me', (req, res) => {
    if (!AUTH_ENABLED) {
        // Local mode: return a synthetic local user so the UI renders without a login page
        return res.json({ user: { uid: 'local', name: 'Local Mode', local: true } });
    }
    // In remote mode, user is set by requireAuth. For /auth/me, apply auth inline:
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ user: null });
    }
    const idToken = authHeader.split('Bearer ')[1];
    _adminAuth.verifyIdToken(idToken)
        .then(decoded => res.json({
            user: {
                uid: decoded.uid,
                email: decoded.email,
                name: decoded.name,
                picture: decoded.picture,
                github_login: decoded.firebase?.identities?.['github.com']?.[0],
            }
        }))
        .catch(() => res.status(401).json({ user: null }));
});

// GET /auth/config — returns Firebase web config for the frontend to initialise
authRouter.get('/config', (_req, res) => {
    if (!AUTH_ENABLED) {
        return res.json({ enabled: false });
    }
    res.json({
        enabled: true,
        firebase: {
            apiKey: process.env.VITE_FIREBASE_API_KEY,
            authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: process.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.VITE_FIREBASE_APP_ID,
        },
    });
});
