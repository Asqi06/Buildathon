import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { loadConfig } from '../src/config.js';
import { ContractRegistry } from '../src/contracts/registry.js';
import { validateContract } from '../src/contracts/validator.js';
import { buildMockServer, type MockServer } from '../src/mock-upstream/server.js';
import { BASELINE_PAYLOAD } from '../src/mock-upstream/scenarios.js';
import { buildServer } from '../src/server.js';
import type { ChaosMode } from '../src/types.js';

const registry = ContractRegistry.load(resolve('contracts'));
const contract = registry.match('GET', '/api/v1/checkout/user');

if (!contract) {
  throw new Error('The checkout contract is missing from contracts/');
}

interface StateView {
  rulesCount: number;
  upstreamOk: boolean;
  chaosMode: ChaosMode;
  metrics: {
    requests: number;
    verified: number;
    healedCold: number;
    healedCached: number;
    unrecoverable: number;
    llmCalls: number;
    llmCallsSaved: number;
  };
  latestPr: { state: string; error: string | null } | null;
}

interface FailureBody {
  error: string;
  reason: string;
  message: string;
  missingFields: string[];
  signature: string;
  diagnostics: string[];
}

interface RuleView {
  endpoint: string;
  method: string;
  fingerprint: string;
  confidence: number;
  rule: unknown;
  llmMode: string;
}

interface Frame {
  type: string;
  status?: string;
}

const healableModes: ChaosMode[] = [
  'rename',
  'nest',
  'type_mismatch',
  'array_wrap',
  'date_shift',
  'combo_v2',
];

let app: FastifyInstance;
let mock: MockServer;
let dataDirectory = '';

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 4000) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function readState(): Promise<StateView> {
  const response = await app.inject({ method: 'GET', url: '/__autopatch/api/state' });
  expect(response.statusCode).toBe(200);
  return response.json() as StateView;
}

