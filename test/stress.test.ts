import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildMockServer, type MockServer } from '../src/mock-upstream/server.js';
import { buildServer } from '../src/server.js';
import { fingerprint } from '../src/healer/fingerprint.js';
import { sanitize } from '../src/healer/sanitizer.js';
import { verifyRule } from '../src/healer/rule.js';
import { MetricsStore } from '../src/metrics.js';

describe('Production Stress, Concurrency & Security Hardening Suite', () => {
  let app: FastifyInstance;
  let mock: MockServer;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'autopatch-stress-'));
    mock = await buildMockServer('none');
    await mock.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = mock.app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Mock server failed to bind');

    const config = loadConfig({
      UPSTREAM_BASE_URL: `http://127.0.0.1:${addr.port}`,
      DATA_DIR: dataDir,
      LLM_MODE: 'mock',
      PR_ENABLED: 'false',
    });

    app = await buildServer({
      config,
      contractsDir: resolve('contracts'),
      publicDir: resolve('public'),
      cacheFile: join(dataDir, 'rules.json'),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await mock?.app.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('survives a 200-request concurrent thundering herd on cold drift with single-flight deduplication', async () => {
    await app.inject({ method: 'POST', url: '/__autopatch/api/cache/clear' });
    await app.inject({ method: 'POST', url: '/__autopatch/api/metrics/reset' });
    mock.setMode('combo_v2');

    const concurrency = 200;
    const responses = await Promise.all(
      Array.from({ length: concurrency }, () =>
        app.inject({ method: 'GET', url: '/api/v1/checkout/user' }),
      ),
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.user_id).toBe('usr_99');
      expect(body.email).toBe('dev@acme.io');
      expect(body.account_balance).toBe(450.5);
      expect(body.is_verified).toBe(true);
    }

    const stateRes = await app.inject({ method: 'GET', url: '/__autopatch/api/state' });
    const state = stateRes.json() as { metrics: { llmCalls: number; requests: number } };
    // Single-flight lock ensures at most 1 cold LLM call despite 200 simultaneous requests
    expect(state.metrics.llmCalls).toBe(1);
    expect(state.metrics.requests).toBe(concurrency);
  });

  it('handles 300 rapid cached requests across all drift scenarios with zero errors', async () => {
    const modes = ['rename', 'nest', 'type_mismatch', 'array_wrap', 'date_shift', 'combo_v2'] as const;
    for (const mode of modes) {
      mock.setMode(mode);
      const batch = await Promise.all(
        Array.from({ length: 50 }, () =>
          app.inject({ method: 'GET', url: '/api/v1/checkout/user' }),
        ),
      );
      for (const res of batch) {
        expect(res.statusCode).toBe(200);
      }
    }
    mock.setMode('none');
  });

  it('bounds MetricsStore sample arrays to prevent memory leaks under 5,000+ requests', () => {
    const store = new MetricsStore();
    for (let i = 0; i < 5000; i++) {
      store.recordVerified(0.12);
      store.recordHealed(true, 0.14);
      store.recordHealed(false, 410);
    }
    const snap = store.snapshot();
    expect(snap.requests).toBe(15000);
    expect(snap.verifiedOverhead.count).toBeLessThanOrEqual(1000);
    expect(snap.cachedHeal.count).toBeLessThanOrEqual(1000);
    expect(snap.coldHeal.count).toBeLessThanOrEqual(1000);
  });

  it('disambiguates data_id vs user_id accurately and blocks single-ID collisions at Gate 5', async () => {
    // Case A: Both data_id (record_id) and user_id (customer.uid) present -> mapped distinctly
    const bothPresent = await app.inject({
      method: 'POST',
      url: '/__autopatch/api/studio/heal',
      payload: {
        method: 'POST',
        endpoint: '/api/v1/records/sync',
        sampleBaseline: {
          data_id: 'dat_5001',
          user_id: 'usr_99',
          amount: 250.5,
        },
        driftedPayload: {
          record_id: 'dat_5001',
          customer: {
            uid: 'usr_99',
          },
          total: '250.50',
        },
        installContract: false,
      },
    });
    expect(bothPresent.statusCode).toBe(200);
    const bodyA = bothPresent.json() as { ok: boolean; after: Record<string, unknown> };
    expect(bodyA.ok).toBe(true);
    expect(bodyA.after).toEqual({
      data_id: 'dat_5001',
      user_id: 'usr_99',
      amount: 250.5,
    });

    // Case B: Only data_id present, user_id missing -> must NOT copy data_id into user_id (502 Fail-Closed)
    const missingUserId = await app.inject({
      method: 'POST',
      url: '/__autopatch/api/studio/heal',
      payload: {
        method: 'POST',
        endpoint: '/api/v1/records/sync-broken',
        sampleBaseline: {
          data_id: 'dat_5001',
          user_id: 'usr_99',
        },
        driftedPayload: {
          record_id: 'dat_5001',
        },
        installContract: false,
      },
    });
    expect(missingUserId.statusCode).toBe(502);
    const bodyB = missingUserId.json() as { ok: boolean; missingFields: string[] };
    expect(bodyB.ok).toBe(false);
    expect(bodyB.missingFields).toContain('user_id');

    // Case C: Direct Gate 5 check rejects any rule that maps two required fields to the same source path
    const duplicateRuleCheck = verifyRule({
      rule: {
        fields: {
          data_id: { from: 'id', coerce: 'none' },
          user_id: { from: 'id', coerce: 'none' },
        },
        unmappable: [],
        confidence: 0.95,
        reasoning: 'Duplicate source test',
      },
      contract: {
        method: 'GET',
        endpoint: '/api/v1/test',
        expected_schema: {
          data_id: 'string',
          user_id: 'string',
        },
      },
      payload: { id: 'single_123' },
      minConfidence: 0.7,
    });
    expect(duplicateRuleCheck.ok).toBe(false);
    expect(duplicateRuleCheck.errors.some((e) => e.includes('Gate 5: duplicate source path'))).toBe(
      true,
    );
  });

  it('survives 60-level deep JSON nesting bombs and prototype pollution payloads without 500 crashes', async () => {
    let deep: Record<string, unknown> = { leaf: 'val' };
    for (let i = 0; i < 60; i++) {
      deep = { nested: deep };
    }
    expect(() => fingerprint(deep)).not.toThrow();
    expect(() => sanitize(deep)).not.toThrow();

    // Fuzz control endpoints with malformed / hostile inputs
    const hostilePayloads = [
      null,
      'not-an-object',
      12345,
      [1, 2, 3],
      { method: 123, endpoint: 456 },
      { method: 'POST', endpoint: '/api/test', samplePayload: [1, 2, 3] },
      { method: 'POST', endpoint: '/api/test', expected_schema: { __proto__: 'string' } },
      { method: 'POST', endpoint: '/api/test', driftedPayload: null },
      { method: 'POST', endpoint: '/api/test', driftedPayload: 'primitive', sampleBaseline: {} },
    ];

    for (const payload of hostilePayloads) {
      const r1 = await app.inject({
        method: 'POST',
        url: '/__autopatch/api/contracts',
        payload: payload as Record<string, unknown>,
      });
      expect(r1.statusCode).toBeLessThan(500);

      const r2 = await app.inject({
        method: 'POST',
        url: '/__autopatch/api/learn/sample',
        payload: payload as Record<string, unknown>,
      });
      expect(r2.statusCode).toBeLessThan(500);

      const r3 = await app.inject({
        method: 'POST',
        url: '/__autopatch/api/learn/lock',
        payload: payload as Record<string, unknown>,
      });
      expect(r3.statusCode).toBeLessThan(500);

      const r4 = await app.inject({
        method: 'POST',
        url: '/__autopatch/api/studio/heal',
        payload: payload as Record<string, unknown>,
      });
      expect(r4.statusCode).toBeLessThan(500);
    }
  });
});
