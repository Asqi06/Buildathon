import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Contract, MappingRule } from '../src/types.js';
import { RuleCache } from '../src/healer/cache.js';
import { HealEngine } from '../src/healer/engine.js';
import { fingerprint } from '../src/healer/fingerprint.js';
import { LlmError } from '../src/healer/llm.js';
import type { LlmMapper, MapperInput } from '../src/healer/mock-llm.js';
import { MetricsStore } from '../src/metrics.js';

const directories: string[] = [];
const caches: RuleCache[] = [];

const contract: Contract = {
  endpoint: '/api/v1/checkout/user',
  method: 'GET',
  expected_schema: {
    user_id: 'string',
    account_balance: 'number',
  },
};

const rule: MappingRule = {
  fields: {
    user_id: { from: 'id', coerce: 'none' },
    account_balance: { from: 'balance', coerce: 'number' },
  },
  unmappable: [],
  confidence: 0.95,
  reasoning: 'Straight rename plus numeric coercion.',
};

const payload = { id: 'usr_99', balance: '450.50' };

class StubMapper implements LlmMapper {
  readonly mode = 'mock' as const;
  readonly model = 'stub-mapper';
  calls = 0;

  constructor(
    private readonly nextRule: MappingRule,
    private readonly gate?: Promise<void>,
  ) {}

  async map(input: MapperInput): Promise<MappingRule> {
    this.calls += 1;
    input.onAttempt?.();
    if (this.gate) await this.gate;
    return this.nextRule;
  }
}

class TimeoutMapper implements LlmMapper {
  readonly mode = 'live' as const;
  readonly model = 'gemini-test';
  calls = 0;

  async map(input: MapperInput): Promise<MappingRule> {
    this.calls += 1;
    input.onAttempt?.();
    throw new LlmError('LLM_TIMEOUT', 'Gemini did not answer in time.', true);
  }
}

async function setup(mapper: LlmMapper): Promise<{
  engine: HealEngine;
  cache: RuleCache;
  metrics: MetricsStore;
  directory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'autopatch-engine-'));
  directories.push(directory);
  const cache = new RuleCache(join(directory, 'rules.json'));
  caches.push(cache);
  await cache.load();
  const metrics = new MetricsStore();
  const engine = new HealEngine({ cache, mapper, metrics, minConfidence: 0.7 });
  return { engine, cache, metrics, directory };
}

function healInput(): { method: string; endpoint: string; contract: Contract; payload: unknown } {
  return {
    method: 'GET',
    endpoint: '/api/v1/checkout/user',
    contract,
    payload: structuredClone(payload),
  };
}

afterEach(async () => {
  await Promise.all(caches.map((cache) => cache.flush()));
  caches.length = 0;
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories.length = 0;
});

describe('HealEngine', () => {
  it('cold-heals once, caches the rule and serves later requests from cache', async () => {
    const mapper = new StubMapper(rule);
    const { engine, cache, metrics } = await setup(mapper);

    const first = await engine.heal(healInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.cached).toBe(false);
    expect(first.after).toEqual({ user_id: 'usr_99', account_balance: 450.5 });
    expect(cache.size).toBe(1);
    expect(cache.list()[0]?.llmMode).toBe('mock');
    expect(metrics.snapshot().llmCalls).toBe(1);

    const second = await engine.heal(healInput());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.cached).toBe(true);
    expect(second.after).toEqual(first.after);
    expect(mapper.calls).toBe(1);
    expect(metrics.snapshot().llmCallsSaved).toBe(1);

    await cache.flush();
  });

  it('hits the cache for a different payload with the same structure', async () => {
    const mapper = new StubMapper(rule);
    const { engine, metrics } = await setup(mapper);

    const first = await engine.heal(healInput());
    expect(first.ok).toBe(true);

    const second = await engine.heal({ ...healInput(), payload: { id: 'usr_2', balance: '10' } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.cached).toBe(true);
    expect(second.after).toEqual({ user_id: 'usr_2', account_balance: 10 });
    expect(mapper.calls).toBe(1);
    expect(metrics.snapshot().llmCallsSaved).toBe(1);
  });

  it('single-flights concurrent cold heals for the same fingerprint', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mapper = new StubMapper(rule, gate);
    const { engine, metrics } = await setup(mapper);

    const first = engine.heal(healInput());
    const second = engine.heal(healInput());
    release();
    const outcomes = await Promise.all([first, second]);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(mapper.calls).toBe(1);
    expect(metrics.snapshot().llmCalls).toBe(1);
  });

  it('discards a cached rule that no longer applies and re-derives it', async () => {
    const mapper = new StubMapper(rule);
    const { engine, cache } = await setup(mapper);
    const fp = fingerprint(payload);
    const key = `GET /api/v1/checkout/user ${fp}`;

    cache.set({
      key,
      endpoint: '/api/v1/checkout/user',
      method: 'GET',
      fingerprint: fp,
      rule: {
        ...rule,
        fields: {
          user_id: { from: 'gone', coerce: 'none' },
          account_balance: { from: 'balance', coerce: 'number' },
        },
      },
      sampleBefore: payload,
      sampleAfter: { user_id: 'usr_99', account_balance: 450.5 },
      sanitizedBefore: { id: 'string', balance: 'string:numeric' },
      llmMode: 'mock',
      model: 'stub-mapper',
      createdAt: '2026-11-14T09:00:00.000Z',
    });

    const outcome = await engine.heal(healInput());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.cached).toBe(false);
    expect(mapper.calls).toBe(1);
    expect(cache.get(key)?.rule.fields.user_id?.from).toBe('id');
  });

  it('fails verification without caching when confidence is below the threshold', async () => {
    const mapper = new StubMapper({ ...rule, confidence: 0.2 });
    const { engine, cache } = await setup(mapper);

    const outcome = await engine.heal(healInput());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('RULE_VERIFICATION_FAILED');
    expect(outcome.errors.some((error) => error.startsWith('Gate 3'))).toBe(true);
    expect(cache.size).toBe(0);
  });

  it('fails verification when a required field is unmappable', async () => {
    const mapper = new StubMapper({
      ...rule,
      fields: { ...rule.fields, user_id: { from: null, coerce: 'none' } },
      unmappable: ['user_id'],
    });
    const { engine, cache } = await setup(mapper);

    const outcome = await engine.heal(healInput());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('RULE_VERIFICATION_FAILED');
    expect(outcome.missingFields).toContain('user_id');
    expect(outcome.errors.some((error) => error.startsWith('Gate 5'))).toBe(true);
    expect(cache.size).toBe(0);
  });

  it('surfaces a typed LLM failure with its real reason', async () => {
    const mapper = new TimeoutMapper();
    const { engine, cache, metrics } = await setup(mapper);

    const outcome = await engine.heal(healInput());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('LLM_TIMEOUT');
    expect(outcome.message).toContain('did not answer');
    expect(cache.size).toBe(0);
    expect(metrics.snapshot().llmCalls).toBe(1);
  });
});
