import { describe, expect, it } from 'vitest';
import { ContractRegistry, inferSchemaFromPayload } from '../src/contracts/registry.js';
import { AlertManager } from '../src/alerts/webhook.js';
import { MockMapper } from '../src/healer/mock-llm.js';
import { sanitize } from '../src/healer/sanitizer.js';
import { verifyRule } from '../src/healer/rule.js';

describe('Auto-Profiling (Traffic Learning Engine)', () => {
  it('learns schema from healthy 200 OK payloads and auto-locks at threshold', () => {
    const registry = ContractRegistry.fromContracts([]);
    expect(registry.size).toBe(0);

    const payload = {
      order_id: 'ord_123',
      amount_usd: 129.99,
      is_completed: true,
      created_at: '2026-11-20T11:00:00Z',
    };

    // Record samples with threshold 3
    registry.recordLearnSample('GET', '/api/v1/orders/123', payload, 3);
    expect(registry.getLearnedContracts().length).toBe(1);
    expect(registry.getLearnedContracts()[0]?.samplesObserved).toBe(1);
    expect(registry.getLearnedContracts()[0]?.isLocked).toBe(false);

    // Second sample
    registry.recordLearnSample('GET', '/api/v1/orders/123', payload, 3);
    expect(registry.getLearnedContracts()[0]?.samplesObserved).toBe(2);

    // Third sample triggers auto-lock
    registry.recordLearnSample('GET', '/api/v1/orders/123', payload, 3);
    expect(registry.getLearnedContracts()[0]?.isLocked).toBe(true);
    expect(registry.size).toBe(1);

    const matched = registry.match('GET', '/api/v1/orders/123');
    expect(matched).toBeDefined();
    expect(matched?.expected_schema).toEqual({
      order_id: 'string',
      amount_usd: 'number',
      is_completed: 'boolean',
      created_at: 'iso_datetime',
    });
  });

  it('allows manual locking before threshold', () => {
    const registry = ContractRegistry.fromContracts([]);
    registry.recordLearnSample('POST', '/api/v1/payments', { token: 'tok_abc', charge: 50 }, 50);
    expect(registry.size).toBe(0);

    const locked = registry.lockLearned('POST', '/api/v1/payments');
    expect(locked).toBeDefined();
    expect(registry.size).toBe(1);
    expect(registry.match('POST', '/api/v1/payments')).toBeDefined();
  });
});

describe('Human-in-the-Loop AlertManager', () => {
  it('creates alerts and formats rich Slack and Discord cards', () => {
    const manager = new AlertManager();
    const alert = manager.createDriftAlert({
      endpoint: '/api/v1/checkout/user',
      method: 'GET',
      diffSummary: 'user_id -> id',
      confidence: 0.95,
      gatesPassed: '5/5 Gates Passed',
      prUrl: 'https://github.com/org/repo/pull/1',
      severity: 'info',
    });

    expect(alert.id).toBeDefined();
    expect(manager.getAlerts().length).toBe(1);

    const slackCard = manager.formatSlackPayload(alert);
    expect(slackCard.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(slackCard)).toContain('user_id -> id');

    const discordCard = manager.formatDiscordPayload(alert);
    expect(discordCard.embeds.length).toBe(1);
    expect(discordCard.embeds[0]?.title).toContain('AutoPatch Healed Drift');

    manager.approveAlert(alert.id);
    expect(manager.getAlerts()[0]?.status).toBe('approved');
  });
});

describe('Universal AI Healing Studio (Arbitrary Custom Schema Mapper)', () => {
  it('heals custom Razorpay v1->v2 webhook drift with nested entities and coercions', async () => {
    const baselineSample = {
      payment_id: 'pay_Pq9821Lk01',
      customer_email: 'priya.sharma@finharat.in',
      amount_inr: 1499.5,
      is_captured: true,
      captured_at: '2026-11-20T09:30:00.000Z',
    };
    const driftedPayload = {
      entity: {
        id: 'pay_Pq9821Lk01',
        contact: {
          email_address: 'priya.sharma@finharat.in',
        },
        amount: '1499.50',
        captured: 1,
        created_timestamp: 1763631000,
      },
    };

    const expectedSchema = inferSchemaFromPayload(baselineSample);
    expect(expectedSchema).toEqual({
      payment_id: 'string',
      customer_email: 'string',
      amount_inr: 'number',
      is_captured: 'boolean',
      captured_at: 'iso_datetime',
    });

    const mapper = new MockMapper();
    const rule = await mapper.map({
      endpoint: '/api/v2/payments/razorpay-webhook',
      method: 'POST',
      expectedSchema,
      structure: sanitize(driftedPayload),
    });

    const verified = verifyRule({
      rule,
      contract: {
        method: 'POST',
        endpoint: '/api/v2/payments/razorpay-webhook',
        expected_schema: expectedSchema,
      },
      payload: driftedPayload,
      minConfidence: 0.7,
    });

    expect(verified.ok).toBe(true);
    expect(verified.applied).toEqual({
      payment_id: 'pay_Pq9821Lk01',
      customer_email: 'priya.sharma@finharat.in',
      amount_inr: 1499.5,
      is_captured: true,
      captured_at: '2025-11-20T09:30:00.000Z',
    });
  });

  it('enforces Gate 5 fail-closed quarantine when a required financial field is missing', async () => {
    const expectedSchema = inferSchemaFromPayload({
      payment_id: 'pay_Pq9821Lk01',
      amount_inr: 1499.5,
    });
    const tamperedPayload = {
      entity: { id: 'pay_Pq9821Lk01' },
    };

    const mapper = new MockMapper();
    const rule = await mapper.map({
      endpoint: '/api/v2/payments/razorpay-webhook',
      method: 'POST',
      expectedSchema,
      structure: sanitize(tamperedPayload),
    });

    const verified = verifyRule({
      rule,
      contract: {
        method: 'POST',
        endpoint: '/api/v2/payments/razorpay-webhook',
        expected_schema: expectedSchema,
      },
      payload: tamperedPayload,
      minConfidence: 0.7,
    });

    expect(verified.ok).toBe(false);
  });
});
