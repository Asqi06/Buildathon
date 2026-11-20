export type FieldType = 'string' | 'number' | 'boolean' | 'iso_datetime';

export type Coerce = 'none' | 'string' | 'number' | 'boolean' | 'iso_datetime';

export interface Contract {
  endpoint: string;
  method: string;
  expected_schema: Record<string, FieldType>;
}

export interface FieldMapping {
  from: string | null;
  coerce: Coerce;
}

export interface MappingRule {
  fields: Record<string, FieldMapping>;
  unmappable: string[];
  confidence: number;
  reasoning: string;
}

export interface RuleCacheEntry {
  key: string;
  endpoint: string;
  method: string;
  fingerprint: string;
  rule: MappingRule;
  sampleBefore: unknown;
  sampleAfter: Record<string, unknown>;
  sanitizedBefore: unknown;
  llmMode: 'live' | 'mock';
  model: string | null;
  createdAt: string;
}

export type AutopatchStatus = 'VERIFIED' | 'AUTO_HEALED' | 'UNRECOVERABLE' | 'PASSTHROUGH';

export const CHAOS_MODES = [
  'none',
  'rename',
  'nest',
  'type_mismatch',
  'array_wrap',
  'date_shift',
  'combo_v2',
  'field_deleted',
] as const;

export type ChaosMode = (typeof CHAOS_MODES)[number];

export type PrState = 'queued' | 'creating' | 'committing' | 'opened' | 'failed';

export interface WrongType {
  field: string;
  expected: FieldType;
  observed: string;
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  wrongTypes: WrongType[];
}

export interface AppConfig {
  port: number;
  upstreamBaseUrl: string;
  mockUpstreamPort: number;
  llmMode: 'live' | 'mock';
  geminiApiKey: string | undefined;
  geminiModel: string | undefined;
  groqApiKey?: string;
  groqModel?: string;
  llmTimeoutMs: number;
  minConfidence: number;
  prEnabled: boolean;
  githubToken: string | undefined;
  githubOwner: string | undefined;
  githubRepo: string | undefined;
  githubBaseBranch: string | undefined;
  dataDir: string;
}
