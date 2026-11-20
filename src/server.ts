import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AppConfig, ChaosMode, OperationMode } from './types.js';
import { CHAOS_MODES } from './types.js';
import { loadConfig, redactedConfigSummary } from './config.js';
import { ContractRegistry } from './contracts/registry.js';
import { RuleCache } from './healer/cache.js';
import { HealEngine } from './healer/engine.js';
import { GeminiMapper } from './healer/llm.js';
import { MockMapper } from './healer/mock-llm.js';
import { GroqMapper } from './healer/groq-llm.js';
import { MetricsStore } from './metrics.js';
import { EventHub } from './events.js';
import { PrQueue } from './github/pr.js';
import { AlertManager } from './alerts/webhook.js';
import { createProxyHandler } from './proxy/handler.js';
import { isMain } from './util.js';

export interface BuildServerOptions {
  config?: AppConfig;
  contractsDir?: string;
  publicDir?: string;
  cacheFile?: string;
}

const chaosRequestSchema = z.object({ mode: z.enum(CHAOS_MODES) });
const modeRequestSchema = z.object({ mode: z.enum(['active', 'canary', 'shadow']) });

function readJsonBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const contractsDir = options.contractsDir ?? resolve('contracts');
  const publicDir = options.publicDir ?? resolve('public');
  const cacheFile = options.cacheFile ?? join(resolve(config.dataDir), 'rules.json');

  await mkdir(resolve(config.dataDir), { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const registry = ContractRegistry.load(contractsDir);
  const cache = new RuleCache(cacheFile);
  await cache.load();

  const metrics = new MetricsStore();
  const events = new EventHub();
  const alertManager = new AlertManager();
  let operationMode: OperationMode = 'active';

  // Google AI Gemini given first-class primary priority
  const mapper =
    config.llmMode === 'live'
      ? config.geminiApiKey
        ? new GeminiMapper({
            apiKey: config.geminiApiKey,
            model: config.geminiModel ?? 'gemini-2.0-flash',
            timeoutMs: config.llmTimeoutMs,
          })
        : config.groqApiKey
          ? new GroqMapper({
              apiKey: config.groqApiKey,
              model: config.groqModel,
              timeoutMs: config.llmTimeoutMs,
            })
          : new MockMapper()
      : new MockMapper();
  const engine = new HealEngine({
    cache,
    mapper,
    metrics,
    minConfidence: config.minConfidence,
  });
  const prQueue = new PrQueue({ config, events, metrics });

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  let chaosMode: ChaosMode = 'none';
  let upstreamOk = false;
  let lastProbe = 0;
  const startedAt = new Date().toISOString();

  const snapshotState = () => {
    const summary = redactedConfigSummary(config);
    return {
      status: 'ok' as const,
      version: '1.0.0',
      startedAt,
      operationMode,
      llmMode: summary.llmMode,
      llmModel: summary.llmModel,
      geminiConfigured: summary.geminiConfigured,
      groqConfigured: summary.groqConfigured,
      githubConfigured: summary.githubConfigured,
      prEnabled: summary.prEnabled,
      minConfidence: summary.minConfidence,
      upstreamUrl: config.upstreamBaseUrl,
      upstreamOk,
      chaosMode,
      contracts: registry.size,
      rulesCount: cache.size,
      latestPr: prQueue.latestJob,
      metrics: metrics.snapshot(),
      alertsCount: alertManager.getAlerts().length,
      learnMode: registry.isLearnMode(),
      learnedCount: registry.getLearnedContracts().length,
    };
  };

  const refreshUpstream = async (): Promise<void> => {
    if (Date.now() - lastProbe < 1500) return;
    lastProbe = Date.now();
    try {
      const response = await fetch(`${config.upstreamBaseUrl}/__control/chaos`, {
        signal: AbortSignal.timeout(800),
      });
      if (!response.ok) throw new Error(`upstream health ${response.status}`);
      const data = (await response.json()) as { mode?: string };
      if (typeof data.mode === 'string' && (CHAOS_MODES as readonly string[]).includes(data.mode)) {
        chaosMode = data.mode as ChaosMode;
      }
      upstreamOk = true;
    } catch {
      upstreamOk = false;
    }
  };

  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const buffer = body as Buffer;
      request.rawBody = buffer;
      const text = buffer.toString('utf8');
      if (text.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch {
        done(null, buffer);
      }
    },
  );
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body as Buffer;
    done(null, body);
  });

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, { root: publicDir, prefix: '/' });

  const clients = new Set<WebSocket>();

  const unsubscribe = events.subscribe((event) => {
    const payload = JSON.stringify(event);
    for (const socket of clients) {
      if (socket.readyState === 1) {
        try {
          socket.send(payload);
        } catch {
          clients.delete(socket);
        }
      }
    }
  });

  app.get('/__autopatch/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    try {
      socket.send(JSON.stringify({ type: 'state', state: snapshotState() }));
    } catch {
      // The client disconnected before the initial snapshot was written.
    }
    const heartbeat = setInterval(() => {
      if (socket.readyState === 1) socket.ping();
    }, 30000);
    socket.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(socket);
    });
    socket.on('error', () => {
      clearInterval(heartbeat);
      clients.delete(socket);
    });
  });

  app.get('/__autopatch/health', async () => ({ ok: true }));

  app.get('/__autopatch/api/state', async () => {
    await refreshUpstream();
    return snapshotState();
  });

  app.get('/__autopatch/api/rules', async () =>
    cache.list().map((entry) => ({
      endpoint: entry.endpoint,
      method: entry.method,
      fingerprint: entry.fingerprint,
      createdAt: entry.createdAt,
      llmMode: entry.llmMode,
      model: entry.model,
      confidence: entry.rule.confidence,
      rule: entry.rule,
    })),
  );

  app.post('/__autopatch/api/chaos', async (request, reply) => {
    const parsed = chaosRequestSchema.safeParse(readJsonBody(request.body));
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_CHAOS_MODE',
        message: `mode must be one of: ${CHAOS_MODES.join(', ')}`,
      });
    }

    const mode = parsed.data.mode;
    try {
      const response = await fetch(`${config.upstreamBaseUrl}/__control/chaos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`upstream responded ${response.status}`);
      chaosMode = mode;
      upstreamOk = true;
      events.emit({ type: 'chaos', ts: new Date().toISOString(), mode });
      return { ok: true, mode };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      upstreamOk = false;
      return reply.code(502).send({
        error: 'UPSTREAM_UNREACHABLE',
        message: `Could not change the upstream scenario: ${message}`,
      });
    }
  });

  app.post('/__autopatch/api/cache/clear', async () => {
    cache.clear();
    events.emit({ type: 'metrics', ts: new Date().toISOString(), metrics: metrics.snapshot() });
    return { ok: true, rulesCount: cache.size };
  });

  app.post('/__autopatch/api/metrics/reset', async () => {
    metrics.reset();
    events.emit({ type: 'metrics', ts: new Date().toISOString(), metrics: metrics.snapshot() });
    return { ok: true };
  });

  app.post('/__autopatch/api/pr/retry', async (_request, reply) => {
    const result = prQueue.retryLatest();
    if (!result.ok) {
      return reply.code(409).send({ error: 'NO_PR_JOB', message: result.error });
    }
    return { ok: true };
  });

  // Enterprise Operation Mode: Active / Canary / Shadow
  app.get('/__autopatch/api/mode', async () => ({ mode: operationMode }));
  app.post('/__autopatch/api/mode', async (request, reply) => {
    const parsed = modeRequestSchema.safeParse(readJsonBody(request.body));
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_MODE', message: 'Mode must be active, canary, or shadow' });
    }
    operationMode = parsed.data.mode;
    events.emit({ type: 'state', ts: new Date().toISOString(), state: snapshotState() } as never);
    return { ok: true, mode: operationMode };
  });

  // Human-in-the-Loop Webhook & Incident Alerts
  app.get('/__autopatch/api/alerts', async () => alertManager.getAlerts());
  app.post('/__autopatch/api/alerts/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const alert = alertManager.approveAlert(id);
    if (!alert) return reply.code(404).send({ error: 'ALERT_NOT_FOUND' });
    return { ok: true, alert };
  });
  app.post('/__autopatch/api/alerts/test', async () => {
    const alert = alertManager.createDriftAlert({
      endpoint: '/api/v1/checkout/user',
      method: 'GET',
      diffSummary: 'user_id -> id; contact.email_addr -> email',
      confidence: 0.94,
      gatesPassed: '5/5 Gates Passed',
      prUrl: 'https://github.com/CodersOfBharat/autopatch/pull/42',
      severity: 'info',
    });
    return { ok: true, alert };
  });

  // Traffic Auto-Profiling (Zero-Config Schema Learning)
  app.get('/__autopatch/api/learn', async () => ({
    enabled: registry.isLearnMode(),
    contracts: registry.getLearnedContracts(),
  }));
  app.post('/__autopatch/api/learn/lock', async (request, reply) => {
    const body = readJsonBody(request.body) as { method?: string; endpoint?: string };
    if (!body?.method || !body?.endpoint) {
      return reply.code(400).send({ error: 'MISSING_PARAMS', message: 'method and endpoint required' });
    }
    const contract = registry.lockLearned(body.method, body.endpoint);
    if (!contract) return reply.code(404).send({ error: 'NO_LEARNED_CONTRACT' });
    return { ok: true, contract };
  });
  app.post('/__autopatch/api/learn/toggle', async () => {
    const nextState = !registry.isLearnMode();
    registry.setLearnMode(nextState);
    return { ok: true, enabled: nextState };
  });

  const proxyHandler = createProxyHandler({
    upstreamBaseUrl: config.upstreamBaseUrl,
    registry,
    engine,
    metrics,
    events,
    prQueue,
    alertManager,
    getOperationMode: () => operationMode,
  });

  app.all('/api/*', proxyHandler);

  app.get('/console', async (_request, reply) => reply.sendFile('console.html'));
  app.get('/console/', async (_request, reply) => reply.sendFile('console.html'));
  app.get('/demo', async (_request, reply) => reply.sendFile('demo.html'));
  app.get('/demo/', async (_request, reply) => reply.sendFile('demo.html'));
  app.get('/home', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/', async (_request, reply) => reply.sendFile('index.html'));

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    console.error(`[autopatch] ${request.method} ${request.url}: ${error.message}`);
    return reply.code(error.statusCode ?? 500).send({
      error: 'AUTOPATCH_INTERNAL',
      message: error.message,
    });
  });

  app.addHook('onClose', async () => {
    unsubscribe();
    for (const socket of clients) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    clients.clear();
    await cache.flush();
  });

  return app;
}

export async function startServer(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = await buildServer({ config });
  await app.listen({ port: config.port, host: '127.0.0.1' });
  const summary = redactedConfigSummary(config);

  console.log(
    `[autopatch] listening on http://127.0.0.1:${config.port} · LLM: ${summary.llmMode} (${summary.groqConfigured ? 'groq' : summary.geminiConfigured ? 'gemini' : 'not configured'}) · upstream: ${config.upstreamBaseUrl}`,
  );
  if (config.llmMode === 'live' && !summary.groqConfigured && !summary.geminiConfigured) {
    console.warn(
      '[autopatch] LLM_MODE=live but neither GROQ_API_KEY nor GEMINI_API_KEY/GEMINI_MODEL are configured; cold heals will fail with LLM_NOT_CONFIGURED.',
    );
  }
  if (config.prEnabled && !summary.githubConfigured) {
    console.warn(
      '[autopatch] PR_ENABLED=true but GitHub credentials are incomplete; PR jobs will fail with the real error.',
    );
  }
  if (!config.prEnabled) {
    console.log('[autopatch] PR generation is disabled (PR_ENABLED=false). Auto-PR shows the honest failure.');
  }

  return app;
}

if (isMain(import.meta.url)) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[autopatch] failed to start: ${message}`);
    process.exitCode = 1;
  });
}
