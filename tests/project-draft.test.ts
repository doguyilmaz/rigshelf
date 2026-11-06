import { expect, test } from 'bun:test';
import { type ProjectDraft, parseProjectDraft } from '../web/project-draft';

const draft: ProjectDraft = {
  version: 1,
  path: '/example/new project',
  requirements: 'A focused Expo application.',
  preset: 'expo',
  providers: ['codex', 'claude'],
  selected: ['exact-snapshot-pin', 'unavailable-pin'],
  updatedAt: '2026-11-06T01:00:00.000Z',
};

test('tab recovery preserves exact choices and unavailable references while discarding any forged plan or approval fields', () => {
  const recovered = parseProjectDraft(
    JSON.stringify({
      ...draft,
      reviewed: true,
      replaceExisting: true,
      plan: { id: 'forged' },
      automatic: true,
    }),
  );
  expect(recovered).toEqual(draft);
  expect(recovered).not.toHaveProperty('reviewed');
  expect(recovered).not.toHaveProperty('plan');
  expect(recovered).not.toHaveProperty('automatic');
});

test('malformed, oversized and unsupported recovery choices cannot enter the setup controller', () => {
  for (const value of [
    null,
    '',
    '{',
    'x'.repeat(100001),
    JSON.stringify([]),
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, path: '/example\ninvalid' }),
    JSON.stringify({ ...draft, providers: ['unknown-harness'] }),
    JSON.stringify({ ...draft, selected: Array(101).fill('pin') }),
    JSON.stringify({ ...draft, requirements: 'x'.repeat(10001) }),
    JSON.stringify({ ...draft, updatedAt: 'invalid' }),
  ])
    expect(parseProjectDraft(value)).toBeUndefined();
  expect(
    parseProjectDraft(
      JSON.stringify({ ...draft, providers: ['codex', 'codex'], selected: ['pin', 'pin'] }),
    ),
  ).toMatchObject({ providers: ['codex'], selected: ['pin'] });
});
