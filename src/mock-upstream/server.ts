import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChaosMode } from '../types.js';
import { CHAOS_MODES, payloadFor } from './scenarios.js';
import { loadConfig } from '../config.js';
import { isMain } from '../util.js';

export interface MockServer {
  app: FastifyInstance;
  setMode(mode: ChaosMode): void;
  getMode(): ChaosMode;
}

const modeSchema = z.object({ mode: z.enum(CHAOS_MODES) });

function readMode(body: unknown): ChaosMode | null {
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  const parsed =
    typeof raw === 'string' ? (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    })() : raw;
  const result = modeSchema.safeParse(parsed);
  return result.success ? result.data.mode : null;
}

export async function buildMockServer(initialMode: ChaosMode = 'none'): Promise<MockServer> {
  let mode: ChaosMode = initialMode;
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.options('/*', async (_request, reply) => reply.code(204).send());

  app.get('/api/v1/checkout/user', async (_request, reply) => {
    return reply.header('content-type', 'application/json; charset=utf-8').send(payloadFor(mode));
  });

  app.get('/__control/chaos', async () => ({ mode }));

  app.post('/__control/chaos', async (request, reply) => {
    const nextMode = readMode(request.body);
    if (!nextMode) {
      return reply.code(400).send({
        error: 'INVALID_CHAOS_MODE',
        message: `mode must be one of: ${CHAOS_MODES.join(', ')}`,
      });
    }
    mode = nextMode;
    return { ok: true, mode };
  });

  app.get('/__control/health', async () => ({ ok: true, mode }));

  return {
    app,
    setMode(next: ChaosMode) {
      mode = next;
    },
    getMode() {
      return mode;
    },
  };
}

export async function startMockServer(port: number): Promise<MockServer> {
  const mock = await buildMockServer();
  await mock.app.listen({ port, host: '127.0.0.1' });
  return mock;
}

if (isMain(import.meta.url)) {
  const config = loadConfig();
  startMockServer(config.mockUpstreamPort)
    .then(() => {
      console.log(
        `[mock-upstream] listening on http://127.0.0.1:${config.mockUpstreamPort} · GET /api/v1/checkout/user`,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mock-upstream] failed to start: ${message}`);
      process.exitCode = 1;
    });
}
