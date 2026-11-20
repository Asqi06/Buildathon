export interface LatencyStats {
  count: number;
  mean: number;
  p50: number;
}

export interface MetricsSnapshot {
  requests: number;
  verified: number;
  healedCold: number;
  healedCached: number;
  crashesPrevented: number;
  unrecoverable: number;
  passthrough: number;
  llmCalls: number;
  llmCallsSaved: number;
  prsOpened: number;
  prsFailed: number;
  verifiedOverhead: LatencyStats;
  cachedHeal: LatencyStats;
  coldHeal: LatencyStats;
}

function stats(samples: number[]): LatencyStats {
  if (samples.length === 0) return { count: 0, mean: 0, p50: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, sample) => total + sample, 0);
  const index = Math.floor((sorted.length - 1) * 0.5);
  return {
    count: sorted.length,
    mean: round(sum / sorted.length),
    p50: round(sorted[index] ?? 0),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const MAX_LATENCY_SAMPLES = 1000;

function pushSample(buffer: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  if (buffer.length >= MAX_LATENCY_SAMPLES) {
    buffer.shift();
  }
  buffer.push(value);
}

export class MetricsStore {
  private verified = 0;
  private healedCold = 0;
  private healedCached = 0;
  private unrecoverable = 0;
  private passthrough = 0;
  private llmCalls = 0;
  private llmCallsSaved = 0;
  private prsOpened = 0;
  private prsFailed = 0;
  private overheadSamples: number[] = [];
  private cachedHealSamples: number[] = [];
  private coldHealSamples: number[] = [];

  recordVerified(overheadMs: number): void {
    this.verified += 1;
    pushSample(this.overheadSamples, overheadMs);
  }

  recordPassthrough(overheadMs: number): void {
    this.passthrough += 1;
    pushSample(this.overheadSamples, overheadMs);
  }

  recordHealed(cached: boolean, healMs: number): void {
    if (cached) {
      this.healedCached += 1;
      pushSample(this.cachedHealSamples, healMs);
    } else {
      this.healedCold += 1;
      pushSample(this.coldHealSamples, healMs);
    }
  }

  recordUnrecoverable(): void {
    this.unrecoverable += 1;
  }

  recordLlmCall(): void {
    this.llmCalls += 1;
  }

  recordLlmCallSaved(): void {
    this.llmCallsSaved += 1;
  }

  recordPrOpened(): void {
    this.prsOpened += 1;
  }

  recordPrFailed(): void {
    this.prsFailed += 1;
  }

  reset(): void {
    this.verified = 0;
    this.healedCold = 0;
    this.healedCached = 0;
    this.unrecoverable = 0;
    this.passthrough = 0;
    this.llmCalls = 0;
    this.llmCallsSaved = 0;
    this.prsOpened = 0;
    this.prsFailed = 0;
    this.overheadSamples = [];
    this.cachedHealSamples = [];
    this.coldHealSamples = [];
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: this.verified + this.healedCold + this.healedCached + this.unrecoverable + this.passthrough,
      verified: this.verified,
      healedCold: this.healedCold,
      healedCached: this.healedCached,
      crashesPrevented: this.healedCold + this.healedCached,
      unrecoverable: this.unrecoverable,
      passthrough: this.passthrough,
      llmCalls: this.llmCalls,
      llmCallsSaved: this.llmCallsSaved,
      prsOpened: this.prsOpened,
      prsFailed: this.prsFailed,
      verifiedOverhead: stats(this.overheadSamples),
      cachedHeal: stats(this.cachedHealSamples),
      coldHeal: stats(this.coldHealSamples),
    };
  }
}
