import { loadConfig } from '../src/config.js';
import { buildMockServer } from '../src/mock-upstream/server.js';
import { buildServer } from '../src/server.js';
import type { ChaosMode } from '../src/types.js';

const WARM_MODES: ChaosMode[] = [
  'rename',
  'nest',
  'type_mismatch',
  'array_wrap',
  'date_shift',
  'combo_v2',
];

async function main(): Promise<void> {
  const mock = await buildMockServer('none');
  await mock.app.listen({ port: 0, host: '127.0.0.1' });
  const address = mock.app.server.address();
  if (!address || typeof address === 'string') throw new Error('mock upstream did not bind');
  const upstream = `http://127.0.0.1:${address.port}`;

  const config = loadConfig({ UPSTREAM_BASE_URL: upstream, PR_ENABLED: 'false' });
  const app = await buildServer({ config });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const proxyAddress = app.server.address();
  if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('AutoPatch did not bind');
  const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;

  console.log(`Prewarming ${WARM_MODES.length} scenarios with LLM_MODE=${config.llmMode}.`);
  if (config.llmMode === 'mock') {
    console.log('Mock mode: rules are canned and labelled as mock. Set LLM_MODE=live + a key to prewarm live rules.');
  }

  for (const mode of WARM_MODES) {
    mock.setMode(mode);
    const started = performance.now();
    const response = await fetch(`${proxyUrl}/api/v1/checkout/user`);
    const elapsed = performance.now() - started;
    const status = response.headers.get('x-autopatch-status') ?? 'missing';
    const bodyText = await response.text();
    console.log(
      `  ${mode.padEnd(14)} ${String(response.status).padEnd(4)} ${status.padEnd(14)} ${elapsed.toFixed(0).padStart(5)} ms  ${bodyText.length} bytes`,
    );
    if (response.status !== 200) {
      throw new Error(`prewarm failed for ${mode}: HTTP ${response.status} ${bodyText}`);
    }
  }

  mock.setMode('none');
  console.log(`Cache now holds ${(await app.inject({ method: 'GET', url: '/__autopatch/api/rules' })).json().length} rules.`);
  await app.close();
  await mock.app.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Prewarm failed: ${message}`);
  process.exitCode = 1;
});
