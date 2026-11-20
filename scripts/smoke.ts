import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.js';
import { buildMockServer } from '../src/mock-upstream/server.js';
import { buildServer } from '../src/server.js';
import { CHAOS_MODES, CHAOS_LABELS, BASELINE_PAYLOAD } from '../src/mock-upstream/scenarios.js';
import type { ChaosMode } from '../src/types.js';
import type { MetricsSnapshot } from '../src/metrics.js';
import { ContractRegistry } from '../src/contracts/registry.js';
import { validateContract } from '../src/contracts/validator.js';
import type { Contract } from '../src/types.js';

interface StateShape {
  status: string;
  rulesCount: number;
  metrics: MetricsSnapshot;
}

interface Row {
  mode: ChaosMode;
  http: number | string;
  status: string;
  valid: string;
  cached: string;
  llmCalls: string;
  result: 'PASS' | 'FAIL';
  note: string;
}

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function addressOf(app: { server: { address(): AddressInfo | string | null } }): string {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Server is not listening');
  return `http://127.0.0.1:${address.port}`;
}

async function readState(baseUrl: string): Promise<StateShape> {
  const response = await fetch(`${baseUrl}/__autopatch/api/state`);
  if (!response.ok) throw new Error(`state endpoint returned ${response.status}`);
  return (await response.json()) as StateShape;
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'autopatch-smoke-'));
  const registry = ContractRegistry.load(resolve('contracts'));
  const contract = registry.match('GET', '/api/v1/checkout/user');
  if (!contract) throw new Error('checkout contract was not loaded');

  const mock = await buildMockServer('none');
  await mock.app.listen({ port: 0, host: '127.0.0.1' });
  const mockUrl = addressOf(mock.app);

  const config = loadConfig({
    UPSTREAM_BASE_URL: mockUrl,
    DATA_DIR: dataDir,
    LLM_MODE: 'mock',
    PR_ENABLED: 'false',
  });
  const app = await buildServer({
    config,
    contractsDir: resolve('contracts'),
    publicDir: resolve('public'),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const proxyUrl = addressOf(app);

  const rows: Row[] = [];
  const runMode = async (
    mode: ChaosMode,
    expectStatus: string,
    expectHttp: number,
    expectValid: boolean,
  ): Promise<Response> => {
    mock.setMode(mode);
    const before = await readState(proxyUrl);
    const response = await fetch(`${proxyUrl}/api/v1/checkout/user`);
    const after = await readState(proxyUrl);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }

    const status = response.headers.get('x-autopatch-status') ?? 'missing';
    const cached = response.headers.get('x-autopatch-status') === 'healed-cached';
    const valid =
      expectValid && json !== null ? validateContract(json, contract as Contract).valid : expectValid;
    const llmDelta = after.metrics.llmCalls - before.metrics.llmCalls;
    const localFailures: string[] = [];

    try {
      assert.equal(response.status, expectHttp, `expected HTTP ${expectHttp}`);
      assert.equal(status, expectStatus, `expected status ${expectStatus}`);
      if (expectValid) {
        assert.ok(json !== null, 'response body was not JSON');
        assert.ok(validateContract(json, contract as Contract).valid, 'body failed the baseline contract');
      } else {
        const failureBody = json as { error?: string; reason?: string } | null;
        assert.equal(failureBody?.error, 'AUTOPATCH_UNRECOVERABLE');
        assert.ok(
          typeof failureBody?.reason === 'string' && failureBody.reason.length > 0,
          '502 body has no reason',
        );
      }
    } catch (error) {
      localFailures.push(error instanceof Error ? error.message : String(error));
    }

    if (localFailures.length > 0) failures.push(`${mode}: ${localFailures.join('; ')}`);

    rows.push({
      mode,
      http: response.status,
      status,
      valid: expectValid ? (valid ? 'yes' : 'no') : 'n/a',
      cached: cached ? 'yes' : 'no',
      llmCalls: `+${llmDelta}`,
      result: localFailures.length === 0 ? 'PASS' : 'FAIL',
      note: CHAOS_LABELS[mode].name,
    });

    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  };

  console.log('AutoPatch smoke: mock upstream + proxy, in-process, fresh rule cache.');
  console.log(`Contracts loaded: ${registry.size} · modes: ${CHAOS_MODES.length} · data: ${dataDir}\n`);

  const baselineResponse = await runMode('none', 'verified', 200, true);
  const baselineBody = (await baselineResponse.json()) as unknown;
  check(
    isDeepStrictEqual(baselineBody, BASELINE_PAYLOAD),
    'baseline body differs from the frozen baseline payload',
  );

  const coldModes: ChaosMode[] = [
    'rename',
    'nest',
    'type_mismatch',
    'array_wrap',
    'date_shift',
    'combo_v2',
  ];
  for (const mode of coldModes) {
    await runMode(mode, 'healed', 200, true);
  }

  const stateAfterCold = await readState(proxyUrl);
  const callsAfterCold = stateAfterCold.metrics.llmCalls;
  check(callsAfterCold === coldModes.length, `expected ${coldModes.length} LLM calls, saw ${callsAfterCold}`);
  check(stateAfterCold.rulesCount >= coldModes.length, 'rules were not persisted to the cache');

  await runMode('combo_v2', 'healed-cached', 200, true);
  for (let index = 0; index < 10; index += 1) {
    await runMode('combo_v2', 'healed-cached', 200, true);
    mock.setMode('none');
  }

  const stateAfterRepeats = await readState(proxyUrl);
  const repeatsDelta = stateAfterRepeats.metrics.llmCalls - callsAfterCold;
  check(repeatsDelta === 0, `10 cached repeats made ${repeatsDelta} LLM calls; expected 0`);

  await runMode('field_deleted', 'unrecoverable', 502, false);
  await runMode('none', 'verified', 200, true);

  const finalState = await readState(proxyUrl);
  const cold = finalState.metrics.coldHeal;
  const cached = finalState.metrics.cachedHeal;
  const overhead = finalState.metrics.verifiedOverhead;

  console.log('Mode            HTTP  Status          Valid  Cached  LLM   Result  Scenario');
  console.log('--------------  ----  --------------  -----  ------  ----  ------  --------------------------');
  for (const row of rows) {
    console.log(
      `${row.mode.padEnd(14)}  ${String(row.http).padEnd(4)}  ${row.status.padEnd(14)}  ${row.valid.padEnd(5)}  ${row.cached.padEnd(6)}  ${row.llmCalls.padEnd(4)}  ${row.result.padEnd(6)}  ${row.note}`,
    );
  }

  console.log('');
  console.log('Measured latency (localhost, excludes upstream time):');
  console.log(`  Verified overhead  mean ${overhead.mean.toFixed(2)} ms  p50 ${overhead.p50.toFixed(2)} ms  n=${overhead.count}`);
  console.log(`  Cached heal        mean ${cached.mean.toFixed(2)} ms  p50 ${cached.p50.toFixed(2)} ms  n=${cached.count}`);
  console.log(`  Cold heal          mean ${cold.mean.toFixed(2)} ms  p50 ${cold.p50.toFixed(2)} ms  n=${cold.count}`);
  console.log('');
  console.log(
    `LLM calls: ${finalState.metrics.llmCalls} total · saved by cache: ${finalState.metrics.llmCallsSaved} · rules: ${finalState.rulesCount}`,
  );

  await app.close();
  await mock.app.close();
  await rm(dataDir, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error('\nFAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: every expected status, body contract and cache effect held.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Smoke run failed: ${message}`);
  process.exitCode = 1;
});
