import { Octokit } from '@octokit/rest';
import type { AppConfig, PrState, RuleCacheEntry } from '../types.js';
import type { EventHub } from '../events.js';
import type { MetricsStore } from '../metrics.js';
import {
  buildPrBody,
  generateAdapter,
  slugForEndpoint,
  verifyGeneratedAdapter,
} from './codegen.js';

export interface PrQueueOptions {
  config: AppConfig;
  events: EventHub;
  metrics: MetricsStore;
}

export interface PrJobView {
  key: string;
  state: PrState;
  title: string;
  branch: string | null;
  url: string | null;
  error: string | null;
}

export class PrQueue {
  private readonly seen = new Set<string>();
  private readonly latestEntry = new Map<string, RuleCacheEntry>();
  private latest: PrJobView | null = null;

  constructor(private readonly options: PrQueueOptions) {}

  get latestJob(): PrJobView | null {
    return this.latest;
  }

  enqueue(entry: RuleCacheEntry): void {
    const key = `${entry.method} ${entry.endpoint} ${entry.fingerprint}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.latestEntry.set(key, entry);
    this.update(key, {
      key,
      state: 'queued',
      title: this.titleFor(entry),
      branch: null,
      url: null,
      error: null,
    });

    void Promise.resolve().then(() => this.run(entry));
  }

  retryLatest(): { ok: boolean; error?: string } {
    if (!this.latestEntry.size) {
      return { ok: false, error: 'No verified heal has been captured yet.' };
    }
    const entries = [...this.latestEntry.values()];
    const entry = entries[entries.length - 1];
    if (!entry) return { ok: false, error: 'No verified heal has been captured yet.' };
    const key = `${entry.method} ${entry.endpoint} ${entry.fingerprint}`;
    this.seen.delete(key);
    this.enqueue(entry);
    return { ok: true };
  }

  private titleFor(entry: RuleCacheEntry): string {
    return `AutoPatch: adapt ${entry.endpoint} to upstream schema change`;
  }

  private update(key: string, view: PrJobView): void {
    this.latest = view;
    this.options.events.emit({
      type: 'pr',
      key,
      ts: new Date().toISOString(),
      endpoint: this.latestEntry.get(key)?.endpoint ?? '',
      fingerprint: this.latestEntry.get(key)?.fingerprint ?? '',
      state: view.state,
      title: view.title,
      branch: view.branch,
      url: view.url,
      error: view.error,
    });

    if (view.state === 'opened') this.options.metrics.recordPrOpened();
    if (view.state === 'failed') this.options.metrics.recordPrFailed();
  }

  private async run(entry: RuleCacheEntry): Promise<void> {
    const key = `${entry.method} ${entry.endpoint} ${entry.fingerprint}`;
    const title = this.titleFor(entry);
    const { config } = this.options;

    const missingConfig: string[] = [];
    if (!config.prEnabled) missingConfig.push('PR_ENABLED=true');
    if (!config.githubToken) missingConfig.push('GITHUB_TOKEN');
    if (!config.githubOwner) missingConfig.push('GITHUB_OWNER');
    if (!config.githubRepo) missingConfig.push('GITHUB_REPO');

    if (missingConfig.length > 0) {
      this.update(key, {
        key,
        state: 'failed',
        title,
        branch: null,
        url: null,
        error: `GitHub PR generation is not available. Set ${missingConfig.join(', ')} and retry.`,
      });
      return;
    }

    try {
      const generated = generateAdapter(entry);
      const verification = await verifyGeneratedAdapter(
        generated,
        entry.sampleBefore,
        entry.sampleAfter,
      );
      if (!verification.ok) {
        this.update(key, {
          key,
          state: 'failed',
          title,
          branch: null,
          url: null,
          error: `Generated adapter failed in-process verification: ${verification.error}`,
        });
        return;
      }

      const branch = `autopatch/fix-schema-${Date.now()}`;
      this.update(key, {
        key,
        state: 'creating',
        title,
        branch,
        url: null,
        error: null,
      });

      const octokit = new Octokit({ auth: config.githubToken });
      const owner = config.githubOwner as string;
      const repo = config.githubRepo as string;

      const repository = await octokit.repos.get({ owner, repo });
      const base = config.githubBaseBranch ?? repository.data.default_branch;
      const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` });
      const headSha = ref.data.object.sha;

      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: headSha,
      });

      this.update(key, {
        key,
        state: 'committing',
        title,
        branch,
        url: null,
        error: null,
      });

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: generated.adapterPath,
        branch,
        message: `AutoPatch: add ${slugForEndpoint(entry.endpoint)} adapter`,
        content: Buffer.from(generated.adapterCode, 'utf8').toString('base64'),
      });

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: generated.testPath,
        branch,
        message: `AutoPatch: test ${slugForEndpoint(entry.endpoint)} adapter`,
        content: Buffer.from(generated.testCode, 'utf8').toString('base64'),
      });

      const pull = await octokit.pulls.create({
        owner,
        repo,
        title,
        head: branch,
        base,
        body: buildPrBody(entry),
      });

      this.update(key, {
        key,
        state: 'opened',
        title,
        branch,
        url: pull.data.html_url,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update(key, {
        key,
        state: 'failed',
        title,
        branch: null,
        url: null,
        error: message,
      });
    }
  }
}
