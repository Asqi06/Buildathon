import { describe, expect, it, vi } from 'vitest';
import { GroqMapper } from '../src/healer/groq-llm.js';
import { LlmError } from '../src/healer/llm.js';

describe('GroqMapper', () => {
  it('throws LLM_NOT_CONFIGURED when apiKey is missing', async () => {
    const mapper = new GroqMapper({
      apiKey: undefined,
      model: 'llama-3.1-8b-instant',
      timeoutMs: 5000,
    });

    await expect(
      mapper.map({
        endpoint: '/api/v1/checkout/user',
        method: 'GET',
        expectedSchema: { user_id: 'string' },
        structure: { id: 'string' },
      }),
    ).rejects.toThrowError(LlmError);
  });

  it('parses valid Groq completion JSON', async () => {
    const fakeRule = {
      fields: {
        user_id: { from: 'id', coerce: 'none' },
      },
      unmappable: [],
      confidence: 0.95,
      reasoning: 'Mapped id to user_id',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(fakeRule) } }],
      }),
    } as unknown as Response);

    try {
      const mapper = new GroqMapper({
        apiKey: 'gsk_fake_key_123',
        model: 'llama-3.1-8b-instant',
        timeoutMs: 5000,
      });

      const rule = await mapper.map({
        endpoint: '/api/v1/checkout/user',
        method: 'GET',
        expectedSchema: { user_id: 'string' },
        structure: { id: 'string' },
      });

      expect(rule.fields.user_id?.from).toBe('id');
      expect(rule.confidence).toBe(0.95);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws LLM_INVALID_OUTPUT when Groq returns non-JSON', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Sorry, I cannot do that.' } }],
      }),
    } as unknown as Response);

    try {
      const mapper = new GroqMapper({
        apiKey: 'gsk_fake_key_123',
        model: 'llama-3.1-8b-instant',
        timeoutMs: 5000,
      });

      await expect(
        mapper.map({
          endpoint: '/api/v1/checkout/user',
          method: 'GET',
          expectedSchema: { user_id: 'string' },
          structure: { id: 'string' },
        }),
      ).rejects.toThrowError(/not JSON/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
