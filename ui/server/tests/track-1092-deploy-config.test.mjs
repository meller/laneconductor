// ui/server/tests/track-1092-deploy-config.test.mjs
// Track 1092: Deploy Configuration API endpoints tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import * as fs from 'fs';

vi.mock('../auth.mjs');

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('Deploy Configuration API (/api/projects/:id/deploy-config)', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('GET /api/projects/:id/deploy-config', () => {
    it('returns 404 when project is not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/projects/999/deploy-config').expect(404);
      expect(res.body.error).toMatch(/project not found/i);
    });

    it('returns empty environments object when deploy.json does not exist', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/projects/1/deploy-config').expect(200);
      expect(res.body).toEqual({ environments: {} });
    });

    it('returns parsed deploy.json content when file exists', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockConfig = {
        environments: {
          staging: { command: 'npm run deploy:staging' },
          prod: { commands: ['npm run build', 'npm run deploy:prod'] },
        },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const res = await request(app).get('/api/projects/1/deploy-config').expect(200);
      expect(res.body).toEqual(mockConfig);
    });
  });

  describe('POST /api/projects/:id/deploy-config', () => {
    it('returns 404 when project is not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post('/api/projects/999/deploy-config')
        .send({ environments: {} })
        .expect(404);
      expect(res.body.error).toMatch(/project not found/i);
    });

    it('returns 400 when environments field is missing or not an object', async () => {
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ repo_path: '/dummy/repo' }] });

      await request(app)
        .post('/api/projects/1/deploy-config')
        .send({})
        .expect(400);

      await request(app)
        .post('/api/projects/1/deploy-config')
        .send({ environments: 'invalid' })
        .expect(400);
    });

    it('returns 400 when an environment entry is missing command / commands', async () => {
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ repo_path: '/dummy/repo' }] });

      const res = await request(app)
        .post('/api/projects/1/deploy-config')
        .send({
          environments: {
            prod: { description: 'Missing command' },
          },
        })
        .expect(400);

      expect(res.body.error).toMatch(/must have a command string or commands array/i);
    });

    it('successfully saves valid config to conductor/deploy.json', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const validPayload = {
        environments: {
          staging: { command: 'bash deploy.sh staging', description: 'Staging Server' },
          prod: { commands: ['echo 1', 'echo 2'] },
        },
      };

      const res = await request(app)
        .post('/api/projects/1/deploy-config')
        .send(validPayload)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.environments).toEqual(validPayload.environments);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('deploy.json'),
        JSON.stringify(validPayload, null, 2) + '\n',
        'utf8'
      );
    });

    it('returns 400 when defaultEnvironment does not exist in environments object', async () => {
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ repo_path: '/dummy/repo' }] });

      const res = await request(app)
        .post('/api/projects/1/deploy-config')
        .send({
          defaultEnvironment: 'nonexistent',
          environments: {
            prod: { command: 'bash deploy.sh prod' },
          },
        })
        .expect(400);

      expect(res.body.error).toMatch(/defaultEnvironment.*must match a configured environment/i);
    });

    it('successfully saves valid config with defaultEnvironment to conductor/deploy.json', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const validPayload = {
        defaultEnvironment: 'prod',
        environments: {
          staging: { command: 'bash deploy.sh staging', description: 'Staging Server' },
          prod: { commands: ['echo 1', 'echo 2'] },
        },
      };

      const res = await request(app)
        .post('/api/projects/1/deploy-config')
        .send(validPayload)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.defaultEnvironment).toBe('prod');
      expect(res.body.environments).toEqual(validPayload.environments);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('deploy.json'),
        JSON.stringify(validPayload, null, 2) + '\n',
        'utf8'
      );
    });

    it('creates conductor directory if it does not exist before writing deploy.json', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const validPayload = {
        environments: {
          prod: { command: 'bash deploy.sh prod' },
        },
      };

      await request(app)
        .post('/api/projects/1/deploy-config')
        .send(validPayload)
        .expect(200);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('conductor'),
        { recursive: true }
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('GET /api/projects/:id/deploy-environments', () => {
    it('returns empty environments list and null defaultEnvironment when file does not exist', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const res = await request(app).get('/api/projects/1/deploy-environments').expect(200);
      expect(res.body).toEqual({ environments: [], defaultEnvironment: null });
    });

    it('returns environments list and defaultEnvironment when configured', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/dummy/repo' }] });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockConfig = {
        defaultEnvironment: 'production',
        environments: {
          production: { command: 'npm run deploy' },
          staging: { command: 'npm run deploy:staging' },
        },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const res = await request(app).get('/api/projects/1/deploy-environments').expect(200);
      expect(res.body).toEqual({
        environments: ['production', 'staging'],
        defaultEnvironment: 'production',
      });
    });
  });
});
