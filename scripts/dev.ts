import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const initial = Bun.spawn([process.execPath, 'run', 'build'], {
  cwd: root,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
if ((await initial.exited) !== 0) process.exit(1);
const children = [
  Bun.spawn(
    [
      process.execPath,
      resolve(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--watch',
      '--emptyOutDir',
      'false',
    ],
    { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  ),
  Bun.spawn([process.execPath, '--watch', 'src/cli.ts', 'ui', ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, RIGSHELF_DEV: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
];
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
}
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  stop();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
process.stdout.write(
  'Frontend changes rebuild automatically. The workbench offers Reload when a new build is ready; drafts are never discarded automatically.\n',
);
const first = await Promise.race(
  children.map(async (child) => ({ child, code: await child.exited })),
);
stop();
await Promise.all(children.map((child) => child.exited));
process.exitCode = interrupted ? 0 : first.code;
