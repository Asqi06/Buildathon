import dotenv from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from './types.js';

delete process.env.GOOGLE_GEMINI_BASE_URL;
dotenv.config({ quiet: true, override: true });

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
};

const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalText = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8080)),
  UPSTREAM_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('http://localhost:4000'),
  ),
  MOCK_UPSTREAM_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(4000),
  ),
  LLM_MODE: z.preprocess(emptyToUndefined, z.enum(['live', 'mock']).default('mock')),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: optionalText,
  GROQ_API_KEY: optionalSecret,
  GROQ_MODEL: optionalText,
  LLM_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(500).max(120000).default(30000),
  ),
  MIN_CONFIDENCE: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(1).default(0.7),
  ),
  PR_ENABLED: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false')),
  GITHUB_TOKEN: optionalSecret,
  GITHUB_OWNER: optionalText,
  GITHUB_REPO: optionalText,
  GITHUB_BASE_BRANCH: optionalText,
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default('./data')),
});

export type EnvOverrides = Record<string, string | undefined>;

export function loadConfig(overrides: EnvOverrides = {}): AppConfig {
  const fallbackAiStudioKey =
    overrides.GEMINI_API_KEY === undefined && !process.env.GEMINI_API_KEY
      ? process.env.API_KEY || process.env.GOOGLE_API_KEY
      : undefined;
  const fallbackAiStudioModel =
    overrides.GEMINI_MODEL === undefined && !process.env.GEMINI_MODEL && fallbackAiStudioKey
      ? 'gemini-2.0-flash'
      : undefined;

  const defaultDataDir =
    overrides.DATA_DIR === undefined && !process.env.DATA_DIR && process.env.VERCEL
      ? '/tmp/autopatch-data'
      : undefined;

  const merged: EnvOverrides = {
    ...process.env,
    ...(fallbackAiStudioKey ? { GEMINI_API_KEY: fallbackAiStudioKey } : {}),
    ...(fallbackAiStudioModel ? { GEMINI_MODEL: fallbackAiStudioModel } : {}),
    ...(defaultDataDir ? { DATA_DIR: defaultDataDir } : {}),
    ...overrides,
  };
  const parsed = envSchema.safeParse(merged);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }

  const env = parsed.data;

  return Object.freeze({
    port: env.PORT,
    upstreamBaseUrl: env.UPSTREAM_BASE_URL.replace(/\/+$/, ''),
    mockUpstreamPort: env.MOCK_UPSTREAM_PORT,
    llmMode: env.LLM_MODE,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    minConfidence: env.MIN_CONFIDENCE,
    prEnabled: env.PR_ENABLED === 'true',
    githubToken: env.GITHUB_TOKEN,
    githubOwner: env.GITHUB_OWNER,
    githubRepo: env.GITHUB_REPO,
    githubBaseBranch: env.GITHUB_BASE_BRANCH,
    dataDir: env.DATA_DIR,
  });
}

export interface ConfigSummary {
  port: number;
  upstreamBaseUrl: string;
  llmMode: 'live' | 'mock';
  geminiConfigured: boolean;
  geminiModel: string | null;
  groqConfigured: boolean;
  groqModel: string | null;
  llmModel: string | null;
  githubConfigured: boolean;
  prEnabled: boolean;
  minConfidence: number;
  llmTimeoutMs: number;
}

export function redactedConfigSummary(config: AppConfig): ConfigSummary {
  return {
    port: config.port,
    upstreamBaseUrl: config.upstreamBaseUrl,
    llmMode: config.llmMode,
    geminiConfigured: Boolean(config.geminiApiKey && config.geminiModel),
    geminiModel: config.geminiModel ?? null,
    groqConfigured: Boolean(config.groqApiKey && config.groqModel),
    groqModel: config.groqModel ?? null,
    llmModel: config.groqModel ?? config.geminiModel ?? null,
    githubConfigured: Boolean(
      config.githubToken && config.githubOwner && config.githubRepo,
    ),
    prEnabled: config.prEnabled,
    minConfidence: config.minConfidence,
    llmTimeoutMs: config.llmTimeoutMs,
  };
}
