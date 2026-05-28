const { spawn } = require('node:child_process');

const commands = [
  ['start:api', 'api'],
  ['start:fake-erp', 'fake-erp'],
  ['start:outbox-worker', 'outbox-worker'],
  ['start:order-worker', 'order-worker'],
  ['start:reconciliation-worker', 'reconciliation-worker']
];

const children = [];
const npmExecPath = process.env.npm_execpath;
const nodeExecPath = process.env.npm_node_execpath || process.execPath;

function shutdown(exitCode) {
  for (const child of children) {
    child.kill('SIGTERM');
  }

  process.exit(exitCode);
}

for (const [scriptName, label] of commands) {
  const child = npmExecPath
    ? spawn(nodeExecPath, [npmExecPath, 'run', scriptName], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      })
    : spawn('npm', ['run', scriptName], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });

  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
