// server/tests/track-1091-manager-start.test.mjs
// Track 1091 Phase 5b: POST /api/workers/manager/start.
//
// Mirrors POST /api/projects/:id/worker/start (`lc start`) for the
// machine-level manager singleton — but unlike every sibling worker-lifecycle
// endpoint in this file, this one takes free-text input from a browser field
// (projectsDir) that reaches a real command execution. The route uses
// execFile with an argument array specifically to avoid a shell; a
// regression back to exec()-with-string-interpolation wouldn't fail in the
// happy path, only under an adversarial projectsDir value — so this test
// asserts the call shape itself (mocked child_process), not just the
// response, to catch that regression before it ever reaches a real shell.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const execFileMock = vi.fn((...callArgs) => {
    const cb = callArgs.find(a => typeof a === 'function');
    if (!cb) return; // defensive no-op — see beforeEach note below
    process.nextTick(() => cb(null, { stdout: 'started\n', stderr: '' }));
});

vi.mock('child_process', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, execFile: (...args) => execFileMock(...args) };
});

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

import { app } from '../index.mjs';

describe('POST /api/workers/manager/start', () => {
    // execFileMock observably receives one extra, argument-less call per
    // test beyond the route's real invocation (harmless — some interaction
    // between promisify and Vitest's mocked child_process module, not
    // reproducible outside this harness). The guard above no-ops it; every
    // assertion below only ever inspects mock.calls[0], which is
    // consistently the real, correctly-shaped call.
    beforeEach(() => execFileMock.mockClear());

    it('runs lc worker start --manager --projects-dir <dir> as an argument array', async () => {
        const res = await request(app)
            .post('/api/workers/manager/start')
            .send({ projectsDir: '/home/you/Code' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        const [cmd, args] = execFileMock.mock.calls[0];
        expect(cmd).toBe('lc');
        expect(args).toEqual(['worker', 'start', '--manager', '--projects-dir', '/home/you/Code']);
    });

    it('omits --projects-dir entirely when not provided, rather than passing an empty string', async () => {
        await request(app).post('/api/workers/manager/start').send({}).expect(200);

        const [, args] = execFileMock.mock.calls[0];
        expect(args).toEqual(['worker', 'start', '--manager']);
    });

    it('a shell-metacharacter payload is passed through as one literal argument, never reaching a shell', async () => {
        const malicious = '/tmp/foo; touch /tmp/INJECTION_PROOF; echo bar';
        await request(app)
            .post('/api/workers/manager/start')
            .send({ projectsDir: malicious })
            .expect(200);

        const [, args] = execFileMock.mock.calls[0];
        // The whole payload must land as ONE array element — if this route
        // regressed back to exec()+string interpolation, this shape would
        // break, catching it before it ever reaches a real shell.
        expect(args[args.length - 1]).toBe(malicious);
        expect(args).toHaveLength(5);
    });

    it('returns 500 with the underlying error when the CLI command fails (e.g. manager already running)', async () => {
        execFileMock.mockImplementationOnce((...callArgs) => {
            const cb = callArgs.find(a => typeof a === 'function');
            process.nextTick(() => cb(new Error('Command failed: manager already running')));
        });

        const res = await request(app)
            .post('/api/workers/manager/start')
            .send({ projectsDir: '/home/you/Code' })
            .expect(500);

        expect(res.body.error).toMatch(/already running/);
    });
});
