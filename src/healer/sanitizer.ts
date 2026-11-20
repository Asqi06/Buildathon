import { isIsoDatetime } from '../contracts/validator.js';

export type ValueClass =
  | 'string'
  | 'string:numeric'
  | 'string:iso_datetime'
  | 'string:email_like'
  | 'number:int'
  | 'number:float'
  | 'number:epoch_like'
  | 'boolean'
  | 'null'
  | 'unknown';

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_ARRAY_ELEMENTS = 3;
const MAX_DEPTH = 8;

export function classifyValue(value: unknown): ValueClass {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'unknown';
    if (Number.isInteger(value) && value >= 1e9 && value <= 4e12) return 'number:epoch_like';
    return Number.isInteger(value) ? 'number:int' : 'number:float';
  }
  if (typeof value === 'string') {
    if (EMAIL_LIKE.test(value)) return 'string:email_like';
    if (isIsoDatetime(value)) return 'string:iso_datetime';
    if (NUMERIC_STRING.test(value.trim())) return 'string:numeric';
    return 'string';
  }
  return 'unknown';
}

export function sanitize(value: unknown): unknown {
  return walk(value, 0);
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return 'unknown';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ELEMENTS).map((item) => walk(item, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = walk(record[key], depth + 1);
    }
    return result;
  }

  return classifyValue(value);
}
