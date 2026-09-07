import { spawn } from 'node:child_process';
const children = [
  spawn('npx', ['tsx', 'watch', 'server/local.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite', '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', () => {
    stop();
  });
