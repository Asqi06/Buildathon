import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Contract, FieldType, LearnedContract } from '../types.js';
import { isIsoDatetime } from './validator.js';
import { isObject } from '../util.js';

const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'iso_datetime']);

const contractSchema = z.object({
  endpoint: z.string().min(1),
  method: z.string().min(1),
  expected_schema: z.record(z.string().min(1), fieldTypeSchema),
});

function inferFieldType(val: unknown): FieldType {
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'string') {
    if (isIsoDatetime(val)) return 'iso_datetime';
    return 'string';
  }
  return 'string';
}

export function inferSchemaFromPayload(payload: unknown): Record<string, FieldType> {
  if (!isObject(payload)) return {};
  const inferred: Record<string, FieldType> = {};
  for (const [k, v] of Object.entries(payload)) {
    inferred[k] = inferFieldType(v);
  }
  return inferred;
}

export class ContractRegistry {
  private readonly contracts: Contract[];
  private readonly learned = new Map<string, LearnedContract>();
  private learnModeEnabled = true;

  private constructor(contracts: Contract[]) {
    this.contracts = contracts;
  }

  static load(directory: string): ContractRegistry {
    const files = readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort();

    const contracts: Contract[] = [];

    for (const file of files) {
      const fullPath = join(directory, file);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(fullPath, 'utf8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Contract ${file} is not valid JSON: ${message}`);
      }

      const parsed = contractSchema.safeParse(raw);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'contract'}: ${issue.message}`)
          .join('; ');
        throw new Error(`Contract ${file} is invalid: ${detail}`);
      }

      contracts.push({
        endpoint: parsed.data.endpoint,
        method: parsed.data.method.toUpperCase(),
        expected_schema: parsed.data.expected_schema,
      });
    }

    return new ContractRegistry(contracts);
  }

  static fromContracts(contracts: Contract[]): ContractRegistry {
    return new ContractRegistry(contracts.map((contract) => ({ ...contract })));
  }

  match(method: string, path: string): Contract | undefined {
    const normalizedMethod = method.toUpperCase();
    return this.contracts.find(
      (contract) => contract.method === normalizedMethod && contract.endpoint === path,
    );
  }

  all(): Contract[] {
    return [...this.contracts];
  }

  upsert(contract: Contract): Contract {
    const normalizedMethod = contract.method.toUpperCase();
    const cleaned: Contract = {
      method: normalizedMethod,
      endpoint: contract.endpoint,
      expected_schema: { ...contract.expected_schema },
    };
    const existingIndex = this.contracts.findIndex(
      (c) => c.method === normalizedMethod && c.endpoint === contract.endpoint,
    );
    if (existingIndex >= 0) {
      this.contracts[existingIndex] = cleaned;
    } else {
      this.contracts.push(cleaned);
    }
    return cleaned;
  }

  get size(): number {
    return this.contracts.length;
  }

  isLearnMode(): boolean {
    return this.learnModeEnabled;
  }

  setLearnMode(enabled: boolean): void {
    this.learnModeEnabled = enabled;
  }

  getLearnedContracts(): LearnedContract[] {
    return Array.from(this.learned.values());
  }

  recordLearnSample(
    method: string,
    endpoint: string,
    payload: unknown,
    threshold = 25,
  ): LearnedContract | null {
    if (!this.learnModeEnabled || !isObject(payload)) return null;

    const normalizedMethod = method.toUpperCase();
    const key = `${normalizedMethod} ${endpoint}`;

    // Infer schema from payload
    const inferred: Record<string, FieldType> = {};
    for (const [k, v] of Object.entries(payload)) {
      inferred[k] = inferFieldType(v);
    }

    let existing = this.learned.get(key);
    if (!existing) {
      existing = {
        endpoint,
        method: normalizedMethod,
        samplesObserved: 1,
        sampleThreshold: threshold,
        isLocked: false,
        inferredSchema: inferred,
        lastUpdated: new Date().toISOString(),
      };
      this.learned.set(key, existing);
    } else {
      existing.samplesObserved += 1;
      // Merge keys
      for (const [k, v] of Object.entries(inferred)) {
        if (!existing.inferredSchema[k]) {
          existing.inferredSchema[k] = v;
        }
      }
      existing.lastUpdated = new Date().toISOString();
    }

    // Auto-lock if threshold reached and not already registered in contracts
    if (existing.samplesObserved >= existing.sampleThreshold && !existing.isLocked) {
      this.lockLearned(normalizedMethod, endpoint);
    }

    return existing;
  }

  lockLearned(method: string, endpoint: string): Contract | null {
    const normalizedMethod = method.toUpperCase();
    const key = `${normalizedMethod} ${endpoint}`;
    const item = this.learned.get(key);
    if (!item) return null;

    item.isLocked = true;
    const existingIndex = this.contracts.findIndex(
      (c) => c.method === normalizedMethod && c.endpoint === endpoint,
    );

    const newContract: Contract = {
      endpoint,
      method: normalizedMethod,
      expected_schema: { ...item.inferredSchema },
    };

    if (existingIndex >= 0) {
      this.contracts[existingIndex] = newContract;
    } else {
      this.contracts.push(newContract);
    }

    return newContract;
  }
}
