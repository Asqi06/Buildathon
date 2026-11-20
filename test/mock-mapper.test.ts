import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/types.js';
import { CHAOS_MODES, payloadFor } from '../src/mock-upstream/scenarios.js';
import { MockMapper } from '../src/healer/mock-llm.js';
import { sanitize } from '../src/healer/sanitizer.js';
import { verifyRule } from '../src/healer/rule.js';

const contract: Contract = {
  endpoint: '/api/v1/checkout/user',
  method: 'GET',
  expected_schema: {
    user_id: 'string',
    email: 'string',
    account_balance: 'number',
    is_verified: 'boolean',
    created_at: 'iso_datetime',
  },
};

const healable = CHAOS_MODES.filter((mode) => mode !== 'field_deleted');

describe('MockMapper', () => {
  const mapper = new MockMapper();

  for (const mode of healable) {
    it(`produces a rule that passes verification for ${mode}`, async () => {
      const payload = payloadFor(mode);
      const rule = await mapper.map({
        endpoint: contract.endpoint,
        method: contract.method,
        expectedSchema: contract.expected_schema,
        structure: sanitize(payload),
      });

      expect(rule.fields.user_id?.from).not.toBeNull();
      expect(rule.fields.email?.from).not.toBeNull();
      expect(rule.confidence).toBeGreaterThanOrEqual(0.7);

      const verification = verifyRule({ rule, contract, payload, minConfidence: 0.7 });
      expect(verification.errors).toEqual([]);
      expect(verification.ok).toBe(true);
      expect(verification.validation?.valid).toBe(true);
    });
  }

  it('reports a deleted required field as unmappable and fails verification', async () => {
    const payload = payloadFor('field_deleted');
    const attempts: number[] = [];
    const rule = await mapper.map({
      endpoint: contract.endpoint,
      method: contract.method,
      expectedSchema: contract.expected_schema,
      structure: sanitize(payload),
      onAttempt: () => attempts.push(1),
    });

    expect(attempts).toHaveLength(1);
    expect(rule.unmappable).toContain('email');
    expect(rule.fields.email).toEqual({ from: null, coerce: 'none' });
    expect(rule.confidence).toBeLessThan(0.7);

    const verification = verifyRule({ rule, contract, payload, minConfidence: 0.7 });
    expect(verification.ok).toBe(false);
    expect(verification.errors.length).toBeGreaterThan(0);
  });

  it('only sees value classes inside the sanitized structure', async () => {
    let seen = '';
    await mapper.map({
      endpoint: contract.endpoint,
      method: contract.method,
      expectedSchema: contract.expected_schema,
      structure: sanitize(payloadFor('none')),
      onAttempt: () => {
        seen = 'called';
      },
    });
    expect(seen).toBe('called');
    const structure = sanitize(payloadFor('combo_v2'));
    expect(JSON.stringify(structure)).not.toContain('dev@acme.io');
    expect(JSON.stringify(structure)).not.toContain('450.50');
  });
});
