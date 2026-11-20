import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RuleCacheEntry } from '../types.js';

interface CacheFile {
  version: 1;
  entries: RuleCacheEntry[];
}

function isCacheEntry(value: unknown): value is RuleCacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RuleCacheEntry>;
  return (
    typeof entry.key === 'string' &&
    typeof entry.endpoint === 'string' &&
    typeof entry.method === 'string' &&
    typeof entry.fingerprint === 'string' &&
    typeof entry.rule === 'object' &&
    entry.rule !== null &&
    typeof entry.createdAt === 'string'
  );
}

export class RuleCache {
  private readonly entries = new Map<string, RuleCacheEntry>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<CacheFile>;
      if (!Array.isArray(parsed.entries)) {
        throw new Error('entries is not an array');
      }
      let rejected = 0;
      for (const entry of parsed.entries) {
        if (isCacheEntry(entry)) {
          this.entries.set(entry.key, entry);
        } else {
          rejected += 1;
        }
      }
      if (rejected > 0) {
        console.warn(`[cache] ignored ${rejected} malformed rule entries in ${this.filePath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[cache] could not parse ${this.filePath} (${message}); starting empty`);
      this.entries.clear();
    }
  }

  get(key: string): RuleCacheEntry | undefined {
    return this.entries.get(key);
  }

  set(entry: RuleCacheEntry): void {
    this.entries.set(entry.key, entry);
    this.queuePersist();
  }

  delete(key: string): void {
    if (this.entries.delete(key)) this.queuePersist();
  }

  clear(): void {
    this.entries.clear();
    this.queuePersist();
  }

  list(): RuleCacheEntry[] {
    return [...this.entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get size(): number {
    return this.entries.size;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  private queuePersist(): void {
    this.writeChain = this.writeChain
      .then(async () => {
        const payload = JSON.stringify(
          { version: 1, entries: this.list() } satisfies CacheFile,
          null,
          2,
        );
        await mkdir(dirname(this.filePath), { recursive: true });
        const temporary = `${this.filePath}.${process.pid}.tmp`;
        await writeFile(temporary, payload, 'utf8');
        try {
          await rename(temporary, this.filePath);
        } catch {
          await writeFile(this.filePath, payload, 'utf8');
          await rm(temporary, { force: true }).catch(() => undefined);
        }
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[cache] failed to persist ${this.filePath}: ${message}`);
        await rm(`${this.filePath}.${process.pid}.tmp`, { force: true }).catch(() => undefined);
      });
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
