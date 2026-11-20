import { describe, expect, it } from 'vitest';
import { classifyValue, sanitize } from '../src/healer/sanitizer.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('classifyValue', () => {
  it('classifies scalar value classes', () => {
    expect(classifyValue('hello')).toBe('string');
    expect(classifyValue('42')).toBe('string:numeric');
    expect(classifyValue('dev@acme.io')).toBe('string:email_like');
    expect(classifyValue('2026-11-14T09:30:00Z')).toBe('string:iso_datetime');
    expect(classifyValue(450.5)).toBe('number:float');
    expect(classifyValue(42)).toBe('number:int');
    expect(classifyValue(1_763_112_600)).toBe('number:epoch_like');
    expect(classifyValue(true)).toBe('boolean');
    expect(classifyValue(null)).toBe('null');
    expect(classifyValue(Number.NaN)).toBe('unknown');
  });

  it('does not send raw scalar values through sanitisation', () => {
    const payload = {
      email: 'dev@acme.io',
      user_id: 'usr_99',
      account_balance: 450.5,
      is_verified: true,
      created_at: '2026-11-14T09:30:00Z',
    };

    const output = sanitize(payload);
    expect(output).toEqual({
      account_balance: 'number:float',
      created_at: 'string:iso_datetime',
      email: 'string:email_like',
      is_verified: 'boolean',
      user_id: 'string',
    });
    expect(JSON.stringify(output)).not.toContain('dev@acme.io');
    expect(JSON.stringify(output)).not.toContain('usr_99');
  });

  it('sorts keys and truncates arrays to three elements', () => {
    const output = sanitize({ z: [1, 2, 3, 4, 5], a: true });
    expect(output).toEqual({
      a: 'boolean',
      z: ['number:int', 'number:int', 'number:int'],
    });
  });

  it('caps recursion depth at eight levels', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 10; index += 1) {
      nested = { next: nested };
    }

    let node: unknown = sanitize(nested);
    for (let index = 0; index < 9; index += 1) {
      expect(isRecord(node)).toBe(true);
      node = isRecord(node) ? node.next : undefined;
    }
    expect(node).toBe('unknown');
  });
});
