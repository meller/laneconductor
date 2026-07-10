/**
 * Structured logger for the LaneConductor Collector API (Track 1075).
 *
 * Same shape as conductor/services/logger.mjs (the worker's logger) — fans
 * out to stdout (unchanged, still captured into ui/.api.log by bin/lc.mjs's
 * spawn redirect) and to a standalone `pinorama --server` instance via
 * pinorama-transport, tagged `component: "api"` so both processes' logs are
 * distinguishable in the same Pinorama Studio session.
 */
import pino from 'pino';
import pinoramaTransport from 'pinorama-transport';

const PINORAMA_URL = process.env.LC_PINORAMA_URL || 'http://localhost:6201/pinorama';

const pinoramaStream = pinoramaTransport({ url: PINORAMA_URL });
pinoramaStream.on('error', (err) => {
  process.stderr.write(`[logger] pinorama-transport error: ${err.message}\n`);
});

export const logger = pino(
  { base: { component: 'api' } },
  pino.multistream([
    { stream: process.stdout },
    { stream: pinoramaStream },
  ]),
);
