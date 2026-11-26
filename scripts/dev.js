import { spawn } from 'node:child_process';

const run = (command, args) => spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

const watcher = run(process.execPath, ['node_modules/rollup/dist/bin/rollup', '-c', '-w']);
const server = run(process.execPath, ['scripts/serve.js']);

const stop = () => {
  watcher.kill();
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
