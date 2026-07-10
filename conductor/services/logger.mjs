/**
 * Structured logger for the LaneConductor heartbeat worker (Track 1075).
 *
 * Fans out to (a) stdout — unchanged from today, still captured into
 * conductor/.sync.log by bin/lc.mjs's spawn redirect — and (b) a standalone
 * `pinorama --server` instance via pinorama-transport, for live viewing.
 *
 * The worker is a detached background daemon (not a single foreground
 * process), so it can't use Pinorama's documented `node app.js | pinorama`
 * pipe pattern — that's why this ships logs over HTTP instead. See
 * conductor/tracks/1075-pino-logging-worker-and-ui/spec.md for the full
 * reasoning, including why this must run on a different port/storage path
 * than any managed project's own Pinorama instance.
 *
 * If the standalone Pinorama service isn't running, pinorama-transport just
 * logs its own delivery failures to stderr and keeps buffering/retrying —
 * it does not throw or block application logging.
 */
import pino from 'pino';
import pinoramaTransport from 'pinorama-transport';

const PINORAMA_URL = process.env.LC_PINORAMA_URL || 'http://localhost:6201/pinorama';

const pinoramaStream = pinoramaTransport({ url: PINORAMA_URL });
pinoramaStream.on('error', (err) => {
  process.stderr.write(`[logger] pinorama-transport error: ${err.message}\n`);
});

export const logger = pino(
  { base: { component: 'worker' } },
  pino.multistream([
    { stream: process.stdout },
    { stream: pinoramaStream },
  ]),
);
