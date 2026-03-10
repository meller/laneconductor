import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { loadAuthConfig, requireAuth, authRouter } from '../auth.mjs';
import * as authModule from '../auth.mjs';

// Mock firebase-admin
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(c => c),
  getApps: vi.fn(() => [])
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  }))
}));

describe('Auth Module', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  describe('loadAuthConfig', () => {
    it('disables auth if VITE_FIREBASE_PROJECT_ID is missing', async () => {
      delete process.env.VITE_FIREBASE_PROJECT_ID;
      await loadAuthConfig();
      expect(authModule.AUTH_ENABLED).toBe(false);
    });

    it('enables auth if VITE_FIREBASE_PROJECT_ID is present', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      expect(authModule.AUTH_ENABLED).toBe(true);
    });

    it('uses service account if FIREBASE_SERVICE_ACCOUNT_JSON is present', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'test-project' });
      await loadAuthConfig();
      expect(authModule.AUTH_ENABLED).toBe(true);
    });
  });

  describe('requireAuth middleware', () => {
    const app = express();
    app.use(express.json());
    app.get('/test', requireAuth, (req, res) => res.json({ user: req.user }));

    it('passes through if AUTH_ENABLED is false', async () => {
      delete process.env.VITE_FIREBASE_PROJECT_ID;
      await loadAuthConfig();
      
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('returns 401 if no auth header in remote mode', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      
      const res = await request(app).get('/test');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 if invalid token', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      mockVerifyIdToken.mockRejectedValue(new Error('invalid'));
      
      const res = await request(app).get('/test').set('Authorization', 'Bearer bad-token');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired token');
    });

    it('sets req.user and passes through if token is valid', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      mockVerifyIdToken.mockResolvedValue({
        uid: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        firebase: { identities: { 'github.com': ['testuser'] } }
      });
      
      const res = await request(app).get('/test').set('Authorization', 'Bearer good-token');
      expect(res.status).toBe(200);
      expect(res.body.user.uid).toBe('user123');
      expect(res.body.user.github_login).toBe('testuser');
    });
  });

  describe('authRouter', () => {
    const app = express();
    app.use('/auth', authRouter);

    it('GET /auth/me returns local user in local mode', async () => {
      delete process.env.VITE_FIREBASE_PROJECT_ID;
      await loadAuthConfig();
      
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.local).toBe(true);
    });

    it('GET /auth/me returns user in remote mode with valid token', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      mockVerifyIdToken.mockResolvedValue({ uid: 'user123' });
      
      const res = await request(app).get('/auth/me').set('Authorization', 'Bearer good-token');
      expect(res.status).toBe(200);
      expect(res.body.user.uid).toBe('user123');
    });

    it('GET /auth/me returns 401 in remote mode without token', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('GET /auth/me returns 401 in remote mode with invalid token', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      await loadAuthConfig();
      mockVerifyIdToken.mockRejectedValue(new Error('fail'));
      
      const res = await request(app).get('/auth/me').set('Authorization', 'Bearer bad-token');
      expect(res.status).toBe(401);
    });

    it('GET /auth/config returns enabled:false in local mode', async () => {
      delete process.env.VITE_FIREBASE_PROJECT_ID;
      await loadAuthConfig();
      
      const res = await request(app).get('/auth/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('GET /auth/config returns firebase config in remote mode', async () => {
      process.env.VITE_FIREBASE_PROJECT_ID = 'test-project';
      process.env.VITE_FIREBASE_API_KEY = 'key123';
      await loadAuthConfig();
      
      const res = await request(app).get('/auth/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.firebase.apiKey).toBe('key123');
    });
  });

  describe('Other functions', () => {
    it('calls initAuth and sessionMiddleware', () => {
      authModule.initAuth();
      const mid = authModule.sessionMiddleware();
      const next = vi.fn();
      mid({}, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });
});