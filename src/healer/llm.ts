import { GoogleGenAI, Type } from '@google/genai';
import type { Schema } from '@google/genai';
import type { MappingRule } from '../types.js';
import type { LlmMapper, MapperInput } from './mock-llm.js';
import { mappingRuleSchema } from './rule.js';

export type LlmFailureReason =
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_TIMEOUT'
  | 'LLM_INVALID_OUTPUT'
  | 'LLM_FAILED';

export class LlmError extends Error {
  readonly reason: LlmFailureReason;
  readonly retryable: boolean;

  constructor(reason: LlmFailureReason, message: string, retryable = false) {
    super(message);
    this.name = 'LlmError';
    this.reason = reason;
    this.retryable = retryable;
  }
}

export interface GeminiMapperOptions {
  apiKey: string | undefined;
  model: string | undefined;
  timeoutMs: number;
}

const SYSTEM_INSTRUCTION = `You map upstream JSON fields onto an expected response contract.
Rules:
- Use only dot paths that exist in the provided sanitized structure. Array indexes use [n], for example data[0].email.
- Never invent fields, paths, or values.
- If no equivalent exists for a required field, set "from" to null and list the field in "unmappable".
- Choose the coercion needed to satisfy the expected type: none, string, number, boolean, iso_datetime.
- Values in the structure are value classes, not real values.
- Output JSON only, matching the provided schema.`;

function buildResponseSchema(expectedSchema: Record<string, string>): Schema {
  const fieldProperties: Record<string, Schema> = {};
  for (const field of Object.keys(expectedSchema)) {
    fieldProperties[field] = {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, nullable: true },
        coerce: {
          type: Type.STRING,
          enum: ['none', 'string', 'number', 'boolean', 'iso_datetime'],
        },
      },
      required: ['from', 'coerce'],
    };
  }

  return {
    type: Type.OBJECT,
    properties: {
      fields: {
        type: Type.OBJECT,
        properties: fieldProperties,
        required: Object.keys(expectedSchema),
      },
      unmappable: { type: Type.ARRAY, items: { type: Type.STRING } },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
    },
    required: ['fields', 'unmappable', 'confidence', 'reasoning'],
  };
}

function buildPrompt(input: MapperInput): string {
  return [
    `Endpoint: ${input.method.toUpperCase()} ${input.endpoint}`,
    `Expected schema (field -> type): ${JSON.stringify(input.expectedSchema)}`,
    `Sanitized upstream structure: ${JSON.stringify(input.structure)}`,
    'Return the mapping rule JSON now.',
  ].join('\n\n');
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError) return error.retryable;
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(code)) {
      return true;
    }
  }
  if (error instanceof Error) {
    return /fetch failed|network|socket|timeout|aborted/i.test(error.message);
  }
  return false;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class GeminiMapper implements LlmMapper {
  readonly mode = 'live' as const;
  readonly model: string | null;
  private readonly client: GoogleGenAI | null;
  private readonly timeoutMs: number;

  constructor(options: GeminiMapperOptions) {
    this.model = options.model ?? null;
    this.timeoutMs = options.timeoutMs;
    this.client =
      options.apiKey && options.model
        ? new GoogleGenAI({ apiKey: options.apiKey })
        : null;
  }

  async map(input: MapperInput): Promise<MappingRule> {
    if (!this.client || !this.model) {
      throw new LlmError(
        'LLM_NOT_CONFIGURED',
        'LLM_MODE=live requires both GEMINI_API_KEY and GEMINI_MODEL.',
      );
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      input.onAttempt?.();
      try {
        const text = await this.request(input);
        return this.parse(text);
      } catch (error) {
        lastError = error;
        if (error instanceof LlmError && error.reason === 'LLM_INVALID_OUTPUT') throw error;
        if (attempt === 0 && isRetryable(error)) continue;
        if (error instanceof LlmError) throw error;
        throw new LlmError('LLM_FAILED', errorDetail(error), isRetryable(error));
      }
    }

    throw new LlmError('LLM_FAILED', errorDetail(lastError), true);
  }

  private async request(input: MapperInput): Promise<string> {
    if (!this.client || !this.model) {
      throw new LlmError('LLM_NOT_CONFIGURED', 'Gemini is not configured.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildPrompt(input),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: buildResponseSchema(input.expectedSchema),
          abortSignal: controller.signal,
          httpOptions: { timeout: this.timeoutMs },
        },
      });

      const text = response.text;
      if (!text || text.trim() === '') {
        throw new LlmError('LLM_INVALID_OUTPUT', 'Gemini returned an empty response.');
      }
      return text;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmError(
          'LLM_TIMEOUT',
          `Gemini did not answer within ${this.timeoutMs} ms.`,
          true,
        );
      }
      if (error instanceof LlmError) throw error;
      throw new LlmError('LLM_FAILED', errorDetail(error), isRetryable(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(text: string): MappingRule {
    let json: unknown;
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    try {
      json = JSON.parse(cleaned);
    } catch (error) {
      throw new LlmError('LLM_INVALID_OUTPUT', `Gemini output was not JSON: ${errorDetail(error)}`);
    }

    const parsed = mappingRuleSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'rule'} ${issue.message}`)
        .join('; ');
      throw new LlmError('LLM_INVALID_OUTPUT', `Gemini rule failed schema validation: ${detail}`);
    }

    return parsed.data;
  }
}
