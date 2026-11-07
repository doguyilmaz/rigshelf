import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guides } from '../src/docs';

const site = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(site, '..');
const output = join(site, '.generated');
const routes = new Map<string, string>(
  guides.map((guide) => [guide.source, `/docs/${guide.slug}/`]),
);
routes.set('web/public/fonts/instrumentsans-OFL.txt', '/fonts/instrumentsans-OFL.txt');
routes.set('web/public/fonts/newsreader-OFL.txt', '/fonts/newsreader-OFL.txt');
for (const name of ['three', 'astro'])
  routes.set(`site/public/licenses/${name}.txt`, `/licenses/${name}.txt`);

function links(content: string, source: string): string {
  return content.replace(/\]\(([^)\s]+)\)/g, (match, href: string) => {
    if (/^(?:https?:|mailto:|#)/.test(href)) return match;
    const [path, fragment] = href.split('#');
    const target = routes.get(posix.normalize(posix.join(posix.dirname(source), path!)));
    if (!target) throw new Error(`Unmapped documentation link in ${source}: ${href}`);
    return `](${target}${fragment ? `#${fragment}` : ''})`;
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'docs'), { recursive: true });
for (const guide of guides) {
  const raw = await readFile(join(repository, guide.source), 'utf8');
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^\s*# [^\n]+\n/, '');
  const metadata = `---\ntitle: ${JSON.stringify(guide.title)}\ndescription: ${JSON.stringify(guide.description)}\ngroup: ${JSON.stringify(guide.group)}\n---\n\n`;
  await writeFile(join(output, 'docs', `${guide.slug}.md`), metadata + links(body, guide.source));
}
for (const name of [
  'instrument-sans.ttf',
  'newsreader.ttf',
  'instrumentsans-OFL.txt',
  'newsreader-OFL.txt',
]) {
  const target = join(output, 'public/fonts', name);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(repository, 'web/public/fonts', name), target);
}
for (const name of [
  'favicon.svg',
  'social.svg',
  'social.png',
  '_headers',
  'licenses/three.txt',
  'licenses/astro.txt',
]) {
  const target = join(output, 'public', name);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(site, 'public', name), target);
}
process.stdout.write(`Prepared ${guides.length} guides from canonical repository documents.\n`);
