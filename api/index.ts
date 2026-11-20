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
  if (req.url && req.url.startsWith('/api/index')) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const originalPath = parsed.searchParams.get('__ap_path');
      if (originalPath) {
        parsed.searchParams.delete('__ap_path');
        const restQuery = parsed.searchParams.toString();
        req.url = restQuery ? `${originalPath}?${restQuery}` : originalPath;
      }
    } catch {
      // Keep req.url as-is
    }
  }
  const app = await getReadyApp();
  app.server.emit('request', req, res);
}
