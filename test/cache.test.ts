import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleCache } from '../src/healer/cache.js';
import type { RuleCacheEntry } from '../src/types.js';

const directories: string[] = [];

async function temporaryCache(): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'autopatch-cache-'));
  directories.push(directory);
  return { directory, file: join(directory, 'rules.json') };
}

function entry(key: string, createdAt: string): RuleCacheEntry {
  return {
    key,
    endpoint: '/api/v1/checkout/user',
    method: 'GET',
    fingerprint: key.split(' ').at(-1) ?? 'fingerprint',
    rule: {
      fields: { user_id: { from: 'id', coerce: 'none' } },
      unmappable: [],
      confidence: 0.9,
      reasoning: 'test rule',
    },
    sampleBefore: { id: 'usr_99' },
    sampleAfter: { user_id: 'usr_99' },
    sanitizedBefore: { id: 'string' },
    llmMode: 'mock',
    model: 'mock-mapper-v1',
    createdAt,
  };
}

afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories.length = 0;
});

describe('RuleCache', () => {
  it('starts empty when the file does not exist', async () => {
    const { file } = await temporaryCache();
    const cache = new RuleCache(file);
    await cache.load();
    expect(cache.size).toBe(0);
    expect(cache.list()).toEqual([]);
  });

  it('persists rules atomically and reloads them sorted by creation time', async () => {
    const { file } = await temporaryCache();
    const cache = new RuleCache(file);
    await cache.load();

    const later = entry('GET /api/v1/checkout/user bbb', '2026-11-14T10:00:00.000Z');
    const earlier = entry('GET /api/v1/checkout/user aaa', '2026-11-14T09:00:00.000Z');
    cache.set(later);
    cache.set(earlier);
    await cache.flush();

    const raw = JSON.parse(await readFile(file, 'utf8')) as {
      version: number;
      entries: RuleCacheEntry[];
    };
    expect(raw.version).toBe(1);
    expect(raw.entries.map((item) => item.key)).toEqual([earlier.key, later.key]);

    const reloaded = new RuleCache(file);
    await reloaded.load();
    expect(reloaded.size).toBe(2);
    expect(reloaded.get(later.key)?.rule.confidence).toBe(0.9);
    expect(reloaded.get(earlier.key)?.createdAt).toBe('2026-11-14T09:00:00.000Z');
  });

  it('persists deletes and clears', async () => {
    const { file } = await temporaryCache();
    const cache = new RuleCache(file);
    await cache.load();
    cache.set(entry('GET /a aaa', '2026-11-14T09:00:00.000Z'));
    cache.set(entry('GET /b bbb', '2026-11-14T09:01:00.000Z'));
    await cache.flush();

    cache.delete('GET /a aaa');
    await cache.flush();
    const afterDelete = new RuleCache(file);
    await afterDelete.load();
    expect(afterDelete.size).toBe(1);

    afterDelete.clear();
    await afterDelete.flush();
    const cleared = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] };
    expect(cleared.entries).toEqual([]);
  });

  it('starts empty when the cache file is malformed', async () => {
    const { file } = await temporaryCache();
    await writeFile(file, '{not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cache = new RuleCache(file);
    await cache.load();
    expect(cache.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips invalid entries without discarding valid ones', async () => {
    const { file } = await temporaryCache();
    const valid = entry('GET /api/v1/checkout/user ccc', '2026-11-14T09:00:00.000Z');
    await writeFile(
      file,
      JSON.stringify({ version: 1, entries: [valid, { key: 'broken' }, null] }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cache = new RuleCache(file);
    await cache.load();
    expect(cache.size).toBe(1);
    expect(cache.get(valid.key)).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored 2 malformed rule entries'));
    warn.mockRestore();
  });
});
