import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { now } from '../src/core/safety';
import { classifyResource } from '../src/core/seeds';
import { Store } from '../src/core/store';
import { checkSource, discoverSourceSkills } from '../src/core/upstream';

// Explicit developer research. Only public pinned content is read; no installer is executed.
const directory = resolve('.local/research');
await mkdir(directory, { recursive: true, mode: 0o700 });
const records = (await Bun.file('data/resource-notes.txt').text())
  .split('\n')
  .filter(Boolean)
  .map(classifyResource);
const sources = [
  ...new Map(
    records.filter((source) => source.type === 'github').map((source) => [source.id, source]),
  ).values(),
];
const store = new Store(
  process.env.RIGSHELF_DATA_DIR || process.env.KITFOLD_DATA_DIR || '.local/development',
);
const results: unknown[] = [];
try {
  for (let offset = 0; offset < sources.length; offset += 2) {
    const batch = await Promise.allSettled(
      sources.slice(offset, offset + 2).map(async (source) => {
        if (!store.get('source', source.id)) store.put('source', source);
        try {
          const skills = await discoverSourceSkills(store, source.id);
          const current = store.get<typeof source>('source', source.id)!;
          return {
            repo: source.name,
            url: source.url,
            status: current.status,
            ref: current.latestRef,
            skillCount: skills.length,
            checkedAt: current.checkedAt,
            classification: skills.length ? 'skill collection' : 'repository / CLI / documentation',
          };
        } catch (error) {
          const current = await checkSource(store, source.id);
          return {
            repo: source.name,
            url: source.url,
            status: current.status,
            indexError: error instanceof Error ? error.message : 'Index unavailable',
            ref: current.latestRef,
            checkedAt: now(),
          };
        }
      }),
    );
    for (const result of batch)
      results.push(
        result.status === 'fulfilled'
          ? result.value
          : { status: 'error', message: String(result.reason) },
      );
    await Bun.write(`${directory}/source-evidence.json`, JSON.stringify(results, null, 2));
  }
  const status = results as { status: string; skillCount?: number }[];
  process.stdout.write(
    `${JSON.stringify({ total: results.length, reachable: status.filter((value) => value.status === 'reachable').length, unavailable: status.filter((value) => value.status !== 'reachable').length, indexedSkills: status.reduce((total, value) => total + (value.skillCount || 0), 0) })}\n`,
  );
} finally {
  store.close();
}
