const request = require('supertest');

// 1. Mock Firebase / PG before requiring app
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((opts, app) => app)
}));

jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn((name) => ({
    value: jest.fn(() => (name === 'DATABASE_URL' ? '' : 'mock-secret'))
  }))
}));

const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    on: jest.fn()
  }))
}));

// Set NODE_ENV to test to trigger the app export
process.env.NODE_ENV = 'test';
const app = require('../index');

describe('API Integration Basics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    test('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, cloud: true });
    });
  });

  describe('POST /v1/webhooks/jira', () => {
    test('should reject request without token', async () => {
      const res = await request(app).post('/v1/webhooks/jira');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Missing webhook token');
    });

    test('should verify token and upsert track', async () => {
      const mockProject = {
        id: 1,
        workspace_id: 1,
        config: { webhookToken: 'valid-token' }
      };

      // Mock DB: 1. Token lookup
      mockQuery.mockResolvedValueOnce({ rows: [mockProject] });
      // Mock DB: 2. Track upsert
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const payload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'PROJ-1',
          fields: {
            summary: 'Test summary',
            labels: ['ai-task'],
            status: { name: 'To Do' }
          }
        }
      };

      const res = await request(app)
        .post('/v1/webhooks/jira?token=valid-token')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('should reject invalid token', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/v1/webhooks/jira?token=bad-token')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook token');
    });
  });
});
