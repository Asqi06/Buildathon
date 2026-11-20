import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/types.js';
import {
  describeValidationFailure,
  isIsoDatetime,
  validateContract,
} from '../src/contracts/validator.js';

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

const baseline = {
  user_id: 'usr_99',
  email: 'dev@acme.io',
  account_balance: 450.5,
  is_verified: true,
  created_at: '2026-11-14T09:30:00Z',
};

describe('isIsoDatetime', () => {
  it('accepts ISO-8601 datetimes with offsets', () => {
    expect(isIsoDatetime('2026-11-14T09:30:00Z')).toBe(true);
    expect(isIsoDatetime('2026-11-14T09:30:00.123+05:30')).toBe(true);
  });

  it('rejects epoch numbers, date-only strings and impossible dates', () => {
    expect(isIsoDatetime(1_763_112_600)).toBe(false);
    expect(isIsoDatetime('2026-11-14')).toBe(false);
    expect(isIsoDatetime('2026-13-40T99:99:99Z')).toBe(false);
  });
});

describe('validateContract', () => {
  it('accepts a baseline payload and ignores extra fields', () => {
    const result = validateContract({ ...baseline, extra: 'ok' }, contract);
    expect(result).toEqual({ valid: true, missing: [], wrongTypes: [] });
  });

  it('reports every missing field', () => {
    const { email: _email, created_at: _createdAt, ...rest } = baseline;
    const result = validateContract(rest, contract);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['email', 'created_at']);
    expect(result.wrongTypes).toEqual([]);
  });

  it('reports wrong primitive types, arrays and nulls', () => {
    const result = validateContract(
      {
        ...baseline,
        account_balance: '450.50',
        is_verified: 1,
        user_id: null,
        email: ['dev@acme.io'],
      },
      contract,
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.wrongTypes).toEqual(
      expect.arrayContaining([
        { field: 'account_balance', expected: 'number', observed: 'string' },
        { field: 'is_verified', expected: 'boolean', observed: 'number' },
        { field: 'user_id', expected: 'string', observed: 'null' },
        { field: 'email', expected: 'string', observed: 'array' },
      ]),
    );
  });

  it('rejects a non-object payload and lists all fields as missing', () => {
    const result = validateContract([baseline], contract);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(Object.keys(contract.expected_schema));
    expect(result.wrongTypes).toEqual([{ field: '$', expected: 'string', observed: 'array' }]);
  });

  it('describes failures for diagnostics', () => {
    const result = validateContract({ ...baseline, account_balance: '450.50' }, contract);
    expect(describeValidationFailure(result)).toContain(
      'account_balance expected number, received string',
    );
  });
});
