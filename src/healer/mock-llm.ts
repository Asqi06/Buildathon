import type { MappingRule } from '../types.js';
import { resolvePath } from './rule.js';

export interface MapperInput {
  endpoint: string;
  method: string;
  expectedSchema: Record<string, string>;
  structure: unknown;
  onAttempt?: () => void;
}

export interface LlmMapper {
  readonly mode: 'live' | 'mock';
  readonly model: string | null;
  map(input: MapperInput): Promise<MappingRule>;
}

const CANDIDATES: Record<string, string[]> = {
  user_id: ['user_id', 'id', 'userId'],
  email: ['email', 'user_email', 'contact.email_addr', 'contact.email'],
  account_balance: ['account_balance', 'balance'],
  is_verified: ['is_verified', 'verified', 'isVerified'],
  created_at: ['created_at', 'created', 'createdAt'],
};

function unwrapPrefix(structure: unknown): string | null {
  if (typeof structure !== 'object' || structure === null) return null;
  const record = structure as Record<string, unknown>;
  if (Array.isArray(record.data) && record.data.length > 0) return 'data[0].';
  return null;
}

function sourceCandidates(field: string, prefix: string): string[] {
  const extra = [`${field}`, ...(CANDIDATES[field] ?? [])];
  return [...new Set(extra)].map((path) => `${prefix}${path}`);
}

function classOf(structure: unknown, path: string): string | null {
  const resolved = resolvePath(structure, path);
  if (!resolved.found) return null;
  return typeof resolved.value === 'string' ? resolved.value : null;
}

export class MockMapper implements LlmMapper {
  readonly mode = 'mock' as const;
  readonly model = 'mock-mapper-v1';

  async map(input: MapperInput): Promise<MappingRule> {
    input.onAttempt?.();
    const prefix = unwrapPrefix(input.structure) ?? '';
    const scoped = prefix === '' ? input.structure : resolvePath(input.structure, 'data[0]').value;

    const fields: MappingRule['fields'] = {};
    const unmappable: string[] = [];
    let missing = 0;

    for (const field of Object.keys(input.expectedSchema)) {
      const expectedType = input.expectedSchema[field] ?? 'string';
      let source: string | null = null;
      let sourceClass: string | null = null;

      for (const candidate of sourceCandidates(field, '')) {
        const foundClass = classOf(scoped, candidate);
        if (foundClass !== null) {
          source = `${prefix}${candidate}`;
          sourceClass = foundClass;
          break;
        }
      }

      if (source === null) {
        missing += 1;
        unmappable.push(field);
        fields[field] = { from: null, coerce: 'none' };
        continue;
      }

      let coerce: MappingRule['fields'][string]['coerce'] = 'none';
      if (expectedType === 'number') {
        coerce = sourceClass?.startsWith('string') ? 'number' : 'none';
      } else if (expectedType === 'boolean') {
        coerce = sourceClass?.startsWith('string') || sourceClass?.startsWith('number')
          ? 'boolean'
          : 'none';
      } else if (expectedType === 'iso_datetime') {
        if (sourceClass?.startsWith('number') || sourceClass === 'string:numeric') {
          coerce = 'iso_datetime';
        } else if (sourceClass === 'string') {
          coerce = 'iso_datetime';
        } else {
          coerce = 'none';
        }
      } else if (expectedType === 'string') {
        coerce = sourceClass?.startsWith('string') ? 'none' : 'string';
      }

      fields[field] = { from: source, coerce };
    }

    return {
      fields,
      unmappable,
      confidence: missing === 0 ? 0.95 : 0.35,
      reasoning:
        missing === 0
          ? `Mapped every baseline field from the observed structure${prefix ? ' inside data[0]' : ''}.`
          : `No source found for ${missing} baseline field${missing === 1 ? '' : 's'}; reported them as unmappable.`,
    };
  }
}
