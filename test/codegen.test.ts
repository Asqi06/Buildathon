import { describe, expect, it } from 'vitest';
import type { RuleCacheEntry } from '../src/types.js';
import {
  buildPrBody,
  diffStructures,
  exportNameForSlug,
  generateAdapter,
  slugForEndpoint,
  verifyGeneratedAdapter,
} from '../src/github/codegen.js';

const epochSeconds = 1_763_112_600;
const iso = new Date(epochSeconds * 1000).toISOString();

function entry(overrides: Partial<RuleCacheEntry> = {}): RuleCacheEntry {
  return {
    key: `GET /api/v1/checkout/user fingerprint`,
    endpoint: '/api/v1/checkout/user',
    method: 'GET',
    fingerprint: '0123456789abcdef0123456789abcdef01234567',
    rule: {
      fields: {
        user_id: { from: 'id', coerce: 'none' },
        email: { from: 'contact.email_addr', coerce: 'none' },
        account_balance: { from: 'balance', coerce: 'number' },
        is_verified: { from: 'verified', coerce: 'boolean' },
        created_at: { from: 'created', coerce: 'iso_datetime' },
      },
      unmappable: [],
      confidence: 0.94,
      reasoning: 'Mapped every baseline field.',
    },
    sampleBefore: {
      id: 'usr_99',
      contact: { email_addr: 'dev@acme.io' },
      balance: '450.50',
      verified: 1,
      created: epochSeconds,
    },
    sampleAfter: {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: iso,
    },
    sanitizedBefore: {},
    llmMode: 'mock',
    model: 'mock-mapper-v1',
    createdAt: '2026-11-14T09:30:00.000Z',
    ...overrides,
  };
}

describe('slug helpers', () => {
  it('builds a safe slug and export name from an endpoint', () => {
    expect(slugForEndpoint('/api/v1/checkout/user')).toBe('api-v1-checkout-user');
    expect(exportNameForSlug('api-v1-checkout-user')).toBe('adaptApiV1CheckoutUser');
    expect(slugForEndpoint('/')).toBe('endpoint');
    expect(slugForEndpoint('/api/users/{id}')).toBe('api-users-id');
  });
});

describe('generateAdapter', () => {
  it('generates an adapter and node:test file at stable paths', () => {
    const generated = generateAdapter(entry());
    expect(generated.adapterPath).toBe('src/adapters/api-v1-checkout-user.ts');
    expect(generated.testPath).toBe('src/adapters/api-v1-checkout-user.test.ts');
    expect(generated.adapterCode).toContain('export function adaptApiV1CheckoutUser(payload)');
    expect(generated.adapterCode).toContain('toIsoDatetime(readPath(payload, "created")');
    expect(generated.testCode).toContain("import test from 'node:test'");
    expect(generated.testCode).toContain('assert.deepEqual');
  });

  it('executes the generated adapter in-process and matches the rule output', async () => {
    const generated = generateAdapter(entry());
    const verification = await verifyGeneratedAdapter(
      generated,
      entry().sampleBefore,
      entry().sampleAfter,
    );
    expect(verification).toEqual({ ok: true, error: null });
  });

  it('rejects an adapter whose output does not match the verified result', async () => {
    const generated = generateAdapter(entry());
    const verification = await verifyGeneratedAdapter(
      generated,
      entry().sampleBefore,
      { ...entry().sampleAfter, account_balance: 999 },
    );
    expect(verification.ok).toBe(false);
    expect(verification.error).toContain('did not match');
  });

  it('rejects a sample for which a mapped path is missing', async () => {
    const generated = generateAdapter(entry());
    const verification = await verifyGeneratedAdapter(
      generated,
      { id: 'usr_99' },
      entry().sampleAfter,
    );
    expect(verification.ok).toBe(false);
    expect(verification.error).toContain('was not found');
  });
});

describe('diffStructures', () => {
  it('reports removed and added top-level paths', () => {
    const diff = diffStructures(entry());
    expect(diff.wrapper).toBeNull();
    expect(diff.removed.map((change) => change.path).sort()).toEqual(
      ['account_balance', 'created_at', 'email', 'is_verified', 'user_id'].sort(),
    );
    expect(diff.added.map((change) => change.path).sort()).toEqual(
      ['balance', 'contact', 'created', 'id', 'verified'].sort(),
    );
    expect(diff.typeChanged).toEqual([]);
  });

  it('detects a wrapped array and type changes', () => {
    const wrapped = diffStructures(
      entry({
        sampleBefore: { data: [entry().sampleAfter] },
      }),
    );
    expect(wrapped.wrapper).toBe('Payload is wrapped in data[]');
    expect(wrapped.added.map((change) => change.path)).toEqual(['data']);

    const typed = diffStructures(
      entry({
        sampleBefore: {
          user_id: 'usr_99',
          email: 'dev@acme.io',
          account_balance: '450.50',
          is_verified: 1,
          created_at: iso,
        },
      }),
    );
    expect(typed.typeChanged.map((change) => change.path).sort()).toEqual([
      'account_balance',
      'is_verified',
    ]);
  });
});

describe('buildPrBody', () => {
  it('explains the upstream change, the rule and the verification honestly', () => {
    const body = buildPrBody(entry());
    expect(body).toContain('## What changed upstream');
    expect(body).toContain('| Removed | `email` |');
    expect(body).toContain('## Mapping rule');
    expect(body).toContain('| `account_balance` | `balance` | `number` |');
    expect(body).toContain('Confidence: 0.94');
    expect(body).toContain('executed in-process and matched the rule engine output');
    expect(body).toContain('- Mode: mock');
    expect(body).toContain('- Model: mock-mapper-v1');
    expect(body).toContain('- Baseline fingerprint: `0123456789abcdef0123456789abcdef01234567`');
    expect(body).toContain('Generated automatically. Please review before merging.');
  });
});
