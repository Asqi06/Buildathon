// src/healer/groq-llm.ts
import type { MappingRule } from '../types.js';
import type { LlmMapper, MapperInput } from './mock-llm.js';
import { mappingRuleSchema } from './rule.js';
import { LlmError } from './llm.js';

export interface GroqMapperOptions {
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
- Output JSON ONLY, no markdown, no explanation. Just raw JSON matching this exact schema:
{"fields": {"fieldName": {"from": "path.or.null", "coerce": "none|string|number|boolean|iso_datetime"}}, "unmappable": [], "confidence": 0.95, "reasoning": "short text"}`;

export class GroqMapper implements LlmMapper {
  readonly mode = 'live' as const;
  readonly model: string | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(options: GroqMapperOptions) {
    this.model = options.model ?? null;
    this.apiKey = options.apiKey ?? null;
    this.timeoutMs = options.timeoutMs;
  }

  async map(input: MapperInput): Promise<MappingRule> {
    if (!this.apiKey || !this.model) {
      throw new LlmError('LLM_NOT_CONFIGURED', 'LLM_MODE=live requires GROQ_API_KEY and GROQ_MODEL.');
    }

    const prompt = [
      `Endpoint: ${input.method.toUpperCase()} ${input.endpoint}`,
      `Expected schema (field -> type): ${JSON.stringify(input.expectedSchema)}`,
      `Sanitized upstream structure: ${JSON.stringify(input.structure)}`,
      'Return the mapping rule JSON now. Output raw JSON only, no markdown.',
    ].join('\n\n');

    input.onAttempt?.();

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              messages: [
                { role: 'system', content: SYSTEM_INSTRUCTION },
                { role: 'user', content: prompt },
              ],
              temperature: 0,
              max_tokens: 1024,
              response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          if (response.status === 429 || response.status >= 500) {
            lastError = new LlmError('LLM_FAILED', `Groq returned ${response.status}: ${errText}`, true);
            if (attempt === 0) continue;
            throw lastError;
          }
          throw new LlmError('LLM_FAILED', `Groq returned ${response.status}: ${errText}`);
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data?.choices?.[0]?.message?.content ?? '';
        if (!text.trim()) {
          throw new LlmError('LLM_INVALID_OUTPUT', 'Groq returned an empty response.');
        }

        // Parse and validate
        let json: unknown;
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try {
          json = JSON.parse(cleaned);
        } catch {
          throw new LlmError('LLM_INVALID_OUTPUT', `Groq output was not JSON: ${text.slice(0, 200)}`);
        }

        const parsed = mappingRuleSchema.safeParse(json);
        if (!parsed.success) {
          const detail = parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ');
          throw new LlmError('LLM_INVALID_OUTPUT', `Groq rule failed validation: ${detail}`);
        }
        return parsed.data;
      } catch (error) {
        lastError = error;
        if (error instanceof LlmError && error.reason === 'LLM_INVALID_OUTPUT') throw error;
        if (attempt === 0 && error instanceof LlmError && error.retryable) continue;
        if (error instanceof LlmError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        throw new LlmError('LLM_FAILED', msg);
      }
    }
    throw lastError instanceof LlmError ? lastError : new LlmError('LLM_FAILED', String(lastError));
  }
}
