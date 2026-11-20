import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildServer, ensureEmbeddedUpstream } from '../src/server.js';

let appPromise: Promise<FastifyInstance> | null = null;

async function getReadyApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig();
      await ensureEmbeddedUpstream(config);
      const instance = await buildServer({ config });
      await instance.ready();
      return instance;
    })();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getReadyApp();
  app.server.emit('request', req, res);
}
