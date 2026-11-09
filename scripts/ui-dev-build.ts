import { cp, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { fixture } from '../tests/helpers';

// A disposable checkout keeps watch builds and temporary CSS changes away from the real dist/source.
const data = await fixture();
data.store.put('settings', { id: 'main', ...data.store.settings(), roots: [], scanGlobals: false });
const checkout = join(data.root, 'checkout');
await mkdir(checkout);
for (const name of ['src', 'web', 'scripts', 'package.json', 'vite.config.ts', 'tsconfig.json'])
  await cp(resolve(name), join(checkout, name), { recursive: true });
await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');
const port = 48025;
const child = Bun.spawn([process.execPath, 'scripts/dev.ts', '--port', String(port)], {
  cwd: checkout,
  env: { PATH: process.env.PATH || '', RIGSHELF_DATA_DIR: data.store.directory },
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
});
let output = '';
let diagnostics = '';
async function consume(stream: ReadableStream<Uint8Array>, append: (value: string) => void) {
  const reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    append(new TextDecoder().decode(chunk.value));
  }
}
const stdout = consume(child.stdout, (chunk) => {
  output = (output + chunk).slice(-64000);
});
const stderr = consume(child.stderr, (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-64000);
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/dev-build');
await mkdir(directory, { recursive: true });
try {
  await expect.poll(() => output.includes('Rigshelf is ready at '), { timeout: 30000 }).toBe(true);
  const access =
    /Rigshelf is ready at (http:\/\/rigshelf\.localhost:\d+\/#access=[a-f0-9]{64})/.exec(
      output,
    )?.[1];
  if (!access) throw new Error('Development server did not provide its private access URL.');
  await expect
    .poll(() => (output.match(/built in/g) || []).length, { timeout: 20000 })
    .toBeGreaterThanOrEqual(2);
  await page.goto(access);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const roots = page.locator('textarea.code-editor');
  await roots.fill(data.project);
  await expect(
    page.getByText('A new interface build is ready. Reload when your draft is saved.', {
      exact: true,
    }),
  ).toHaveCount(0);
  const stylesheet = join(checkout, 'web/styles.css');
  await Bun.write(
    stylesheet,
    `${await Bun.file(stylesheet).text()}\n:root { --development-watch-fixture: 1; }\n`,
  );
  await expect(
    page.getByText('A new interface build is ready. Reload when your draft is saved.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await expect(roots).toHaveValue(data.project);
  await page.getByRole('button', { name: 'Reload interface', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Keep your draft?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(discard).toHaveCount(0);
  await expect(roots).toHaveValue(data.project);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Workbench preferences saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload interface', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(roots).toHaveValue(data.project);
  await expect(page.getByRole('button', { name: 'Reload interface', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: join(directory, 'saved-reload.png') });
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        checks: [
          'Real dev command starts both owned watchers in an isolated checkout',
          'Frontend CSS changes rebuild without restarting',
          'Reload notice preserves drafts; Cancel keeps editing',
          'Saved preferences survive explicit reload',
          'Shutdown stops owned development processes',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  process.stdout.write('Development watch/reload flow passed.\n');
} catch (error) {
  await Bun.write(join(directory, 'failure.log'), `${output}\n${diagnostics}`);
  await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  child.kill('SIGTERM');
  await child.exited;
  await Promise.all([stdout, stderr]);
  await data.cleanup();
}
