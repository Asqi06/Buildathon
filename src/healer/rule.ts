import { z } from 'zod';
import type {
  Coerce,
  Contract,
  FieldMapping,
  MappingRule,
  ValidationResult,
} from '../types.js';
import { validateContract, describeValidationFailure } from '../contracts/validator.js';
import { isObject } from '../util.js';

const coerceSchema = z.enum(['none', 'string', 'number', 'boolean', 'iso_datetime']);

const mappingSchema = z.object({
  from: z.union([z.string().min(1), z.null()]),
  coerce: coerceSchema,
});

export const mappingRuleSchema = z.object({
  fields: z.record(z.string().min(1), mappingSchema),
  unmappable: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class RuleError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = 'RuleError';
    this.field = field;
  }
}

type PathToken = string | number;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function parsePath(path: string): PathToken[] {
  if (path.trim() === '') throw new RuleError('Mapping path is empty');
  const tokens: PathToken[] = [];
  const parts = path.split('.');

  for (const part of parts) {
    if (part === '') throw new RuleError(`Mapping path "${path}" contains an empty segment`);
    const pieces = part.split(/(\[\d+\])/g).filter((piece) => piece !== '');
    for (const piece of pieces) {
      if (piece.startsWith('[') && piece.endsWith(']')) {
        const index = Number(piece.slice(1, -1));
        if (!Number.isInteger(index) || index < 0) {
          throw new RuleError(`Mapping path "${path}" has an invalid array index`);
        }
        tokens.push(index);
        continue;
      }
      if (piece.includes('[') || piece.includes(']')) {
        throw new RuleError(`Mapping path "${path}" has an invalid array index`);
      }
      if (FORBIDDEN_KEYS.has(piece)) {
        throw new RuleError(`Mapping path "${path}" uses a forbidden key`);
      }
      tokens.push(piece);
    }
  }

  return tokens;
}

export interface ResolvedPath {
  found: boolean;
  value: unknown;
}

export function resolvePath(payload: unknown, path: string): ResolvedPath {
  let current: unknown = payload;

  for (const token of parsePath(path)) {
    if (typeof token === 'number') {
      if (!Array.isArray(current)) return { found: false, value: undefined };
      if (token >= current.length) return { found: false, value: undefined };
      current = current[token];
      continue;
    }

    if (!isObject(current)) return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false, value: undefined };
    }
    current = current[token];
  }

  return { found: true, value: current };
}

export function coerceValue(value: unknown, coerce: Coerce, field: string): unknown {
  if (coerce === 'none') return value;

  if (coerce === 'string') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    throw new RuleError(`Field "${field}" cannot be coerced to string`, field);
  }

  if (coerce === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new RuleError(`Field "${field}" cannot be coerced to a finite number`, field);
  }

  if (coerce === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'yes') return true;
      if (normalized === 'false' || normalized === 'no') return false;
    }
    throw new RuleError(`Field "${field}" cannot be coerced to boolean`, field);
  }

  if (coerce === 'iso_datetime') {
    if (typeof value === 'string') {
      if (!ISO_DATETIME.test(value)) {
        throw new RuleError(`Field "${field}" is not an ISO-8601 datetime`, field);
      }
      const parsed = Date.parse(value);
      if (!Number.isFinite(parsed)) {
        throw new RuleError(`Field "${field}" is not a valid datetime`, field);
      }
      return new Date(parsed).toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = value < 1e12 ? value * 1000 : value;
      const date = new Date(milliseconds);
      if (Number.isNaN(date.getTime())) {
        throw new RuleError(`Field "${field}" is not a valid epoch datetime`, field);
      }
      return date.toISOString();
    }
    throw new RuleError(`Field "${field}" cannot be coerced to iso_datetime`, field);
  }

  throw new RuleError(`Field "${field}" uses an unsupported coercion`, field);
}

export function applyRule(rule: MappingRule, payload: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [field, mapping] of Object.entries(rule.fields)) {
    if (mapping.from === null) {
      throw new RuleError(`Field "${field}" has no upstream source`, field);
    }
    const resolved = resolvePath(payload, mapping.from);
    if (!resolved.found) {
      throw new RuleError(`Field "${field}" source "${mapping.from}" was not found`, field);
    }
    result[field] = coerceValue(resolved.value, mapping.coerce, field);
  }

  return result;
}

export interface RuleVerification {
  ok: boolean;
  errors: string[];
  applied: Record<string, unknown> | null;
  validation: ValidationResult | null;
}

export interface VerifyRuleInput {
  rule: unknown;
  contract: Contract;
  payload: unknown;
  minConfidence: number;
}

export function verifyRule(input: VerifyRuleInput): RuleVerification {
  const errors: string[] = [];
  const parsed = mappingRuleSchema.safeParse(input.rule);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `Rule schema: ${issue.path.join('.') || 'rule'} ${issue.message}`,
      ),
      applied: null,
      validation: null,
    };
  }

  const rule = parsed.data;
  const expectedFields = Object.keys(input.contract.expected_schema);

  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(rule.fields, field)) {
      errors.push(`Gate 1: baseline field "${field}" has no mapping`);
    }
  }

  for (const [field, mapping] of Object.entries(rule.fields)) {
    if (mapping.from === null) continue;
    try {
      const resolved = resolvePath(input.payload, mapping.from);
      if (!resolved.found) {
        errors.push(`Gate 2: source path "${mapping.from}" for "${field}" does not resolve`);
      }
    } catch (error) {
      errors.push(`Gate 2: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (rule.confidence < input.minConfidence) {
    errors.push(
      `Gate 3: confidence ${rule.confidence.toFixed(2)} is below minimum ${input.minConfidence.toFixed(2)}`,
    );
  }

  let applied: Record<string, unknown> | null = null;
  let validation: ValidationResult | null = null;

  try {
    applied = applyRule(rule, input.payload);
    validation = validateContract(applied, input.contract);
    if (!validation.valid) {
      errors.push(`Gate 4: ${describeValidationFailure(validation)}`);
    }
  } catch (error) {
    errors.push(`Gate 4: ${error instanceof Error ? error.message : String(error)}`);
  }

  const unmappableRequired = rule.unmappable.filter((field) =>
    expectedFields.includes(field),
  );
  if (unmappableRequired.length > 0) {
    errors.push(
      `Gate 5: required fields marked unmappable: ${unmappableRequired.join(', ')}`,
    );
  }

  const ok = errors.length === 0 && applied !== null && validation !== null && validation.valid;

  return {
    ok,
    errors,
    applied: ok ? applied : null,
    validation,
  };
}

export function missingRequiredFields(contract: Contract, payload: unknown): string[] {
  if (!isObject(payload)) return Object.keys(contract.expected_schema);
  return Object.keys(contract.expected_schema).filter(
    (field) => !Object.prototype.hasOwnProperty.call(payload, field),
  );
}

export function isFieldMapping(value: unknown): value is FieldMapping {
  return mappingSchema.safeParse(value).success;
}
