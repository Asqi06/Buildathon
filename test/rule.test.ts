import { describe, expect, it } from 'vitest';
import type { Contract, MappingRule } from '../src/types.js';
import {
  applyRule,
  coerceValue,
  missingRequiredFields,
  parsePath,
  resolvePath,
  RuleError,
  verifyRule,
} from '../src/healer/rule.js';

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

const epochSeconds = 1_763_112_600;
const expectedIso = new Date(epochSeconds * 1000).toISOString();

const payload = {
  id: 'usr_99',
  contact: { email_addr: 'dev@acme.io' },
  balance: '450.50',
  verified: 1,
  created: epochSeconds,
};

const rule: MappingRule = {
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
};

describe('parsePath', () => {
  it('parses dot paths and array indexes', () => {
    expect(parsePath('contact.email_addr')).toEqual(['contact', 'email_addr']);
    expect(parsePath('data[0].email')).toEqual(['data', 0, 'email']);
    expect(parsePath('items[0][1].id')).toEqual(['items', 0, 1, 'id']);
  });

  it('rejects malformed and unsafe paths', () => {
    expect(() => parsePath('')).toThrow(RuleError);
    expect(() => parsePath('a..b')).toThrow(/empty segment/);
    expect(() => parsePath('a[-1]')).toThrow(/invalid array index/);
    expect(() => parsePath('__proto__.polluted')).toThrow(/forbidden key/);
    expect(() => parsePath('constructor.prototype')).toThrow(/forbidden key/);
  });
});

describe('resolvePath', () => {
  it('resolves nested objects and arrays', () => {
    const value = { data: [{ contact: { email: 'dev@acme.io' } }] };
    expect(resolvePath(value, 'data[0].contact.email')).toEqual({
      found: true,
      value: 'dev@acme.io',
    });
    expect(resolvePath(value, 'data[2].contact.email')).toEqual({
      found: false,
      value: undefined,
    });
    expect(resolvePath(value, 'data[0].missing')).toEqual({ found: false, value: undefined });
  });
});

describe('coerceValue', () => {
  it('coerces numeric strings and booleans', () => {
    expect(coerceValue('450.50', 'number', 'account_balance')).toBe(450.5);
    expect(coerceValue('42', 'string', 'user_id')).toBe('42');
    expect(coerceValue(1, 'boolean', 'is_verified')).toBe(true);
    expect(coerceValue('no', 'boolean', 'is_verified')).toBe(false);
  });

  it('normalises ISO timestamps and epoch values', () => {
    expect(coerceValue('2026-11-14T09:30:00+05:30', 'iso_datetime', 'created_at')).toBe(
      '2026-11-14T04:00:00.000Z',
    );
    expect(coerceValue(epochSeconds, 'iso_datetime', 'created_at')).toBe(expectedIso);
    expect(coerceValue(epochSeconds * 1000, 'iso_datetime', 'created_at')).toBe(expectedIso);
  });

  it('throws when a value cannot satisfy the requested type', () => {
    expect(() => coerceValue('', 'number', 'account_balance')).toThrow(RuleError);
    expect(() => coerceValue(true, 'number', 'account_balance')).toThrow(/finite number/);
    expect(() => coerceValue('maybe', 'boolean', 'is_verified')).toThrow(/boolean/);
    expect(() => coerceValue('14/11/2026', 'iso_datetime', 'created_at')).toThrow(/ISO-8601/);
    expect(() => coerceValue(null, 'string', 'user_id')).toThrow(/string/);
  });
});

describe('applyRule', () => {
  it('maps a drifted payload onto the baseline shape', () => {
    expect(applyRule(rule, payload)).toEqual({
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: expectedIso,
    });
  });

  it('throws when a field has no upstream source', () => {
    const broken = structuredClone(rule);
    broken.fields.email = { from: null, coerce: 'none' };
    expect(() => applyRule(broken, payload)).toThrow(/email.*no upstream source/);
  });

  it('throws when a source path disappears', () => {
    const broken = structuredClone(rule);
    broken.fields.email = { from: 'contact.email', coerce: 'none' };
    expect(() => applyRule(broken, payload)).toThrow(/was not found/);
  });
});

describe('verifyRule', () => {
  it('passes all five gates for a correct rule', () => {
    const result = verifyRule({ rule, contract, payload, minConfidence: 0.7 });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.validation?.valid).toBe(true);
    expect(result.applied?.email).toBe('dev@acme.io');
  });

  it('fails gate 1 when a baseline field has no mapping', () => {
    const broken = structuredClone(rule);
    delete broken.fields.email;
    const result = verifyRule({ rule: broken, contract, payload, minConfidence: 0.7 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('Gate 1'))).toBe(true);
  });

  it('fails gate 2 when a source path does not resolve', () => {
    const broken = structuredClone(rule);
    broken.fields.email = { from: 'contact.email', coerce: 'none' };
    const result = verifyRule({ rule: broken, contract, payload, minConfidence: 0.7 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('Gate 2'))).toBe(true);
  });

  it('fails gate 2 for an unsafe path', () => {
    const broken = structuredClone(rule);
    broken.fields.email = { from: '__proto__.email', coerce: 'none' };
    const result = verifyRule({ rule: broken, contract, payload, minConfidence: 0.7 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('forbidden key'))).toBe(true);
  });

  it('fails gate 3 when confidence is below the threshold', () => {
    const result = verifyRule({
      rule: { ...rule, confidence: 0.4 },
      contract,
      payload,
      minConfidence: 0.7,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('Gate 3'))).toBe(true);
  });

  it('fails gate 4 when the applied output violates the contract', () => {
    const broken = structuredClone(rule);
    broken.fields.account_balance = { from: 'id', coerce: 'number' };
    const result = verifyRule({ rule: broken, contract, payload, minConfidence: 0.7 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('Gate 4'))).toBe(true);
  });

  it('fails gate 5 when a required field is marked unmappable', () => {
    const result = verifyRule({
      rule: { ...rule, unmappable: ['email'] },
      contract,
      payload,
      minConfidence: 0.7,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith('Gate 5'))).toBe(true);
  });

  it('rejects a rule that does not match the rule schema', () => {
    const result = verifyRule({
      rule: { ...rule, confidence: 'high' },
      contract,
      payload,
      minConfidence: 0.7,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Rule schema');
    expect(result.applied).toBeNull();
  });
});

describe('missingRequiredFields', () => {
  it('lists absent baseline fields', () => {
    const { email: _email, created_at: _createdAt, ...rest } = {
      user_id: 'usr_99',
      email: 'dev@acme.io',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    };
    expect(missingRequiredFields(contract, rest)).toEqual(['email', 'created_at']);
  });

  it('treats a non-object payload as missing every field', () => {
    expect(missingRequiredFields(contract, [])).toEqual(Object.keys(contract.expected_schema));
  });
});
