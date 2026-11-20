import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventHub, type AutopatchEvent } from '../src/events.js';
import { MetricsStore } from '../src/metrics.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MetricsStore', () => {
  it('starts at zero with empty latency samples', () => {
    const metrics = new MetricsStore();
    expect(metrics.snapshot()).toMatchObject({
      requests: 0,
      verified: 0,
      healedCold: 0,
      healedCached: 0,
      crashesPrevented: 0,
      unrecoverable: 0,
      passthrough: 0,
      llmCalls: 0,
      llmCallsSaved: 0,
      prsOpened: 0,
      prsFailed: 0,
    });
    expect(metrics.snapshot().verifiedOverhead).toEqual({ count: 0, mean: 0, p50: 0 });
  });

  it('records request outcomes and derives crash prevention from heals', () => {
    const metrics = new MetricsStore();
    metrics.recordVerified(4);
    metrics.recordVerified(8);
    metrics.recordHealed(false, 120);
    metrics.recordHealed(true, 6);
    metrics.recordHealed(true, 4);
    metrics.recordUnrecoverable();
    metrics.recordPassthrough(2);
    metrics.recordLlmCall();
    metrics.recordLlmCall();
    metrics.recordLlmCallSaved();
    metrics.recordPrOpened();
    metrics.recordPrFailed();

    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(7);
    expect(snapshot.verified).toBe(2);
    expect(snapshot.healedCold).toBe(1);
    expect(snapshot.healedCached).toBe(2);
    expect(snapshot.crashesPrevented).toBe(3);
    expect(snapshot.unrecoverable).toBe(1);
    expect(snapshot.passthrough).toBe(1);
    expect(snapshot.llmCalls).toBe(2);
    expect(snapshot.llmCallsSaved).toBe(1);
    expect(snapshot.prsOpened).toBe(1);
    expect(snapshot.prsFailed).toBe(1);
  });

  it('computes mean and lower-median p50 without including other samples', () => {
    const metrics = new MetricsStore();
    for (const sample of [10, 20, 30, 40]) metrics.recordVerified(sample);
    metrics.recordHealed(false, 500);
    metrics.recordHealed(true, 6);

    const snapshot = metrics.snapshot();
    expect(snapshot.verifiedOverhead).toEqual({ count: 4, mean: 25, p50: 20 });
    expect(snapshot.coldHeal).toEqual({ count: 1, mean: 500, p50: 500 });
    expect(snapshot.cachedHeal).toEqual({ count: 1, mean: 6, p50: 6 });
  });

  it('resets counters and samples', () => {
    const metrics = new MetricsStore();
    metrics.recordVerified(10);
    metrics.recordHealed(false, 30);
    metrics.recordLlmCall();
    metrics.reset();
    expect(metrics.snapshot().requests).toBe(0);
    expect(metrics.snapshot().verifiedOverhead.count).toBe(0);
    expect(metrics.snapshot().llmCalls).toBe(0);
  });
});

describe('EventHub', () => {
  const event: AutopatchEvent = {
    type: 'chaos',
    ts: '2026-11-14T09:30:00.000Z',
    mode: 'rename',
  };

  it('delivers events to every subscriber and stops after unsubscribe', () => {
    const hub = new EventHub();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = hub.subscribe(first);
    hub.subscribe(second);

    hub.emit(event);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);

    unsubscribe();
    hub.emit({ ...event, mode: 'nest' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing listener from the others', () => {
    const hub = new EventHub();
    const boom = vi.fn(() => {
      throw new Error('listener exploded');
    });
    const healthy = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    hub.subscribe(boom);
    hub.subscribe(healthy);
    expect(() => hub.emit(event)).not.toThrow();

    expect(healthy).toHaveBeenCalledWith(event);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('listener exploded'));
  });
});
