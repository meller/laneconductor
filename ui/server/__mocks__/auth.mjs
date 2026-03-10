// server/__mocks__/auth.mjs
// Manual mock for auth.mjs — used by Vitest when vi.mock('./auth.mjs') is called.
// Stubs all exports so tests never attempt Firebase Admin or GCP Secret Manager calls.
import { Router } from 'express';

export const AUTH_ENABLED = false;
export const loadAuthConfig = async () => { };
export const authRouter = Router();
export const requireAuth = (req, _res, next) => { req.user = { uid: 'test-user-uid' }; next(); };

// Kept for backward compat in case any test imports these
export const initAuth = () => { };
export const sessionMiddleware = () => (_req, _res, next) => next();
