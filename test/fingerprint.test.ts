import { describe, expect, it } from 'vitest';
import { canonicalStructure, fingerprint } from '../src/healer/fingerprint.js';

describe('canonicalStructure', () => {
  it('sorts object keys so key order does not matter', () => {
    expect(canonicalStructure({ b: 2, a: 'x' })).toBe('{"a":string,"b":number}');
    expect(canonicalStructure({ a: 'x', b: 2 })).toBe('{"a":string,"b":number}');
  });

  it('ignores scalar values and tracks only their types', () => {
    expect(fingerprint({ id: 'abc', score: 1 })).toBe(fingerprint({ id: 'xyz', score: 2 }));
  });

  it('uses the first array element as the array shape', () => {
    expect(canonicalStructure([1, 2, 3])).toBe('[number]');
    expect(canonicalStructure(['a', 'b'])).toBe('[string]');
    expect(canonicalStructure([])).toBe('[]');
    expect(fingerprint([1])).toBe(fingerprint([2, 3, 4]));
  });

  it('changes when a key, type or array wrapper changes', () => {
    const baseline = fingerprint({ id: 'u1', active: true });
    expect(fingerprint({ id: 'u1', active: false })).toBe(baseline);
    expect(fingerprint({ user_id: 'u1', active: true })).not.toBe(baseline);
    expect(fingerprint({ id: 'u1', active: 1 })).not.toBe(baseline);
    expect(fingerprint({ data: [{ id: 'u1', active: true }] })).not.toBe(baseline);
  });

  it('produces a stable 40 character sha1 digest', () => {
    const value = fingerprint({ a: 1 });
    expect(value).toMatch(/^[0-9a-f]{40}$/);
    expect(fingerprint({ a: 1 })).toBe(value);
  });
});
