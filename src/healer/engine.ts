import type {
  Contract,
  MappingRule,
  RuleCacheEntry,
} from '../types.js';
import type { MetricsStore } from '../metrics.js';
import { validateContract } from '../contracts/validator.js';
import { fingerprint } from './fingerprint.js';
import { sanitize } from './sanitizer.js';
import { LlmError } from './llm.js';
import type { LlmMapper } from './mock-llm.js';
import {
  applyRule,
  missingRequiredFields,
  resolvePath,
  verifyRule,
} from './rule.js';
import type { RuleCache } from './cache.js';

export interface HealInput {
  method: string;
  endpoint: string;
  contract: Contract;
  payload: unknown;
}

export interface HealSuccess {
  ok: true;
  cached: boolean;
  fingerprint: string;
  cacheKey: string;
  after: Record<string, unknown>;
  rule: MappingRule;
  sanitized: unknown;
  entry: RuleCacheEntry;
}

export interface HealFailure {
  ok: false;
  cached: false;
  fingerprint: string;
  cacheKey: string;
  reason: string;
  message: string;
  errors: string[];
  missingFields: string[];
  rule: MappingRule | null;
  sanitized: unknown;
}

export type HealOutcome = HealSuccess | HealFailure;

export interface HealEngineOptions {
  cache: RuleCache;
  mapper: LlmMapper;
  metrics: MetricsStore;
  minConfidence: number;
}

export class HealEngine {
  private readonly inFlight = new Map<string, Promise<HealOutcome>>();

  constructor(private readonly options: HealEngineOptions) {}

  get mapperMode(): 'live' | 'mock' {
    return this.options.mapper.mode;
  }

  get mapperModel(): string | null {
    return this.options.mapper.model;
  }

  async heal(input: HealInput): Promise<HealOutcome> {
    const fp = fingerprint(input.payload);
    const cacheKey = `${input.method.toUpperCase()} ${input.endpoint} ${fp}`;
    const cached = this.options.cache.get(cacheKey);

    if (cached) {
      try {
        const after = applyRule(cached.rule, input.payload);
        if (validateContract(after, input.contract).valid) {
          this.options.metrics.recordLlmCallSaved();
          return {
            ok: true,
            cached: true,
            fingerprint: fp,
            cacheKey,
            after,
            rule: cached.rule,
            sanitized: cached.sanitizedBefore,
            entry: cached,
          };
        }
      } catch {
        // A cached rule that no longer applies is discarded and re-derived below.
      }
      this.options.cache.delete(cacheKey);
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const promise = this.coldHeal(input, fp, cacheKey).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  private async coldHeal(
    input: HealInput,
    fp: string,
    cacheKey: string,
  ): Promise<HealOutcome> {
    const sanitized = sanitize(input.payload);
    let rule: MappingRule;

    try {
      rule = await this.options.mapper.map({
        endpoint: input.endpoint,
        method: input.method,
        expectedSchema: input.contract.expected_schema,
        structure: sanitized,
        onAttempt: () => this.options.metrics.recordLlmCall(),
      });
    } catch (error) {
      if (error instanceof LlmError) {
        return {
          ok: false,
          cached: false,
          fingerprint: fp,
          cacheKey,
          reason: error.reason,
          message: error.message,
          errors: [error.message],
          missingFields: missingRequiredFields(input.contract, input.payload),
          rule: null,
          sanitized,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        cached: false,
        fingerprint: fp,
        cacheKey,
        reason: 'LLM_FAILED',
        message,
        errors: [message],
        missingFields: missingRequiredFields(input.contract, input.payload),
        rule: null,
        sanitized,
      };
    }

    const verification = verifyRule({
      rule,
      contract: input.contract,
      payload: input.payload,
      minConfidence: this.options.minConfidence,
    });

    if (!verification.ok || !verification.applied) {
      return {
        ok: false,
        cached: false,
        fingerprint: fp,
        cacheKey,
        reason: 'RULE_VERIFICATION_FAILED',
        message: 'The proposed mapping rule failed verification; no data was served.',
        errors: verification.errors,
        missingFields: unmappedFields(rule, input),
        rule,
        sanitized,
      };
    }

    const after = verification.applied;
    const entry: RuleCacheEntry = {
      key: cacheKey,
      endpoint: input.endpoint,
      method: input.method.toUpperCase(),
      fingerprint: fp,
      rule,
      sampleBefore: input.payload,
      sampleAfter: after,
      sanitizedBefore: sanitized,
      llmMode: this.options.mapper.mode,
      model: this.options.mapper.model,
      createdAt: new Date().toISOString(),
    };
    this.options.cache.set(entry);

    return {
      ok: true,
      cached: false,
      fingerprint: fp,
      cacheKey,
      after,
      rule,
      sanitized,
      entry,
    };
  }
}

function unmappedFields(rule: MappingRule | null, input: HealInput): string[] {
  const missing = new Set(missingRequiredFields(input.contract, input.payload));
  if (!rule) return [...missing];

  for (const field of Object.keys(input.contract.expected_schema)) {
    const mapping = rule.fields[field];
    if (!mapping || mapping.from === null) {
      missing.add(field);
      continue;
    }
    try {
      if (!resolvePath(input.payload, mapping.from).found) missing.add(field);
    } catch {
      missing.add(field);
    }
  }

  return [...missing];
}