async function waitForState(
  predicate: (state: StateView) => boolean,
  label: string,
): Promise<StateView> {
  const started = Date.now();
  while (true) {
    const state = await readState();
    if (predicate(state)) return state;
    if (Date.now() - started > 4000) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function proxy(mode?: ChaosMode) {
  if (mode) mock.setMode(mode);
  return app.inject({ method: 'GET', url: '/api/v1/checkout/user' });
}

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'autopatch-integration-'));
  mock = await buildMockServer('none');
  await mock.app.listen({ port: 0, host: '127.0.0.1' });
  const address = mock.app.server.address();
  if (!address || typeof address === 'string') throw new Error('mock upstream did not bind');

  const config = loadConfig({
    UPSTREAM_BASE_URL: `http://127.0.0.1:${address.port}`,
    DATA_DIR: dataDirectory,
    LLM_MODE: 'mock',
    PR_ENABLED: 'false',
    GITHUB_TOKEN: '',
    GITHUB_OWNER: '',
    GITHUB_REPO: '',
  });

  app = await buildServer({
    config,
    contractsDir: resolve('contracts'),
    publicDir: resolve('public'),
    cacheFile: join(dataDirectory, 'rules.json'),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await mock?.app.close();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

describe('AutoPatch integration', () => {
  it('verifies the baseline and forwards it unchanged', async () => {
    const response = await proxy('none');
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-autopatch-status']).toBe('verified');
    expect(response.headers['x-autopatch-overhead-ms']).toMatch(/^\d+(?:\.\d+)?$/);
    expect(response.json()).toEqual(BASELINE_PAYLOAD);
    expect(validateContract(response.json(), contract)).toMatchObject({ valid: true });
  });

  it('heals every supported drift and returns the baseline contract shape', async () => {
    for (const mode of healableModes) {
      const response = await proxy(mode);
      expect(response.statusCode, mode).toBe(200);
      expect(response.headers['x-autopatch-status'], mode).toBe('healed');
      const body = response.json() as unknown;
      expect(validateContract(body, contract), mode).toMatchObject({
        valid: true,
        missing: [],
        wrongTypes: [],
      });
    }

    const state = await readState();
    expect(state.metrics.llmCalls).toBeGreaterThanOrEqual(healableModes.length);
    expect(state.metrics.healedCold).toBeGreaterThanOrEqual(healableModes.length);
    expect(state.rulesCount).toBeGreaterThanOrEqual(healableModes.length);
  });

  it('reports the honest PR failure when GitHub configuration is absent', async () => {
    const state = await waitForState(
      (snapshot) => snapshot.latestPr?.state === 'failed',
      'the failed PR job',
    );
    expect(state.latestPr?.error).toContain('PR_ENABLED=true');
    expect(state.latestPr?.error).toContain('GITHUB_TOKEN');
  });

  it('serves repeated drift from the cached rule without another LLM call', async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await proxy('combo_v2');
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-autopatch-status']).toBe('healed-cached');
      expect(validateContract(response.json(), contract).valid).toBe(true);
    }

    const state = await readState();
    expect(state.metrics.llmCallsSaved).toBeGreaterThanOrEqual(5);
  });

  it('fails loudly with 502 and never fabricates the deleted field', async () => {
    const response = await proxy('field_deleted');
    expect(response.statusCode).toBe(502);
    expect(response.headers['x-autopatch-status']).toBe('unrecoverable');

    const body = response.json() as FailureBody;
    expect(body.error).toBe('AUTOPATCH_UNRECOVERABLE');
    expect(body.reason).toBe('RULE_VERIFICATION_FAILED');
    expect(body.missingFields).toContain('email');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(body.diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('dev@acme.io');

    const state = await readState();
    expect(state.metrics.unrecoverable).toBeGreaterThanOrEqual(1);
  });

  it('passes unknown routes through without a contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/not-contracted' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-autopatch-status']).toBe('passthrough');
  });

  it('validates chaos commands and records the scenario', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/__autopatch/api/chaos',
      payload: { mode: 'explode' },
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: string }).error).toBe('INVALID_CHAOS_MODE');

    const valid = await app.inject({
      method: 'POST',
      url: '/__autopatch/api/chaos',
      payload: { mode: 'rename' },
    });
    expect(valid.statusCode).toBe(200);
    expect(mock.getMode()).toBe('rename');

    const state = await readState();
    expect(state.upstreamOk).toBe(true);
    expect(state.chaosMode).toBe('rename');
    mock.setMode('none');
  });

  it('clears the cache and performs a real cold heal afterwards', async () => {
    const before = await readState();
    const cleared = await app.inject({
      method: 'POST',
      url: '/__autopatch/api/cache/clear',
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { rulesCount: number }).rulesCount).toBe(0);

    const response = await proxy('combo_v2');
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-autopatch-status']).toBe('healed');

    const after = await readState();
    expect(after.metrics.llmCalls).toBeGreaterThan(before.metrics.llmCalls);
    expect(after.rulesCount).toBeGreaterThan(0);

    const rules = await app.inject({ method: 'GET', url: '/__autopatch/api/rules' });
    expect(rules.statusCode).toBe(200);
    const entries = rules.json() as RuleView[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({
      endpoint: '/api/v1/checkout/user',
      method: 'GET',
      llmMode: 'mock',
    });
    expect(entries[0]?.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it('serves the console, the demo and their assets', async () => {
    const consolePage = await app.inject({ method: 'GET', url: '/console' });
    expect(consolePage.statusCode).toBe(200);
    expect(consolePage.body).toContain('AutoPatch');
    expect(consolePage.body).toContain('/console.js');

    const demoPage = await app.inject({ method: 'GET', url: '/demo' });
    expect(demoPage.statusCode).toBe(200);
    expect(demoPage.body).toContain('Acme Billing');
    expect(demoPage.body).toContain('/demo.js');

    for (const asset of ['/styles.css', '/console.js', '/demo.css', '/demo.js']) {
      const response = await app.inject({ method: 'GET', url: asset });
      expect(response.statusCode, asset).toBe(200);
      expect(response.body.length, asset).toBeGreaterThan(100);
    }

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('AutoPatch');
  });

  it('streams the initial state and request events over WebSocket', async () => {
    const frames: Frame[] = [];
    const socket: WebSocket = await app.injectWS(
      '/__autopatch/ws',
      {},
      {
        onInit(ws) {
          ws.on('message', (data) => {
            frames.push(JSON.parse(data.toString()) as Frame);
          });
        },
      },
    );

    await waitFor(() => frames.length > 0, 'initial WebSocket state');
    expect(frames[0]?.type).toBe('state');

    mock.setMode('none');
    await app.inject({ method: 'GET', url: '/api/v1/checkout/user' });
    await waitFor(
      () => frames.some((frame) => frame.type === 'request' && frame.status === 'VERIFIED'),
      'request event',
    );

    socket.close();
  });
});
