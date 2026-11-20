import { describe, expect, it } from 'vitest';
import { loadConfig, redactedConfigSummary } from '../src/config.js';

describe('loadConfig', () => {
  it('parses values, strips a trailing slash and freezes the config', () => {
    const config = loadConfig({
      PORT: '9090',
      UPSTREAM_BASE_URL: 'http://localhost:4555/',
      MOCK_UPSTREAM_PORT: '4555',
      LLM_MODE: 'mock',
      LLM_TIMEOUT_MS: '1500',
      MIN_CONFIDENCE: '0.85',
      PR_ENABLED: 'false',
      DATA_DIR: './test-data',
    });

    expect(config.port).toBe(9090);
    expect(config.upstreamBaseUrl).toBe('http://localhost:4555');
    expect(config.llmMode).toBe('mock');
    expect(config.llmTimeoutMs).toBe(1500);
    expect(config.minConfidence).toBe(0.85);
    expect(config.prEnabled).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('treats empty optional secrets as undefined', () => {
    const config = loadConfig({
      GEMINI_API_KEY: '',
      GEMINI_MODEL: '',
      GITHUB_TOKEN: '',
      GITHUB_OWNER: '',
      GITHUB_REPO: '',
    });
    expect(config.geminiApiKey).toBeUndefined();
    expect(config.geminiModel).toBeUndefined();
    expect(config.githubToken).toBeUndefined();
    expect(config.githubOwner).toBeUndefined();
    expect(config.githubRepo).toBeUndefined();
  });

  it('rejects invalid ports, modes and confidence values', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => loadConfig({ LLM_MODE: 'maybe' })).toThrow(/LLM_MODE/);
    expect(() => loadConfig({ MIN_CONFIDENCE: '1.4' })).toThrow(/MIN_CONFIDENCE/);
    expect(() => loadConfig({ PR_ENABLED: 'yes' })).toThrow(/PR_ENABLED/);
  });

  it('reports PR enabled only when the flag is exactly true', () => {
    expect(loadConfig({ PR_ENABLED: 'true' }).prEnabled).toBe(true);
    expect(loadConfig({ PR_ENABLED: 'false' }).prEnabled).toBe(false);
  });
});

describe('redactedConfigSummary', () => {
  it('never exposes secrets or tokens', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'AIza-super-secret',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GITHUB_TOKEN: 'ghp_super_secret',
      GITHUB_OWNER: 'acme',
      GITHUB_REPO: 'checkout',
      PR_ENABLED: 'true',
    });

    const summary = redactedConfigSummary(config);
    const serialized = JSON.stringify(summary);

    expect(summary.geminiConfigured).toBe(true);
    expect(summary.githubConfigured).toBe(true);
    expect(summary.prEnabled).toBe(true);
    expect(summary.geminiModel).toBe('gemini-2.5-flash');
    expect(serialized).not.toContain('AIza-super-secret');
    expect(serialized).not.toContain('ghp_super_secret');
  });

  it('reports incomplete credentials as not configured', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'key-without-model',
      GEMINI_MODEL: '',
      GITHUB_TOKEN: 'token-without-repo',
      GITHUB_OWNER: 'acme',
      GITHUB_REPO: '',
    });
    const summary = redactedConfigSummary(config);
    expect(summary.geminiConfigured).toBe(false);
    expect(summary.githubConfigured).toBe(false);
  });
});
