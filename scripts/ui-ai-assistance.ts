import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, type Locator } from '@playwright/test';
import { aiDraft, completeAiDraft, listAiDrafts } from '../src/core/ai-assistance';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"expo":"56"}}');
const existing = sampleSkill(data.store, 'expo-guide');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
let calls = 0;
let aborted = false;
const server = startServer(data.store, 47990, {
  aiDriver: async ({ request, signal }) => {
    calls++;
    if (request.text.includes('cancel fixture'))
      return new Promise((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve({});
          },
          { once: true },
        ),
      );
    if (request.text.includes('invalid fixture')) return 'invalid output';
    const base = { summary: 'Prepared from your notes.', questions: [] };
    if (request.task === 'library') {
      if (request.text.includes('MCP'))
        return {
          ...base,
          draft: {
            kind: 'mcp',
            name: 'device-tools',
            mcp: {
              transport: 'stdio',
              command: 'fixture-mcp',
              args: ['--readonly'],
              env: {},
              headers: {},
            },
            tags: ['mobile'],
          },
        };
      if (request.text.includes('bunx'))
        return {
          ...base,
          draft: {
            kind: 'source',
            name: 'Example skills',
            input: 'bunx skills add example/skills --skill example-guide',
            recipe: 'bunx skills add example/skills --skill example-guide',
          },
        };
      return {
        ...base,
        draft: {
          kind: 'skill',
          name: 'api-error-guide',
          description: 'Use when implementing actionable API errors.',
          body: 'Return concise errors with an actionable next step.\n\nKeep error details private.',
          tags: ['backend', 'typescript'],
        },
      };
    }
    if (request.task === 'rule')
      return {
        ...base,
        draft: {
          kind: 'rule',
          name: 'Readable errors',
          scope: 'backend',
          content: 'Return concise errors with an actionable next step.',
          priority: 50,
          provenance: 'User notes',
        },
      };
    if (request.task === 'preset')
      return {
        ...base,
        draft: {
          kind: 'preset',
          name: 'Focused Expo kit',
          description: 'Expo with concise engineering guidance.',
          stacks: ['expo', 'react-native'],
          selectors: ['expo-guide'],
          providers: ['codex'],
          entryIds: [existing.id],
        },
      };
    if (request.task === 'requirements')
      return {
        ...base,
        draft: {
          kind: 'requirements',
          text: 'An Expo app with clear API errors and a focused native UI.',
          entryIds: [existing.id],
        },
      };
    if (request.task === 'skill')
      return {
        ...base,
        draft: {
          kind: 'skill',
          name: 'expo-guide-formatted',
          description: 'Use when reviewing a focused Expo project.',
          body: 'Review the project requirements before changing the focused kit.',
          tags: ['expo', 'review'],
        },
      };
    if (request.task === 'mcp')
      return {
        ...base,
        draft: {
          kind: 'mcp',
          name: 'device-tools-formatted',
          mcp: {
            transport: 'stdio',
            command: 'fixture-mcp',
            args: ['--readonly', '--compact'],
            env: {},
            headers: {},
          },
          tags: ['mobile', 'review'],
        },
      };
    return { ...base, draft: { kind: 'text', text: 'A concise, formatted document.' } };
  },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const directory = resolve('.local/qa/ai-assistance');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
async function audit(name: string) {
  await assertNeutralTheme(page, name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
async function generate(panel: Locator, text: string) {
  await panel.waitFor();
  if (
    (await panel.locator('.ai-request[data-preview]').count()) &&
    !(await panel.getByLabel('What should AI prepare?', { exact: true }).isVisible())
  )
    await panel.locator('.ai-request > summary').click();
  await panel.getByLabel('What should AI prepare?', { exact: true }).fill(text);
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Ollama', exact: true }).click();
  await panel.getByLabel('Model', { exact: false }).fill('fixture-model');
  await panel.getByRole('button', { name: 'Generate with Ollama', exact: true }).click();
  await expect(panel.getByText('Draft preview', { exact: true })).toBeVisible();
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  let panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveCount(0);
  await generate(
    panel,
    'Make a Skill from these notes: actionable API errors, concise responses, no private debug details.',
  );
  expect(data.store.entries()).toHaveLength(1);
  await audit('skill-preview');
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('api-error-guide');
  await expect(dialog.getByLabel('When should an agent use it?', { exact: true })).toHaveValue(
    /API errors/,
  );
  await expect(dialog.getByLabel('Instructions · Markdown', { exact: true })).toHaveValue(
    /Keep error details private\./,
  );
  await dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(data.store.entries()).toHaveLength(2);
  expect(data.store.installations()).toEqual([]);
  checks.push(
    'Plain notes become a complete Skill form; generation and preview do not save, and explicit save only updates the private library.',
  );

  await page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await generate(
    panel,
    'Convert this MCP command into a canonical definition: fixture-mcp --readonly',
  );
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  const definition = dialog.getByLabel('Canonical MCP definition · JSON', { exact: true });
  expect(JSON.parse(await definition.inputValue()).transport).toBe('stdio');
  await dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
  expect(data.store.entries().filter((entry) => entry.kind === 'mcp')).toHaveLength(1);
  expect(data.store.planSummaries()).toEqual([]);
  checks.push(
    'A supplied MCP command becomes a canonical definition without starting that server or preparing a setup plan.',
  );

  await page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await generate(
    panel,
    'Prepare this source: bunx skills add example/skills --skill example-guide',
  );
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(
    dialog.getByLabel('URL, repository, or installation command', { exact: true }),
  ).toHaveValue('bunx skills add example/skills --skill example-guide');
  await expect(dialog.getByLabel('Installation recipe', { exact: false })).toHaveValue(
    'bunx skills add example/skills --skill example-guide',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  checks.push(
    'An installation command fills source fields as data and is never executed or researched during AI generation.',
  );

  const originalMcp = data.store.entry(
    data.store.entries().find((entry) => entry.kind === 'mcp')!.id,
  )!;
  for (const item of [
    { original: existing, kind: 'skill', name: 'expo-guide-formatted', tags: ['expo', 'review'] },
    {
      original: originalMcp,
      kind: 'mcp',
      name: 'device-tools-formatted',
      tags: ['mobile', 'review'],
    },
  ]) {
    await page.getByRole('tab', { name: /^All types/ }).click();
    await page.getByRole('button', { name: `Open ${item.original.name}`, exact: true }).click();
    let detail = page.getByRole('dialog', { name: item.original.name, exact: true });
    await detail.getByRole('button', { name: 'Content', exact: true }).click();
    await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
    await detail.getByRole('button', { name: 'Improve or format with AI', exact: true }).click();
    panel = detail.getByRole('region', { name: 'AI assistance', exact: true });
    await panel.getByLabel('What should AI prepare?', { exact: true }).fill('Keep these notes.');
    await detail.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(panel.getByLabel('What should AI prepare?', { exact: true })).toHaveValue(
      'Keep these notes.',
    );
    await generate(panel, 'Improve this existing definition and its tags.');
    await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
    await expect(
      detail.getByLabel(item.kind === 'skill' ? 'Skill name' : 'Name', { exact: true }),
    ).toHaveValue(item.name);
    await detail.getByRole('button', { name: 'Save new snapshot', exact: true }).click();
    detail = page.getByRole('dialog', { name: item.name, exact: true });
    await expect(detail).toBeVisible();
    const saved = data.store.entries().find((entry) => entry.name === item.name)!;
    expect(saved.tags).toEqual(item.tags);
    if (item.kind === 'skill')
      expect(data.store.entry(saved.id)?.body).toContain(
        'Review the project requirements before changing the focused kit.',
      );
    else expect(saved.mcp?.args).toEqual(['--readonly', '--compact']);
    expect(data.store.entry(item.original.id)?.body).toBe(item.original.body);
    await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  checks.push(
    'AI-assisted Skill and MCP edits save the adopted names, content and tags in new snapshots; originals and unsaved AI notes remain protected.',
  );

  await page.getByRole('button', { name: 'Directives', exact: true }).click();
  await page.getByRole('button', { name: 'New directive', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create, improve or format this directive', exact: true })
    .click();
  panel = page.getByRole('region', { name: 'AI assistance', exact: true });
  await generate(
    panel,
    'Make this concise Markdown guidance: return short useful errors, and tell the caller what to do next.',
  );
  await page.getByLabel('Title', { exact: true }).fill('A newer manual title');
  await expect(panel.getByRole('button', { name: 'Use draft', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('A newer manual title');
  await panel.getByRole('button', { name: 'Keep my version', exact: true }).click();
  await generate(panel, 'Format existing guidance and keep the meaning.');
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Readable errors');
  await expect(page.locator('.rule-textarea')).toHaveValue(
    'Return concise errors with an actionable next step.',
  );
  await page.getByRole('button', { name: 'Save directive', exact: true }).click();
  await expect(page.getByText('Directive saved.', { exact: false })).toBeVisible();
  checks.push(
    'Directive preparation fills title, scope and Markdown; stale proposals cannot replace newer manual edits.',
  );

  await panel.getByLabel('What should AI prepare?', { exact: true }).fill('cancel fixture');
  await panel.getByRole('button', { name: 'Generate with Ollama', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect.poll(() => aborted).toBe(true);
  await expect(panel.getByText('Draft preview', { exact: true })).toHaveCount(0);
  await expect(page.locator('.rule-textarea')).toHaveValue(
    'Return concise errors with an actionable next step.',
  );
  await panel.getByLabel('What should AI prepare?', { exact: true }).fill('invalid fixture');
  await panel.getByRole('button', { name: 'Generate with Ollama', exact: true }).click();
  await expect(
    panel.getByText('AI did not return a structured draft.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.rule-textarea')).toHaveValue(
    'Return concise errors with an actionable next step.',
  );
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = false;
  let released = false;
  await page.route('**/api/ai/drafts', async (route) => {
    const response = await route.fetch();
    received = true;
    await gate;
    await route.fulfill({ response });
    released = true;
  });
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('A delayed fixture request.');
  await panel.getByRole('button', { name: 'Generate with Ollama', exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await panel.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  release();
  await expect.poll(() => released).toBe(true);
  await expect(panel.getByText('Draft preview', { exact: true })).toHaveCount(0);
  await expect(page.locator('.rule-textarea')).toHaveValue(
    'Return concise errors with an actionable next step.',
  );
  await page.unroute('**/api/ai/drafts');
  checks.push(
    'Canceling before the start response arrives cannot resurrect a previous or late proposal.',
  );
  await panel.getByLabel('What should AI prepare?', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close AI assistance', exact: true }).click();
  checks.push(
    'Cancellation drains generation; malformed AI output leaves the editor unchanged with a useful recovery message.',
  );

  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'A new starting point', exact: true });
  await dialog.getByRole('button', { name: 'Build this Preset with AI', exact: true }).click();
  panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await generate(panel, 'Prepare a focused Expo Preset using my library and Codex.');
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Focused Expo kit');
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(page.getByText('Focused Expo kit', { exact: true })).toBeVisible();
  checks.push(
    'A natural-language request fills a Preset using a real catalog snapshot and the selected Harness.',
  );

  await page.getByRole('button', { name: 'Set up a project', exact: true }).click();
  await page.locator('.setup-known-projects button').click();
  await page.locator('.detection-result strong').waitFor();
  await page.getByRole('button', { name: 'Describe the project to AI', exact: true }).click();
  panel = page.getByRole('region', { name: 'AI assistance', exact: true });
  await generate(
    panel,
    'An Expo app. Suggest only the relevant library Skills and rewrite my requirements.',
  );
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  await page.getByText('Requirements & preset', { exact: true }).click();
  await expect(page.getByLabel('What are you making?', { exact: false })).toHaveValue(
    /clear API errors/,
  );
  expect(data.store.planSummaries()).toEqual([]);
  checks.push(
    'AI project requirements refresh the focused kit and select only known snapshots; Review and Apply remain separate.',
  );

  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Current Agent · MCP drafts', exact: true }).click();
  await expect(panel.getByLabel('Model', { exact: false })).toHaveCount(0);
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('Let my connected Agent prepare this.');
  const before = calls;
  await panel.getByRole('button', { name: 'Ask connected Agent', exact: true }).click();
  await expect(
    panel.getByText('Waiting for your connected agent.', { exact: false }),
  ).toBeVisible();
  const waiting = listAiDrafts(data.store).find((job) => job.state === 'waiting')!;
  completeAiDraft(data.store, waiting.id, {
    summary: 'Prepared in the connected session.',
    questions: [],
    draft: {
      kind: 'requirements',
      text: 'An Expo app prepared by the connected Agent.',
      entryIds: [existing.id],
    },
  });
  await expect(panel.getByText('Draft preview', { exact: true })).toBeVisible();
  expect(calls).toBe(before);
  expect(aiDraft(data.store, waiting.id).state).toBe('ready');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await audit(`ai-${width}`);
  }
  checks.push(
    'Connected-agent proposals arrive in the same preview without launching a model; the AI flow fits four viewport widths with no Axe violations.',
  );
  expect(errors).toEqual([]);
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify({ checks, errors, calls }, null, 2),
  );
  process.stdout.write(`${JSON.stringify({ checks, errors, calls })}\n`);
} catch (error) {
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
