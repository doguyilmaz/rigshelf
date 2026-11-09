import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { filePreview, planView } from '../src/core/plan-view';
import { createPlan } from '../src/core/planner';
import { redact } from '../src/core/safety';
import { fixture } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
test('plan summaries omit all encoded file bodies and lazy previews redact quoted configuration credentials', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  await Bun.write(
    join(data.project, 'AGENTS.md'),
    '# Existing\n\napi_key = "dummy-sensitive-value"\n',
  );
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex'],
    entryIds: [],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  const summary = planView(plan);
  expect(JSON.stringify(summary)).not.toContain('dummy-sensitive-value');
  expect('before' in summary.changes[0]).toBe(false);
  expect('after' in summary.changes[0]).toBe(false);
  const index = plan.changes.findIndex((change) => change.path === 'AGENTS.md');
  const preview = filePreview(plan, index);
  expect(preview.redacted).toBe(true);
  expect(preview.before).not.toContain('dummy-sensitive-value');
  expect(Buffer.from(plan.changes[index].before!, 'base64').toString()).toContain(
    'dummy-sensitive-value',
  );
});
test('credential masking preserves environment references and handles escaped strings without corrupting JSON', () => {
  const input = JSON.stringify({
    api_key: 'dummy"escaped\\value',
    Authorization: 'Bearer private-value',
    password: '${PASSWORD}',
    token: 'short',
  });
  const result = JSON.parse(redact(input)) as Record<string, string>;
  expect(result.api_key).toBe('${RIGSHELF_SECRET}');
  expect(result.Authorization).toBe('${RIGSHELF_SECRET}');
  expect(result.password).toBe('${PASSWORD}');
  expect(result.token).toBe('${RIGSHELF_SECRET}');
  expect(redact('https://example.com?token=dummy-only&scope=read')).not.toContain('dummy-only');
});
