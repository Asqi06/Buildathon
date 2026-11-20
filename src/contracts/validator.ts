import type { Contract, FieldType, ValidationResult } from '../types.js';
import { isObject } from '../util.js';

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoDatetime(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function matchesType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'iso_datetime':
      return isIsoDatetime(value);
  }
}

export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : 'number(non-finite)';
  }
  return typeof value;
}

export function validateContract(payload: unknown, contract: Contract): ValidationResult {
  const missing: string[] = [];
  const wrongTypes: ValidationResult['wrongTypes'] = [];

  if (!isObject(payload)) {
    return {
      valid: false,
      missing: Object.keys(contract.expected_schema),
      wrongTypes: [
        {
          field: '$',
          expected: 'string',
          observed: describeValue(payload),
        },
      ],
    };
  }

  for (const [field, expected] of Object.entries(contract.expected_schema)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      missing.push(field);
      continue;
    }
    const value = payload[field];
    if (!matchesType(value, expected)) {
      wrongTypes.push({ field, expected, observed: describeValue(value) });
    }
  }

  return {
    valid: missing.length === 0 && wrongTypes.length === 0,
    missing,
    wrongTypes,
  };
}

export function describeValidationFailure(result: ValidationResult): string {
  const parts: string[] = [];
  if (result.missing.length > 0) parts.push(`missing: ${result.missing.join(', ')}`);
  if (result.wrongTypes.length > 0) {
    parts.push(
      result.wrongTypes
        .map((issue) => `${issue.field} expected ${issue.expected}, received ${issue.observed}`)
        .join('; '),
    );
  }
  return parts.join('; ') || 'baseline validation failed';
}
