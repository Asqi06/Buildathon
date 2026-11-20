import type { AutopatchStatus, ChaosMode, MappingRule, PrState } from './types.js';
import type { MetricsSnapshot } from './metrics.js';

export interface RequestEvent {
  type: 'request';
  id: string;
  ts: string;
  method: string;
  path: string;
  status: AutopatchStatus;
  cached: boolean;
  httpStatus: number;
  upstreamMs: number;
  overheadMs: number;
  healMs: number | null;
  fingerprint: string | null;
  failure?: {
    reason: string;
    message: string;
    missingFields: string[];
    diagnostics: string[];
  };
}

export interface HealEvent {
  type: 'heal';
  requestId: string;
  ts: string;
  endpoint: string;
  method: string;
  fingerprint: string;
  cached: boolean;
  before: unknown;
  sanitized: unknown;
  after: unknown;
  rule: MappingRule | null;
  reasoning: string;
  model: string | null;
  llmMode: 'live' | 'mock';
}

export interface PrEvent {
  type: 'pr';
  key: string;
  ts: string;
  endpoint: string;
  fingerprint: string;
  state: PrState;
  title: string;
  branch: string | null;
  url: string | null;
  error: string | null;
}

export interface ChaosEvent {
  type: 'chaos';
  ts: string;
  mode: ChaosMode;
}

export interface MetricsEvent {
  type: 'metrics';
  ts: string;
  metrics: MetricsSnapshot;
}

export type AutopatchEvent = RequestEvent | HealEvent | PrEvent | ChaosEvent | MetricsEvent;

export type EventListener = (event: AutopatchEvent) => void;

export class EventHub {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AutopatchEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[events] listener failed: ${message}`);
      }
    }
  }
}
