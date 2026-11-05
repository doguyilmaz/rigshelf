import { mkdir } from 'node:fs/promises';

const directory = 'dist/prototypes';
const source = await Bun.file('design/prototypes/project-setup.html').text();
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one standalone prototype script.');
await mkdir(directory, { recursive: true });
await Bun.write(`${directory}/project-setup.js`, scripts[0][1]!);
await Bun.write(
  `${directory}/project-setup.html`,
  source.replace(scripts[0][0], '<script src="./project-setup.js"></script>'),
);

await import('./build-library-preview');
