import { createHash } from 'node:crypto';

export function canonicalStructure(value: unknown): string {
  if (value === null) return 'null';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${canonicalStructure(value[0])}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStructure(record[key])}`);
    return `{${pairs.join(',')}}`;
  }

  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'bigint') return 'bigint';
  if (typeof value === 'function') return 'function';
  return typeof value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha1').update(canonicalStructure(value)).digest('hex');
}
