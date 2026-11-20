import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Contract } from '../types.js';

const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'iso_datetime']);

const contractSchema = z.object({
  endpoint: z.string().min(1),
  method: z.string().min(1),
  expected_schema: z.record(z.string().min(1), fieldTypeSchema),
});

export class ContractRegistry {
  private readonly contracts: Contract[];

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

  get size(): number {
    return this.contracts.length;
  }
}
