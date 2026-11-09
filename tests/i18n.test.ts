import { afterEach, expect, test } from 'bun:test';
import { countText } from '../web/format';
import { getLocale, setLocale, t } from '../web/i18n';
import english from '../web/locales/en.json';
import turkish from '../web/locales/tr.json';

afterEach(async () => {
  await setLocale('en');
});

test('Turkish covers the English catalog with identical interpolation names', () => {
  for (const [key, value] of Object.entries(english)) expect(value).toBe(key);
  expect(Object.keys(turkish).sort()).toEqual(Object.keys(english).sort());
  for (const [key, message] of Object.entries(turkish)) {
    expect(message.trim().length).toBeGreaterThan(0);
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((value) => value[1]).sort();
    expect(placeholders(message)).toEqual(placeholders(key));
  }
});

test('localization preserves technical vocabulary while translating surrounding interface copy', async () => {
  const terms = [
    /\bskills?\b/i,
    /\bplugins?\b/i,
    /\bagents?\b/i,
    /\bpresets?\b/i,
    /\bsnapshots?\b/i,
    /\bharness\b/i,
    /\bprovider\b/i,
    /\bMCP\b/,
    /\bCLI\b/,
    /\bAPI\b/,
    /\bstdio\b/,
  ];
  for (const [source, translated] of Object.entries(turkish))
    for (const term of terms) if (term.test(source)) expect(translated).toMatch(term);
  await setLocale('tr');
  for (const label of [
    'Skills',
    'Skill',
    'Plugins',
    'Plugin',
    'MCP servers',
    'MCP server',
    'Agent',
    'Presets',
    'Snapshot',
  ])
    expect(t(label)).toBe(label);
  expect(t('Save new snapshot')).toBe('Yeni snapshot’ı kaydet');
  expect(countText(2, 'skill')).toBe('2 skill');
  expect(t('Settings')).toBe('Ayarlar');
});

test('a completed older language load cannot replace a newer selection', async () => {
  const previous = setLocale('tr');
  await setLocale('en');
  await previous;
  expect(getLocale()).toBe('en');
});

test('language switching preserves spacing, fallback diagnostics and inserted names', async () => {
  await setLocale('tr');
  expect(t(' Library ')).toBe(' Kütüphane ');
  expect(t('   ')).toBe('   ');
  expect(t('constructor')).toBe('constructor');
  expect(t('__proto__')).toBe('__proto__');
  expect(t('Unknown upstream diagnostic')).toBe('Unknown upstream diagnostic');
  expect(t('Inspect {{name}}', { name: 'Library <project>' })).toBe(
    'Library <project> projesini incele',
  );
  expect(countText(2, 'project')).toBe('2 proje');
  await setLocale('unsupported');
  expect(getLocale()).toBe('tr');
  await setLocale('en');
  expect(countText(2, 'project')).toBe('2 projects');
  expect(t('Library')).toBe('Library');
});
