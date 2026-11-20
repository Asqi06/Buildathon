import { spawn, type ChildProcess } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children: ChildProcess[] = [];

function launch(script: string): ChildProcess {
  const child = spawn(npm, ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev] ${script} exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0): void {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting mock upstream on :4000 and AutoPatch on :8080');
console.log('[dev] console: http://127.0.0.1:8080/console · demo: http://127.0.0.1:8080/demo');
launch('dev:mock');
launch('dev:proxy');
