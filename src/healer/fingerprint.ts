import { createHash } from 'node:crypto';

const MAX_FINGERPRINT_DEPTH = 16;

export function canonicalStructure(value: unknown, depth = 0): string {
  if (depth > MAX_FINGERPRINT_DEPTH) return 'depth_limit';
  if (value === null) return 'null';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${canonicalStructure(value[0], depth + 1)}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .sort()
      .slice(0, 200)
      .map((key) => `${JSON.stringify(key)}:${canonicalStructure(record[key], depth + 1)}`);
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
